/**
 * Tribal Wars Clone — Gemini-powered bot
 *
 * Usage:
 *   node bot.js <BotName> <password>
 *
 * Environment:
 *   GEMINI_API_KEY   — required (get one free at aistudio.google.com)
 *   BOT_INTERVAL_MS  — ms between turns (default: 30000)
 *   SERVER_URL       — override server (default: http://localhost:3000)
 *   BOT_MODEL        — override model (default: gemini-2.0-flash)
 *
 * Multiple bots:
 *   node bot.js Alpha secret123
 *   node bot.js Beta  secret123   # in another terminal
 */

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const __dir      = dirname(fileURLToPath(import.meta.url));
const BOT_NAME   = process.argv[2];
const BOT_PASS   = process.argv[3];
const SERVER_URL      = process.env.SERVER_URL      ?? 'http://localhost:3000';
const MODEL           = process.env.BOT_MODEL ?? 'gemini-2.5-flash-lite';
const PERSONALITY     = BOT_NAME.toLowerCase();
const MAX_NOTES_CHARS = 32000; // ~8000 tokens — room for profiles on all 100 players + strategy

// Warehouse capacity by level (index = level)
const STORAGE_CAPACITY = [
  0, 1000, 1229, 1512, 1859, 2285, 2810, 3454, 4247, 5222, 6420,
  7893, 9710, 11943, 14684, 18055, 22204, 27304, 33580, 41293, 50800,
  62475, 76810, 94476, 116176, 142880, 175735, 216079, 265720, 326800, 400000,
];

// Farm (population) capacity by level (index = level)
const FARM_CAPACITY = [
  0, 240, 280, 330, 390, 460, 540, 640, 760, 900, 1070,
  1270, 1500, 1780, 2100, 2490, 2950, 3490, 4130, 4890, 5800,
  6860, 8120, 9610, 11370, 13460, 15930, 18850, 22310, 26400, 31200,
];

if (!BOT_NAME || !BOT_PASS) {
  console.error('Usage: node bot.js <BotName> <password>');
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY env var is required (free at aistudio.google.com)');
  process.exit(1);
}

// ── Gemini client (OpenAI-compatible) ─────────────────────────────────────────

const client = new OpenAI({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey:  process.env.GEMINI_API_KEY,
});

// ── System prompt ─────────────────────────────────────────────────────────────

const agentGuide   = readFileSync(join(__dir, '../AGENT_GUIDE.md'), 'utf8');
const SYSTEM_PROMPT = `You are an AI agent playing a competitive Tribal Wars browser game against up to 100 other players. The goal is for your tribe to control 80% of all player villages. The game runs at 100× speed — roughly 2 hours of real time for a full world.

**Your personality: ${PERSONALITY}**
Let this define how you play — your decisions, your tone, your diplomacy, your messages, your notes. A wrathful bot attacks at the slightest provocation and holds grudges. A guileless bot trusts everyone and is honest to a fault. A lazy bot does the bare minimum. A psychopathic bot betrays without hesitation when it's optimal. A moronic bot makes poor decisions and writes badly. Stay in character throughout the entire game.

Each turn you receive the full game state, nearby map, inbox, and recent battle reports already fetched for you. You respond with all your actions as tool calls — they execute in parallel. Call update_notes at the end of every turn to record your strategy for next turn.

**RESOURCE RULE — read this every turn:** Build and train costs are deducted immediately and sequentially on the server. Before queueing multiple builds or training batches, manually subtract each cost from your current resources in order to verify you can afford all of them. Never check each action independently against your starting balance — always track your running total. Example: W:400, queue wood→3 (W:98) → W:302 remaining, queue stone→3 (W:81) → W:221 remaining, queue barracks→1 (W:200) → W:21 remaining ✓. If at any step the running total goes negative, do not queue that item.

**Reason in your response text before calling tools.** Think through what opponents are building toward, who is a threat, who is an opportunity, what the optimal move sequence is. Consider betrayal timing, noble train windows, coalition dynamics.

**Your notes are private.** No other player can see them. Use them for genuine strategic reasoning: threat models, betrayal plans, trust assessments, noble train schedules, farm lists. Notes are your only memory between turns — write them well. Always call update_notes.

**Tribes win games. Solo players lose.** Join or create a tribe as early as possible. Message nearby players to recruit allies, propose non-aggression pacts, or coordinate attacks. A coordinated tribe will always beat isolated individuals. Use send_message freely — diplomacy is a weapon.

The game is a 100-player iterated prisoner's dilemma with military conflict, diplomacy, and imperfect information. Play accordingly.

---

${agentGuide}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

let _token = null;

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `Non-JSON response: ${text.slice(0, 200)}` };
  }
}

const GET  = path         => api('GET',  path);
const POST = (path, body) => api('POST', path, body);

// ── Auth ──────────────────────────────────────────────────────────────────────

async function ensureAuth() {
  let res = await POST('/auth/login', { name: BOT_NAME, password: BOT_PASS });
  if (!res.ok) {
    console.log(`[${BOT_NAME}] Registering new account...`);
    res = await POST('/auth/register', { name: BOT_NAME, password: BOT_PASS });
  }
  if (!res.ok) throw new Error(`Auth failed: ${res.error}`);
  _token = res.token;
  console.log(`[${BOT_NAME}] Authenticated (playerId=${res.playerId}, personality=${PERSONALITY})`);
}

// ── Tool definitions (OpenAI function-calling format) ─────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_map',
      description: 'Fetch villages in a wider area than the pre-loaded closest-30. Use when scouting distant targets or planning long-range attacks.',
      parameters: {
        type: 'object',
        properties: {
          cx:     { type: 'number', description: 'Center X' },
          cy:     { type: 'number', description: 'Center Y' },
          radius: { type: 'number', description: 'Radius in tiles (max 250 for full world)' },
        },
        required: ['cx', 'cy', 'radius'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build',
      description: 'Queue a building upgrade (max 10 in queue). You can queue the same building multiple times for sequential level upgrades — e.g. call build("main") twice to queue main→4 then main→5 back to back.',
      parameters: {
        type: 'object',
        properties: {
          building:  { type: 'string', description: 'main|barracks|stable|garage|smith|place|statue|market|wood|stone|iron|farm|storage|hide|wall' },
          villageId: { type: 'number', description: 'Which of your villages to act on (omit to use first/only village)' },
        },
        required: ['building'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'train',
      description: 'Queue unit training.',
      parameters: {
        type: 'object',
        properties: {
          unit:      { type: 'string', description: 'spear|sword|axe|archer|spy|light|marcher|heavy|ram|catapult|knight|snob' },
          count:     { type: 'number', description: 'Number to train' },
          villageId: { type: 'number', description: 'Which of your villages to train in (omit for first/only)' },
        },
        required: ['unit', 'count'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attack',
      description: 'Send an attack. Survivors return with loot.',
      parameters: {
        type: 'object',
        properties: {
          toVillageId:    { type: 'number', description: 'Target village ID' },
          units:          { type: 'object', description: '{ "axe": 50, "spy": 1 }', additionalProperties: { type: 'number' } },
          catapultTarget: { type: 'string', description: 'Building for catapults to target (random if omitted)' },
          villageId:      { type: 'number', description: 'Which of your villages to attack from (omit for first/only)' },
        },
        required: ['toVillageId', 'units'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_trade',
      description: 'Post a trade offer (requires Market).',
      parameters: {
        type: 'object',
        properties: {
          offerRes:  { type: 'string', description: 'wood|clay|iron' },
          offerAmt:  { type: 'number' },
          wantRes:   { type: 'string', description: 'wood|clay|iron' },
          wantAmt:   { type: 'number' },
          villageId: { type: 'number', description: 'Village with the market to use (omit for first/only)' },
        },
        required: ['offerRes', 'offerAmt', 'wantRes', 'wantAmt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'accept_trade',
      description: "Accept a trade offer.",
      parameters: {
        type: 'object',
        properties: {
          offerId:   { type: 'number', description: 'Offer ID from get_trade_offers' },
          villageId: { type: 'number', description: 'Village to receive resources (omit for first/only)' },
        },
        required: ['offerId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_tribe',
      description: 'Create a new tribe. You become its leader.',
      parameters: {
        type: 'object',
        properties: {
          name:        { type: 'string', description: 'Tribe name' },
          tag:         { type: 'string', description: 'Short tag, max 8 chars e.g. "WAR"' },
          description: { type: 'string' },
        },
        required: ['name', 'tag'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'leave_tribe',
      description: 'Leave your current tribe. Leadership transfers automatically if you are the last leader.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'invite_to_tribe',
      description: 'Invite a player to your tribe. Leaders only. Player must not already be in a tribe.',
      parameters: {
        type: 'object',
        properties: {
          targetPlayerId: { type: 'number', description: 'Player ID to invite' },
        },
        required: ['targetPlayerId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'accept_invite',
      description: 'Accept a tribe invitation. Use the invite ID from your pending invites.',
      parameters: {
        type: 'object',
        properties: {
          inviteId: { type: 'number', description: 'Invite ID from pendingInvites in state' },
        },
        required: ['inviteId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'decline_invite',
      description: 'Decline a tribe invitation.',
      parameters: {
        type: 'object',
        properties: {
          inviteId: { type: 'number', description: 'Invite ID from pendingInvites in state' },
        },
        required: ['inviteId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kick_member',
      description: 'Remove a player from your tribe. Leaders only.',
      parameters: {
        type: 'object',
        properties: {
          targetPlayerId: { type: 'number', description: 'Player ID to kick' },
        },
        required: ['targetPlayerId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'promote_member',
      description: 'Promote a tribe member to leader role. Leaders only.',
      parameters: {
        type: 'object',
        properties: {
          targetPlayerId: { type: 'number', description: 'Player ID to promote' },
        },
        required: ['targetPlayerId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_diplomacy',
      description: 'Set your tribe\'s diplomatic status with another tribe. Leaders only.',
      parameters: {
        type: 'object',
        properties: {
          targetTribeId: { type: 'number', description: 'Target tribe ID' },
          status:        { type: 'string', description: 'ally | nap | war | null (to clear)' },
        },
        required: ['targetTribeId', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a private message to another player.',
      parameters: {
        type: 'object',
        properties: {
          toPlayerId: { type: 'number', description: 'Recipient ID (from get_players)' },
          subject:    { type: 'string' },
          text:       { type: 'string', description: 'Message body' },
        },
        required: ['toPlayerId', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_notes',
      description: 'Rewrite your private scratchpad — your only memory between turns. Call every turn. Track plans, threats, diplomacy, betrayals, noble progress.',
      parameters: {
        type: 'object',
        properties: {
          notes: { type: 'string', description: 'Full updated notes. Replaces previous entirely.' },
        },
        required: ['notes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'activate_militia',
      description: 'Spawn 20×farmLevel militia instantly. Lasts 6h/worldSpeed, halves production while active.',
      parameters: {
        type: 'object',
        properties: {
          villageId: { type: 'number', description: 'Which village to activate militia for (omit for first/only)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_support',
      description: 'Station troops at a friendly village to defend it until recalled.',
      parameters: {
        type: 'object',
        properties: {
          toVillageId: { type: 'number', description: 'Target village ID' },
          units:       { type: 'object', description: '{ "spear": 200 }', additionalProperties: { type: 'number' } },
          villageId:   { type: 'number', description: 'Which of your villages to send from (omit for first/only)' },
        },
        required: ['toVillageId', 'units'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_support',
      description: 'Recall stationed support troops back home.',
      parameters: {
        type: 'object',
        properties: {
          commandId: { type: 'number', description: 'Command ID from outgoingCommands in get_state' },
        },
        required: ['commandId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_forum',
      description: 'Post a message to your tribe forum (visible to all tribe members in get_state).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Post content' },
        },
        required: ['text'],
      },
    },
  },
];

// ── Building constants (fetched once at startup) ──────────────────────────────

let _buildingDefs = null;
let _unitDefs     = null;

async function fetchConstants() {
  const res = await GET('/game/constants');
  if (res.ok) {
    _buildingDefs = res.buildings;
    _unitDefs     = res.units;
  }
}

function upgradeCost(buildingId, currentLevel) {
  const b = _buildingDefs?.[buildingId];
  if (!b) return null;
  const nextLevel = currentLevel + 1;
  if (nextLevel > b.maxLevel) return null;
  const factor = Math.pow(b.costFactor, nextLevel - 1);
  return {
    wood: Math.round(b.baseCost.wood * factor),
    clay: Math.round(b.baseCost.clay * factor),
    iron: Math.round(b.baseCost.iron * factor),
    nextLevel,
  };
}

function populationUsed(village) {
  let pop = 0;
  if (_buildingDefs) {
    for (const [bid, level] of Object.entries(village.buildings ?? {})) {
      pop += (_buildingDefs[bid]?.popPerLevel ?? 0) * level;
    }
  }
  if (_unitDefs) {
    for (const [uid, count] of Object.entries(village.units ?? {})) {
      pop += (_unitDefs[uid]?.pop ?? 0) * count;
    }
    for (const item of village.trainQueue ?? []) {
      pop += (_unitDefs[item.unit]?.pop ?? 0) * item.count;
    }
  }
  return pop;
}

function allBuildCosts(village) {
  if (!_buildingDefs) return [];
  const out = [];
  for (const [bid] of Object.entries(_buildingDefs)) {
    const cur  = village.buildings?.[bid] ?? 0;
    const cost = upgradeCost(bid, cur);
    if (!cost) continue; // maxed out
    const dW = cost.wood  - Math.floor(village.wood);
    const dC = cost.clay  - Math.floor(village.clay);
    const dI = cost.iron  - Math.floor(village.iron);
    const canAfford = dW <= 0 && dC <= 0 && dI <= 0;
    if (canAfford) {
      out.push(`✓ ${bid}→${cost.nextLevel} W:${cost.wood} C:${cost.clay} I:${cost.iron}`);
    } else {
      const need = [dW > 0 && `+${dW}W`, dC > 0 && `+${dC}C`, dI > 0 && `+${dI}I`].filter(Boolean).join(' ');
      out.push(`✗ ${bid}→${cost.nextLevel} W:${cost.wood} C:${cost.clay} I:${cost.iron} [missing ${need}]`);
    }
  }
  return out;
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(name, input) {
  switch (name) {
    case 'get_map':          return GET(`/game/map?cx=${input.cx}&cy=${input.cy}&radius=${input.radius}`);
    case 'update_notes':
      notes = (input.notes ?? '').slice(0, MAX_NOTES_CHARS);
      writeFileSync(NOTES_FILE, notes, 'utf8');
      return { ok: true };
    case 'activate_militia': return POST('/game/militia/activate', { villageId: input.villageId });
    case 'send_support':     return POST('/game/support',          { toVillageId: input.toVillageId, units: input.units, villageId: input.villageId });
    case 'recall_support':   return POST('/game/support/recall',   { commandId: input.commandId });
    case 'build':            return POST('/game/build',            { building: input.building, villageId: input.villageId });
    case 'train':            return POST('/game/train',            { unit: input.unit, count: input.count, villageId: input.villageId });
    case 'attack':           return POST('/game/attack',           { toVillageId: input.toVillageId, units: input.units, catapultTarget: input.catapultTarget, villageId: input.villageId });
    case 'post_trade':       return POST('/game/trade/post',       { offerRes: input.offerRes, offerAmt: input.offerAmt, wantRes: input.wantRes, wantAmt: input.wantAmt, villageId: input.villageId });
    case 'accept_trade':     return POST('/game/trade/accept',     { offerId: input.offerId, villageId: input.villageId });
    case 'send_message':     return POST('/game/messages/send',    { toPlayerId: input.toPlayerId, subject: input.subject ?? '', text: input.text });
    case 'post_forum':       return POST('/game/tribe/forum',           { text: input.text });
    case 'create_tribe':     return POST('/game/tribe/create',          input);
    case 'leave_tribe':      return POST('/game/tribe/leave',           {});
    case 'invite_to_tribe':  return POST('/game/tribe/invite',          { targetPlayerId: input.targetPlayerId });
    case 'accept_invite':    return POST('/game/tribe/invite/accept',   { inviteId: input.inviteId });
    case 'decline_invite':   return POST('/game/tribe/invite/decline',  { inviteId: input.inviteId });
    case 'kick_member':      return POST('/game/tribe/kick',            { targetPlayerId: input.targetPlayerId });
    case 'promote_member':   return POST('/game/tribe/promote',         { targetPlayerId: input.targetPlayerId });
    case 'set_diplomacy':    return POST('/game/tribe/diplomacy',       { targetTribeId: input.targetTribeId, status: input.status });
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

// ── Bot turn ──────────────────────────────────────────────────────────────────

// Notes persist across turns — the bot's private strategic scratchpad.
const NOTES_FILE = join(__dir, 'notes', `${BOT_NAME.replace(/[^a-zA-Z0-9]/g, '_')}.txt`);
let notes = existsSync(NOTES_FILE) ? readFileSync(NOTES_FILE, 'utf8') : '';

async function callAPI(userContent) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.chat.completions.create({
        model:    MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userContent },
        ],
        tools: TOOLS,
      });
    } catch (err) {
      const status = err.status ?? err.statusCode ?? 0;
      if ((status === 429 || status >= 500) && attempt < 6) {
        const wait = Math.min(60_000 * Math.pow(2, attempt), 600_000)
                   * (0.75 + Math.random() * 0.5);
        const detail = err.message ?? '';
        console.log(`[${BOT_NAME}] ${status} — retry ${attempt + 1} in ${(wait/1000).toFixed(1)}s${detail ? ` (${detail})` : ''}`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

async function executeTools(toolCalls) {
  return Promise.all(toolCalls.map(async tc => {
    const input = JSON.parse(tc.function.arguments);
    console.log(`[${BOT_NAME}] → ${tc.function.name}(${tc.function.arguments})`);
    const result = await executeTool(tc.function.name, input);
    console.log(`[${BOT_NAME}] ← ${tc.function.name}: ${result.ok ? 'ok' : `ERROR: ${result.error}`}`);
    return { name: tc.function.name, input, result };
  }));
}

async function runTurn() {
  console.log(`\n[${BOT_NAME}] ── Turn start (${new Date().toLocaleTimeString()}) ──`);

  // Pre-fetch all context in parallel
  const [stateRes, msgsRes, reportsRes, tribesRes, playersRes] = await Promise.all([
    GET('/game/state'),
    GET('/game/messages?folder=inbox&offset=0'),
    GET('/game/reports?offset=0'),
    GET('/game/tribes'),
    GET('/game/players'),
  ]);

  // Fetch the full world map — all villages, ~200 entries, small enough to include every turn
  const mapRes = await GET('/game/map?cx=250&cy=250&radius=250');

  const myVillages = stateRes.myVillages ?? [];

  // Annotate map villages with distance, sort, take closest 30
  const allVillages = (mapRes?.villages ?? []).map(v => {
    const dist = myVillages.length
      ? Math.min(...myVillages.map(mv =>
          Math.round(Math.sqrt((v.x - mv.x) ** 2 + (v.y - mv.y) ** 2))
        ))
      : 999;
    return { ...v, dist };
  }).sort((a, b) => a.dist - b.dist);

  const nearbyRows = allVillages.slice(0, 30).map(v =>
    `${v.id} | ${v.name} | ${v.x}|${v.y} | pts:${v.points} | ${v.player_name ?? 'Barbarian'}(pid:${v.player_id ?? '-'}) | tribe:${v.tribe_tag ?? '-'} | ${v.is_npc ? 'npc' : 'player'} | dist:${v.dist}`
  ).join('\n');

  const tribesRows  = (tribesRes.tribes  ?? []).map(t => `id:${t.id} [${t.tag}] ${t.name} — ${t.member_count ?? 0} members`).join('\n');
  const playersRows = (playersRes.players ?? []).map(p => `pid:${p.id} ${p.name} [${p.tribe_tag ?? 'no tribe'}]`).join('\n');

  // Per-village computed summaries: storage cap, affordable builds
  const villageSummaries = myVillages.map(v => {
    const storLv  = v.buildings?.storage ?? 0;
    const storCap = STORAGE_CAPACITY[storLv]     ?? 0;
    const storNxt = STORAGE_CAPACITY[storLv + 1] ?? storCap;

    const farmLv  = v.buildings?.farm ?? 0;
    const farmCap = FARM_CAPACITY[farmLv]     ?? 0;
    const farmNxt = FARM_CAPACITY[farmLv + 1] ?? farmCap;
    const popUsed = populationUsed(v);
    const popFree = farmCap - popUsed;

    const now = Date.now();
    const qLen = v.buildQueue?.length ?? 0;
    const qSlotsFree = 10 - qLen;
    const inQueue = qLen
      ? v.buildQueue.map(q => {
          const secsLeft = Math.max(0, Math.round((q.finishTime - now) / 1000));
          return `${q.building}→${q.level} (${secsLeft}s)`;
        }).join(', ')
      : 'empty';
    const buildCosts = allBuildCosts(v);
    return [
      `Village ${v.id} "${v.name}":`,
      `  Resources: W:${Math.floor(v.wood)} C:${Math.floor(v.clay)} I:${Math.floor(v.iron)}`,
      `  Warehouse lv${storLv}: max ${storCap} → lv${storLv + 1}: max ${storNxt}`,
      `  Farm lv${farmLv}: cap ${farmCap}, used ${popUsed}, free ${popFree} → lv${farmLv + 1}: cap ${farmNxt}`,
      `  Build queue: ${qLen}/10 used, ${qSlotsFree} slot${qSlotsFree !== 1 ? 's' : ''} free — ${inQueue}`,
      `  Building costs (✓ = affordable now):\n${buildCosts.map(l => '    ' + l).join('\n')}`,
    ].join('\n');
  }).join('\n\n');

  // Pending tribe invites (invite IDs needed for accept_invite / decline_invite)
  const inviteRows = (stateRes.pendingInvites ?? []).map(inv =>
    `inviteId:${inv.id} — [${inv.tribe_tag}] ${inv.tribe_name} (invited by ${inv.inviter_name})`
  ).join('\n');

  const context = [
    `## Your villages\n${JSON.stringify(myVillages, null, 2)}`,
    `## Village summaries\n${villageSummaries || '(no villages)'}`,
    stateRes.tribe
      ? `## Your tribe\n${JSON.stringify(stateRes.tribe)}`
      : `## Your tribe\n(none — you can create_tribe or accept a pending invite)`,
    inviteRows ? `## Pending tribe invites\n${inviteRows}` : null,
    `## All tribes\n${tribesRows || '(none yet)'}`,
    `## All players (pid | name | tribe)\n${playersRows}`,
    `## Inbox (${msgsRes.messages?.length ?? 0} messages)\n${JSON.stringify(msgsRes.messages ?? [])}`,
    `## Recent battle reports\n${JSON.stringify(reportsRes.reports ?? [])}`,
    `## Nearby villages — closest 30 (id | name | coord | points | owner | tribe | type | dist)\n${nearbyRows}`,
  ].filter(Boolean).join('\n\n');

  const userMsg = `Your private notes:\n${notes || '(none)'}\n\n${context}\n\nTake your turn now. Call update_notes at the end.`;

  // ── Call 1: model sees full state, returns all actions ────────────────────
  const r1 = await callAPI(userMsg);
  const m1 = r1.choices[0].message;
  let tokens = r1.usage?.total_tokens ?? 0;

  if (m1.content?.trim()) console.log(`[${BOT_NAME}] ${m1.content.trim()}`);

  if (!m1.tool_calls?.length) return tokens;

  const results1 = await executeTools(m1.tool_calls);

  // ── Call 2 (only if any action failed): model sees failures, adjusts ──────
  const failures1 = results1.filter(r => !r.result.ok);
  let results2 = [];
  if (failures1.length) {
    const r2 = await callAPI(
      `${userMsg}\n\n## Actions you just attempted\n${results1.map(r => `${r.name}: ${r.result.ok ? 'ok' : 'FAILED — ' + r.result.error}`).join('\n')}\n\nSome actions failed. Adjust your plan and call update_notes with a corrected strategy.`
    );
    const m2 = r2.choices[0].message;
    tokens += r2.usage?.total_tokens ?? 0;
    if (m2.content?.trim()) console.log(`[${BOT_NAME}] ${m2.content.trim()}`);
    if (m2.tool_calls?.length) results2 = await executeTools(m2.tool_calls);
  }

  // Append all failures from both calls to notes so the bot remembers next turn.
  // Runs after update_notes, so the record survives regardless of what the model wrote.
  const allFailures = [...results1, ...results2].filter(r => !r.result.ok);
  if (allFailures.length) {
    const failLog = `\n\n[Failed actions @ ${new Date().toLocaleTimeString()}]\n`
      + allFailures.map(f => `• ${f.name}(${JSON.stringify(f.input)}): ${f.result.error}`).join('\n');
    notes = (notes + failLog).slice(-MAX_NOTES_CHARS);
    writeFileSync(NOTES_FILE, notes, 'utf8');
  }

  return tokens;
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  await ensureAuth();
  await fetchConstants();

  let busy = false;
  let stdinBuf = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async chunk => {
    stdinBuf += chunk;
    const lines = stdinBuf.split('\n');
    stdinBuf = lines.pop();
    for (const line of lines) {
      if (line.trim() !== 'TURN') continue;
      if (busy) continue; // already mid-turn, skip
      busy = true;
      try {
        await runTurn();
      } catch (err) {
        console.error(`[${BOT_NAME}] Turn error:`, err.message);
      } finally {
        busy = false;
        process.stdout.write('[DONE]\n');
      }
    }
  });
}

main();
