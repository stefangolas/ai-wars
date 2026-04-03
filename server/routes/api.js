// REST API for bot/agent access.
// Mirrors all WebSocket actions as HTTP endpoints.
// Auth: Authorization: Bearer <jwt_token>  (same token from /auth/login or /auth/register)

import express from 'express';
import { verifyToken } from '../auth/auth.js';
import { ACTIONS, getTribe } from '../game/actions.js';
import { db } from '../db/database.js';
import { BUILDINGS } from '../../clone/src/data/buildings.js';
import { UNITS }     from '../../clone/src/data/units.js';
import { RateLimiter } from '../lib/rateLimiter.js';
import { WORLD_SPEED } from '../config.js';

// 30 requests per 10 seconds per player — generous enough for fast bots,
// tight enough to prevent runaway loops from hammering the DB.
const apiLimiter = new RateLimiter(30, 10_000);

const router = express.Router();

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Missing or malformed Authorization header' });
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  req.playerId = payload.id;
  next();
}

// ── Action helper ─────────────────────────────────────────────────────────────
// Calls an existing ACTIONS handler, forwarding playerId + caller-supplied params.

function act(actionName, getParams) {
  return (req, res) => {
    try {
      const params = getParams ? getParams(req) : {};
      const result = ACTIONS[actionName]({ playerId: req.playerId, ...params });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      console.error(`[api] ${actionName}:`, e.message);
      res.status(500).json({ ok: false, error: 'Server error' });
    }
  };
}

// ── Public endpoints (no auth) ────────────────────────────────────────────────

// Static game data — all building and unit definitions.
// Agents should fetch this once per session to understand costs, times, and stats.
router.get('/constants', (req, res) => {
  res.json({ ok: true, buildings: BUILDINGS, units: UNITS });
});

// World settings — speed, map size, tick rate.
router.get('/world', (req, res) => {
  res.json({
    ok: true,
    worldSpeed:  WORLD_SPEED,
    mapSize:     500,
    tickMs:      2000,
    coordCenter: { x: 250, y: 250 },
    note: 'All build/train times in the game data are at worldSpeed=1. Divide by worldSpeed for real duration.',
  });
});

// ── All endpoints below require auth ─────────────────────────────────────────

router.use(requireAuth);

// Rate limit all authenticated endpoints by player ID.
router.use((req, res, next) => {
  if (!apiLimiter.allow(req.playerId)) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded — slow down' });
  }
  next();
});

// ── Read state ────────────────────────────────────────────────────────────────

// Full snapshot: village (resources, buildings, units, queues, commands) + tribe.
// This is the primary endpoint for agents — one call gives everything needed to decide an action.
router.get('/state', act('GET_VILLAGE'));

// Alias: /game/village also returns the full village+tribe snapshot.
router.get('/village', act('GET_VILLAGE'));

// Public info on a specific village (name, coords, points, player, tribe tag).
// Use this to evaluate attack targets.
router.get('/village/:id', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT v.id, v.name, v.x, v.y, v.points, v.is_npc,
             p.id   AS player_id,   p.name AS player_name,
             t.id   AS tribe_id,    t.tag  AS tribe_tag
      FROM villages v
      LEFT JOIN players p ON p.id = v.player_id
      LEFT JOIN tribes  t ON t.id = p.tribe_id
      WHERE v.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Village not found' });
    res.json({ ok: true, village: row });
  } catch (e) {
    console.error('[api] GET /village/:id:', e.message);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Map area. Returns all villages (NPC and player) within `radius` tiles of (cx, cy).
// NPC villages (is_npc: true) have 0 defenders — safe early attack targets.
router.get('/map', act('GET_MAP', req => ({
  cx:     Number(req.query.cx     ?? 250),
  cy:     Number(req.query.cy     ?? 250),
  radius: Number(req.query.radius ?? 30),
})));

// Battle reports (20 per page). Contains unit counts, loot, win/loss for each battle.
router.get('/reports', act('GET_REPORTS', req => ({
  offset: Number(req.query.offset ?? 0),
})));

// Trade offers posted by other players that you can accept.
router.get('/trade-offers', act('GET_TRADE_OFFERS'));

// Your current tribe info (members, diplomacy, forum).
router.get('/tribe', act('GET_TRIBE'));

// All tribes on the server — use to find tribes to join.
router.get('/tribes', (req, res) => {
  try {
    const tribes = db.prepare(`
      SELECT t.id, t.name, t.tag, t.description,
             COUNT(p.id) AS member_count
      FROM tribes t
      LEFT JOIN players p ON p.tribe_id = t.id
      GROUP BY t.id
      ORDER BY member_count DESC
    `).all();
    res.json({ ok: true, tribes });
  } catch (e) {
    console.error('[api] GET /tribes:', e.message);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Top 50 villages by points (excludes NPCs).
router.get('/rankings', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT v.id, v.name, v.x, v.y, v.points,
             p.id AS player_id, p.name AS player_name,
             t.tag AS tribe_tag
      FROM villages v
      LEFT JOIN players p ON p.id = v.player_id
      LEFT JOIN tribes  t ON t.id = p.tribe_id
      WHERE v.is_npc = 0
      ORDER BY v.points DESC
      LIMIT 50
    `).all();
    res.json({ ok: true, rankings: rows });
  } catch (e) {
    console.error('[api] GET /rankings:', e.message);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ── Build & train ─────────────────────────────────────────────────────────────

// Queue a building upgrade.  Body: { "building": "main" }
// Returns updated village state. Error if prereqs not met or resources insufficient.
// Queue a building upgrade.  Body: { "building": "main", "villageId": 7 (optional) }
router.post('/build', act('ENQUEUE_UPGRADE', req => ({
  building:  req.body.building,
  villageId: req.body.villageId ?? null,
})));

// Queue unit training.  Body: { "unit": "axe", "count": 50, "villageId": 7 (optional) }
router.post('/train', act('ENQUEUE_TRAINING', req => ({
  unit:      req.body.unit,
  count:     req.body.count,
  villageId: req.body.villageId ?? null,
})));

// ── Combat ────────────────────────────────────────────────────────────────────

// Send an attack.  Body: { "toVillageId": 12, "units": { "axe": 100, "ram": 5 }, "villageId": 7 (optional) }
// Returns commandId and arrivalTime (Unix ms). Battle resolves automatically.
router.post('/attack', act('SEND_ATTACK', req => ({
  toVillageId:    req.body.toVillageId,
  units:          req.body.units,
  catapultTarget: req.body.catapultTarget ?? null,
  villageId:      req.body.villageId ?? null,
})));

// ── Trading ───────────────────────────────────────────────────────────────────

// Post a trade offer.  Body: { "offerRes": "wood", "offerAmt": 500, "wantRes": "iron", "wantAmt": 300, "villageId": 7 (optional) }
router.post('/trade/post',   act('POST_TRADE',   req => ({
  offerRes:  req.body.offerRes,
  offerAmt:  req.body.offerAmt,
  wantRes:   req.body.wantRes,
  wantAmt:   req.body.wantAmt,
  villageId: req.body.villageId ?? null,
})));

// Accept another player's offer.  Body: { "offerId": 7, "villageId": 3 (optional) }
router.post('/trade/accept', act('ACCEPT_TRADE', req => ({
  offerId:   req.body.offerId,
  villageId: req.body.villageId ?? null,
})));

// Cancel your own offer.  Body: { "offerId": 7, "villageId": 3 (optional) }
router.post('/trade/cancel', act('CANCEL_TRADE', req => ({
  offerId:   req.body.offerId,
  villageId: req.body.villageId ?? null,
})));

// ── Village ───────────────────────────────────────────────────────────────────

// Rename your village.  Body: { "name": "Fort Awesome", "villageId": 7 (optional) }
router.post('/village/rename', act('RENAME_VILLAGE', req => ({
  name:      req.body.name,
  villageId: req.body.villageId ?? null,
})));

// ── Tribe ─────────────────────────────────────────────────────────────────────

// Create a new tribe.  Body: { "name": "The Horde", "tag": "HORDE", "description": "..." }
router.post('/tribe/create',    act('CREATE_TRIBE',  req => req.body));

// Leave your current tribe.  Body: {}
router.post('/tribe/leave',     act('LEAVE_TRIBE'));

// Invite a player to your tribe (leaders only).  Body: { "targetPlayerId": 5 }
router.post('/tribe/invite',         act('INVITE_TO_TRIBE', req => ({ targetPlayerId: Number(req.body.targetPlayerId) })));

// Accept a tribe invitation.  Body: { "inviteId": 3 }
router.post('/tribe/invite/accept',  act('ACCEPT_INVITE',   req => ({ inviteId: Number(req.body.inviteId) })));

// Decline a tribe invitation.  Body: { "inviteId": 3 }
router.post('/tribe/invite/decline', act('DECLINE_INVITE',  req => ({ inviteId: Number(req.body.inviteId) })));

// Kick a member from your tribe (leaders only).  Body: { "targetPlayerId": 5 }
router.post('/tribe/kick',    act('KICK_MEMBER',    req => ({ targetPlayerId: Number(req.body.targetPlayerId) })));

// Promote a member to leader (leaders only).  Body: { "targetPlayerId": 5 }
router.post('/tribe/promote', act('PROMOTE_MEMBER', req => ({ targetPlayerId: Number(req.body.targetPlayerId) })));

// Set diplomacy with another tribe.
// Body: { "targetTribeId": 2, "status": "ally" }  — status: "ally" | "nap" | "war" | null (to clear)
router.post('/tribe/diplomacy', act('SET_DIPLOMACY', req => req.body));

// Post a message to your tribe forum.  Body: { "text": "..." }
router.post('/tribe/forum',     act('POST_FORUM',    req => ({ text: req.body.text })));

// ── Private messaging ─────────────────────────────────────────────────────────

// List all players (to find recipients).
router.get('/players', act('GET_PLAYERS'));

// Your inbox or sent folder. Query: ?folder=inbox|sent&offset=0
router.get('/messages', act('GET_MESSAGES', req => ({
  folder: req.query.folder ?? 'inbox',
  offset: Number(req.query.offset ?? 0),
})));

// Send a private message.  Body: { "toPlayerId": 3, "subject": "Hi", "text": "..." }
router.post('/messages/send', act('SEND_MESSAGE', req => ({
  toPlayerId: Number(req.body.toPlayerId),
  subject:    req.body.subject ?? '',
  text:       req.body.text,
})));

// ── Militia ───────────────────────────────────────────────────────────────────

// ── Support troops ────────────────────────────────────────────────────────────

// Send support (stationing troops) to a friendly village.
// Body: { "toVillageId": 12, "units": { "spear": 100 }, "villageId": 3 (optional) }
// Troops defend the target village until recalled.
router.post('/support', act('SEND_SUPPORT', req => ({
  toVillageId: req.body.toVillageId,
  units:       req.body.units,
  villageId:   req.body.villageId ?? null,
})));

// Recall stationed support troops.  Body: { "commandId": 7 }
// Troops begin traveling home immediately.
router.post('/support/recall', act('RECALL_SUPPORT', req => ({
  commandId: req.body.commandId,
})));

// Activate militia defenders.  Body: { "villageId": 3 (optional) }
router.post('/militia/activate', act('ACTIVATE_MILITIA', req => ({
  villageId: req.body.villageId ?? null,
})));

export default router;
