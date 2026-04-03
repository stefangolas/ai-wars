import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database.js';
import { calculatePoints } from '../game/points.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'tw-dev-secret-change-in-prod';

if (!process.env.JWT_SECRET) {
  console.warn('[security] WARNING: JWT_SECRET env var not set — using insecure default. Set it before public deployment.');
}

// Returns true for loopback and RFC-1918 private addresses.
// Bots run locally so they must be exempt from the one-account-per-IP rule.
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return /^10\./.test(v4) ||
         /^192\.168\./.test(v4) ||
         /^172\.(1[6-9]|2\d|3[01])\./.test(v4);
}
const SALT_ROUNDS = 10;

const DEFAULT_BUILDINGS = {
  main: 3, barracks: 1, stable: 0, garage: 0, snob: 0,
  smith: 0, place: 1, statue: 0, market: 0,
  wood: 1, stone: 0, iron: 0, farm: 1, storage: 1, hide: 1, wall: 0,
};
const DEFAULT_UNITS = {
  spear: 0, sword: 0, axe: 0, archer: 0, spy: 0,
  light: 0, marcher: 0, heavy: 0, ram: 0, catapult: 0,
  knight: 0, snob: 0, militia: 0,
};

export async function register(name, password, ip = null) {
  name = name?.trim();
  if (!name || name.length < 3 || name.length > 30)
    throw new Error('Name must be 3–30 characters');
  if (!/^[a-zA-Z0-9_ \-]+$/.test(name))
    throw new Error('Name may only contain letters, numbers, spaces, hyphens, and underscores');
  if (!password || password.length < 6)
    throw new Error('Password must be at least 6 characters');

  // One account per public IP — bots connecting from localhost are exempt.
  if (ip && !isPrivateIp(ip)) {
    const taken = db.prepare('SELECT id FROM players WHERE registration_ip = ?').get(ip);
    if (taken) throw new Error('An account has already been registered from your IP address');
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  let playerId;
  try {
    const result = db.prepare(
      'INSERT INTO players (name, password_hash, registration_ip) VALUES (?, ?, ?)'
    ).run(name, hash, ip ?? null);
    playerId = result.lastInsertRowid;
  } catch (e) {
    if (e.message.includes('UNIQUE')) throw new Error('That name is already taken');
    throw e;
  }

  const village = createStartingVillage(playerId, name);
  const token   = signToken(playerId, name);
  return { token, playerId, villageId: village.id };
}

export async function login(name, password) {
  const player = db.prepare(
    'SELECT * FROM players WHERE name = ? COLLATE NOCASE'
  ).get(name?.trim());

  if (!player) throw new Error('Invalid name or password');

  const valid = await bcrypt.compare(password, player.password_hash);
  if (!valid) throw new Error('Invalid name or password');

  return { token: signToken(player.id, player.name), playerId: player.id };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function signToken(id, name) {
  return jwt.sign({ id, name }, JWT_SECRET, { expiresIn: '30d' });
}

const WORLD_CENTER  = 250;
const WORLD_SIZE    = 500;
const RING_RADIUS   = 235; // fits 100 villages with ~15-tile spacing and a 15-tile margin
const RING_CAPACITY = 100; // slots on the primary ring

function createStartingVillage(playerId, playerName) {
  const playerVillages = db.prepare(
    'SELECT x, y FROM villages WHERE is_npc = 0 AND player_id IS NOT NULL'
  ).all();

  const taken = new Set(
    db.prepare('SELECT x, y FROM villages').all().map(r => `${r.x},${r.y}`)
  );

  // Assign the next evenly-spaced slot on the ring.
  // Each new player gets the angle for their index (3.6° apart for 100 players).
  // If the ring is full (>100 players) use a slightly smaller inner ring.
  const slot     = playerVillages.length;
  const ringIdx  = slot % RING_CAPACITY;
  const ringNum  = Math.floor(slot / RING_CAPACITY);          // 0 = outer, 1 = inner, …
  const radius   = RING_RADIUS - ringNum * 30;                // each overflow ring 30 tiles inward
  const angle    = (ringIdx / RING_CAPACITY) * 2 * Math.PI;

  let x, y, attempts = 0;
  do {
    // Small jitter so the ring doesn't look perfectly mechanical; expand on conflict
    const jitter = attempts * 0.5;
    const r = radius + (Math.random() - 0.5) * 4 + jitter;
    const a = angle  + (Math.random() - 0.5) * 0.04;
    x = Math.round(WORLD_CENTER + r * Math.cos(a));
    y = Math.round(WORLD_CENTER + r * Math.sin(a));
    x = Math.max(1, Math.min(WORLD_SIZE, x));
    y = Math.max(1, Math.min(WORLD_SIZE, y));
    attempts++;
  } while (taken.has(`${x},${y}`) && attempts < 2000);

  const result = db.prepare(`
    INSERT INTO villages (player_id, name, x, y, wood, clay, iron, last_tick, buildings, units, is_npc, points)
    VALUES (?, ?, ?, ?, 2000, 2000, 2000, ?, ?, ?, 0, ${calculatePoints(DEFAULT_BUILDINGS)})
  `).run(
    playerId,
    `${playerName}'s village`,
    x, y,
    Date.now(),
    JSON.stringify(DEFAULT_BUILDINGS),
    JSON.stringify(DEFAULT_UNITS),
  );

  return { id: result.lastInsertRowid, x, y };
}
