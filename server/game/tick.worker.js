// Tick worker — runs in its own thread so the main event loop is never blocked.
// Opens its own DatabaseSync connection.  All broadcasts go to the main thread
// via parentPort so it can route them to the right WebSocket connections.

import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { WORLD_SPEED } from '../config.js';
import { simulateBattle, calculateLoot, isScoutAttack } from '../../clone/src/engine/combat.js';
import { tickResources, storageCapacity, productionPerHour } from '../../clone/src/engine/resources.js';
import { processBuildQueue } from '../../clone/src/engine/construction.js';
import { processTrainQueue } from '../../clone/src/engine/training.js';
import { calculatePoints } from './points.js';

const __dir  = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '../game.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000'); // wait up to 5s if main thread is writing
db.exec('PRAGMA synchronous = NORMAL');

const TICK_INTERVAL = 2000;

const DOMINANCE_THRESHOLD  = 0.80;
const DOMINANCE_HOLD_MS    = Math.round(7 * 24 * 60 * 60 * 1000 / WORLD_SPEED);
const MIN_VILLAGES_FOR_WIN = 5;

const LOYALTY_REGEN_INTERVAL_MS = Math.round(3600 * 1000 / WORLD_SPEED);
const LOYALTY_REGEN_TICKS       = Math.round(LOYALTY_REGEN_INTERVAL_MS / TICK_INTERVAL);

const NPC_REGEN_INTERVAL_MS = Math.round(30 * 60 * 1000 / WORLD_SPEED);
const NPC_REGEN_TICKS       = Math.round(NPC_REGEN_INTERVAL_MS / TICK_INTERVAL);
const NPC_REGEN_HOURS       = NPC_REGEN_INTERVAL_MS / 3_600_000;

const DOMINANCE_CHECK_TICKS = Math.round(30000 / TICK_INTERVAL);

let _tickCount = 0;
let _gameWon   = false;

// ── Broadcast helpers ─────────────────────────────────────────────────────────
// During the main tick transaction broadcasts are queued and flushed after commit,
// so clients never receive stale data from a half-committed tick.
// Outside the transaction (periodic tasks) they fire immediately.

let _tickBroadcasts = null; // { direct: [], villageUpdates: [] } or null

function broadcast(playerId, data) {
  if (_tickBroadcasts) {
    _tickBroadcasts.direct.push({ playerId, data });
  } else {
    parentPort.postMessage({ type: 'broadcast', playerId, data });
  }
}

// Queue a VILLAGE_UPDATE for playerId.
// Inside the tick transaction: deferred until after commit so clients see committed state.
// Outside the transaction (periodic tasks): fires immediately.
function scheduleVillageUpdate(playerId, villageId) {
  if (!playerId) return;
  if (_tickBroadcasts) {
    _tickBroadcasts.villageUpdates.push({ playerId, villageId });
  } else {
    const v = loadVillage(villageId);
    if (v) parentPort.postMessage({ type: 'broadcast', playerId, data: { type: 'VILLAGE_UPDATE', village: publicVillage(v) } });
  }
}

// ── DB helpers (worker-local connection) ──────────────────────────────────────

// Load a single village, applying elapsed time to resources + queues.
// Used outside the main batch (periodic tasks, fresh post-commit reads, etc.)
function loadVillage(id) {
  const row = db.prepare('SELECT * FROM villages WHERE id = ?').get(id);
  if (!row) return null;

  const buildQueue = db.prepare(
    'SELECT * FROM build_queue WHERE village_id = ? ORDER BY finish_time'
  ).all(id).map(r => ({ building: r.building, level: r.level, finishTime: r.finish_time }));

  const trainQueue = db.prepare(
    'SELECT * FROM train_queue WHERE village_id = ? ORDER BY finish_time'
  ).all(id).map(r => ({ unit: r.unit, count: r.count, finishTime: r.finish_time }));

  const now = Date.now();
  const v = {
    id: row.id, playerId: row.player_id, name: row.name,
    x: row.x, y: row.y, isNpc: !!row.is_npc, points: row.points,
    lastTick: row.last_tick, loyalty: row.loyalty ?? 100,
    militiaActiveUntil: row.militia_active_until ?? null,
    buildings: JSON.parse(row.buildings), units: JSON.parse(row.units),
    buildQueue, trainQueue,
    wood: row.wood, clay: row.clay, iron: row.iron,
  };

  const resources            = tickResources(v, now, WORLD_SPEED);
  const { buildings, buildQueue: newBQ } = processBuildQueue(v, now);
  const { units,     trainQueue: newTQ } = processTrainQueue(v, now);

  return { ...v, ...resources, buildings: { ...v.buildings, ...buildings }, units, buildQueue: newBQ, trainQueue: newTQ, lastTick: now };
}

// Batch-load multiple villages in 3 queries instead of 3×N.
// Returns a map { [id]: villageObject }.
function batchLoadVillages(ids) {
  if (ids.length === 0) return {};
  const ph = ids.map(() => '?').join(',');

  const rows   = db.prepare(`SELECT * FROM villages WHERE id IN (${ph})`).all(...ids);
  const bqRows = db.prepare(`SELECT * FROM build_queue WHERE village_id IN (${ph}) ORDER BY finish_time`).all(...ids);
  const tqRows = db.prepare(`SELECT * FROM train_queue WHERE village_id IN (${ph}) ORDER BY finish_time`).all(...ids);

  const bqMap = {}, tqMap = {};
  for (const r of bqRows) (bqMap[r.village_id] ??= []).push({ building: r.building, level: r.level, finishTime: r.finish_time });
  for (const r of tqRows) (tqMap[r.village_id] ??= []).push({ unit: r.unit, count: r.count, finishTime: r.finish_time });

  const now = Date.now();
  const map = {};
  for (const row of rows) {
    const buildQueue = bqMap[row.id] ?? [];
    const trainQueue = tqMap[row.id] ?? [];
    const v = {
      id: row.id, playerId: row.player_id, name: row.name,
      x: row.x, y: row.y, isNpc: !!row.is_npc, points: row.points,
      lastTick: row.last_tick, loyalty: row.loyalty ?? 100,
      militiaActiveUntil: row.militia_active_until ?? null,
      buildings: JSON.parse(row.buildings), units: JSON.parse(row.units),
      buildQueue, trainQueue,
      wood: row.wood, clay: row.clay, iron: row.iron,
    };
    const resources            = tickResources(v, now, WORLD_SPEED);
    const { buildings, buildQueue: newBQ } = processBuildQueue(v, now);
    const { units,     trainQueue: newTQ } = processTrainQueue(v, now);
    map[row.id] = { ...v, ...resources, buildings: { ...v.buildings, ...buildings }, units, buildQueue: newBQ, trainQueue: newTQ, lastTick: now };
  }
  return map;
}

// Write a village to DB — no transaction wrapper; caller manages transactions.
function saveVillage(village) {
  const points = calculatePoints(village.buildings);

  db.prepare(`
    UPDATE villages SET wood=?, clay=?, iron=?, last_tick=?, buildings=?, units=?, points=?
    WHERE id=?
  `).run(village.wood, village.clay, village.iron, village.lastTick,
         JSON.stringify(village.buildings), JSON.stringify(village.units), points, village.id);

  db.prepare('DELETE FROM build_queue WHERE village_id = ?').run(village.id);
  const bqIns = db.prepare('INSERT INTO build_queue (village_id, building, level, finish_time) VALUES (?, ?, ?, ?)');
  for (const item of village.buildQueue) bqIns.run(village.id, item.building, item.level, item.finishTime);

  db.prepare('DELETE FROM train_queue WHERE village_id = ?').run(village.id);
  const tqIns = db.prepare('INSERT INTO train_queue (village_id, unit, count, finish_time) VALUES (?, ?, ?, ?)');
  for (const item of village.trainQueue) tqIns.run(village.id, item.unit, item.count, item.finishTime);
}

// ── Main tick ─────────────────────────────────────────────────────────────────

function tick() {
  _tickCount++;
  const now = Date.now();

  const arriving  = db.prepare("SELECT * FROM commands WHERE arrival_time <= ? AND status = 'traveling'").all(now);
  const returning = db.prepare("SELECT * FROM commands WHERE return_time <= ? AND status = 'returning'").all(now);

  // Pre-fetch all villages needed for this tick in 3 queries total.
  const neededIds = new Set();
  for (const cmd of [...arriving, ...returning]) {
    neededIds.add(cmd.from_village_id);
    neededIds.add(cmd.to_village_id);
  }
  const villageMap = batchLoadVillages([...neededIds]);

  // Accumulate broadcasts; flush after transaction commits so clients only see
  // committed state.
  _tickBroadcasts = { direct: [], villageUpdates: [] };

  db.exec('BEGIN');
  try {
    for (const cmd of arriving)  resolveCommand(cmd, villageMap, now);
    for (const cmd of returning) resolveReturn(cmd, villageMap);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('[tick-worker] Transaction failed:', e.message);
    _tickBroadcasts = null;
    return;
  }

  // Flush — send direct messages first, then batch-load villages for VILLAGE_UPDATE.
  const { direct, villageUpdates } = _tickBroadcasts;
  _tickBroadcasts = null;

  for (const { playerId, data } of direct) {
    parentPort.postMessage({ type: 'broadcast', playerId, data });
  }

  if (villageUpdates.length > 0) {
    // Dedupe: load each village once, send to each unique player that asked for it.
    const uniqueVillageIds = [...new Set(villageUpdates.map(u => u.villageId))];
    const freshMap = batchLoadVillages(uniqueVillageIds);

    const sent = new Set();
    for (const { playerId, villageId } of villageUpdates) {
      const key = `${playerId}:${villageId}`;
      if (sent.has(key)) continue;
      sent.add(key);
      const v = freshMap[villageId];
      if (v) parentPort.postMessage({ type: 'broadcast', playerId, data: { type: 'VILLAGE_UPDATE', village: publicVillage(v) } });
    }
  }

  // ── Periodic tasks (outside main transaction) ─────────────────────────────

  if (_tickCount % LOYALTY_REGEN_TICKS === 0) {
    db.prepare(`UPDATE villages SET loyalty = MIN(100, loyalty + 1)
                WHERE is_npc = 0 AND player_id IS NOT NULL AND loyalty < 100`).run();
  }

  if (_tickCount % 30 === 0) expireOldMilitia(now);
  if (_tickCount % NPC_REGEN_TICKS === 0) regenNpcResources();
  if (!_gameWon && _tickCount % DOMINANCE_CHECK_TICKS === 0) checkDominance(now);
}

// ── Command resolution ────────────────────────────────────────────────────────

function resolveCommand(cmd, villageMap, now) {
  if (cmd.type === 'support') { resolveSupport(cmd, villageMap); return; }

  const attackUnits = JSON.parse(cmd.units);
  const defVillage  = villageMap[cmd.to_village_id];
  if (!defVillage) { db.prepare("UPDATE commands SET status='completed' WHERE id=?").run(cmd.id); return; }

  if (isScoutAttack(attackUnits)) { resolveScout(cmd, defVillage, attackUnits, now); return; }

  const atkVillage = villageMap[cmd.from_village_id];

  const supportRows = db.prepare(
    "SELECT id, units FROM commands WHERE to_village_id=? AND type='support' AND status='stationed'"
  ).all(defVillage.id);

  const allDefenders = { ...defVillage.units };
  for (const s of supportRows) {
    for (const [uid, n] of Object.entries(JSON.parse(s.units)))
      allDefenders[uid] = (allDefenders[uid] ?? 0) + n;
  }

  const result = simulateBattle(attackUnits, allDefenders, defVillage.buildings.wall ?? 0, {
    attackerSmithLevel: atkVillage?.buildings.smith ?? 0,
    defenderSmithLevel: defVillage.buildings.smith ?? 0,
    attackerPoints:     atkVillage?.points ?? 0,
    defenderPoints:     defVillage.points ?? 0,
  });

  const loot = calculateLoot(defVillage, result.attackerSurvivors, defVillage.buildings.hide ?? 0);

  // Distribute defender losses between own troops and support
  if (supportRows.length > 0 && result.defSurvivalRatio < 1) {
    for (const s of supportRows) {
      const surviving = {};
      for (const [uid, n] of Object.entries(JSON.parse(s.units)))
        surviving[uid] = Math.round(n * result.defSurvivalRatio);
      if (Object.values(surviving).some(n => n > 0))
        db.prepare("UPDATE commands SET units=? WHERE id=?").run(JSON.stringify(surviving), s.id);
      else
        db.prepare("UPDATE commands SET status='completed' WHERE id=?").run(s.id);
    }
    const ownSurvivors = {};
    for (const [uid, n] of Object.entries(defVillage.units))
      ownSurvivors[uid] = Math.round(n * result.defSurvivalRatio);
    result.defenderSurvivors = ownSurvivors;
  }

  const noblesIn = attackUnits.snob ?? 0;
  if (noblesIn > 0 && result.attackerWon && (result.attackerSurvivors.snob ?? 0) > 0) {
    const drop       = Math.floor(Math.random() * 16) + 20;
    const newLoyalty = (defVillage.loyalty ?? 100) - drop;
    if (newLoyalty <= 0) { resolveConquest(cmd, defVillage, result, loot, now); return; }
    db.prepare('UPDATE villages SET loyalty=? WHERE id=?').run(Math.max(1, newLoyalty), defVillage.id);
    finishNormalResolution(cmd, defVillage, result, loot, now,
      { loyaltyBefore: defVillage.loyalty ?? 100, loyaltyAfter: Math.max(1, newLoyalty) });
    return;
  }

  finishNormalResolution(cmd, defVillage, result, loot, now, {});
}

function finishNormalResolution(cmd, defVillage, result, loot, now, extra) {
  const catapultCount = result.attackerSurvivors.catapult ?? 0;
  let catapultDamage  = null;

  if (catapultCount > 0 && result.attackerWon) {
    const target = selectCatapultTarget(cmd.catapult_target, defVillage.buildings);
    if (target) {
      const cur    = defVillage.buildings[target] ?? 0;
      const damage = Math.max(1, Math.min(cur, Math.round(catapultCount * cur * (0.008 + Math.random() * 0.012))));
      defVillage.buildings = { ...defVillage.buildings, [target]: cur - damage };
      catapultDamage = { building: target, levelBefore: cur, levelAfter: cur - damage };
    }
  }

  saveVillage({
    ...defVillage,
    units: result.defenderSurvivors,
    wood:  Math.max(0, defVillage.wood - loot.wood),
    clay:  Math.max(0, defVillage.clay - loot.clay),
    iron:  Math.max(0, defVillage.iron - loot.iron),
  });

  if (result.wallDamage > 0) {
    db.prepare('UPDATE villages SET buildings=? WHERE id=?').run(
      JSON.stringify({ ...defVillage.buildings, wall: Math.max(0, (defVillage.buildings.wall ?? 0) - result.wallDamage) }),
      defVillage.id,
    );
  }

  const hasReturn = Object.values(result.attackerSurvivors).some(n => n > 0);
  if (hasReturn) {
    const travelSecs = Math.round((cmd.arrival_time - cmd.created_at) / 1000);
    db.prepare("UPDATE commands SET status='returning', return_time=?, units=?, loot=? WHERE id=?")
      .run(now + travelSecs * 1000, JSON.stringify(result.attackerSurvivors), JSON.stringify(loot), cmd.id);
  } else {
    db.prepare("UPDATE commands SET status='completed', loot=? WHERE id=?").run(JSON.stringify(loot), cmd.id);
  }

  emitReports(cmd, defVillage, result, loot, false, { ...extra, catapultDamage });
}

function selectCatapultTarget(requested, buildings) {
  if (requested && (buildings[requested] ?? 0) > 0) return requested;
  const eligible = Object.entries(buildings).filter(([, lvl]) => lvl > 0).map(([id]) => id);
  return eligible.length ? eligible[Math.floor(Math.random() * eligible.length)] : null;
}

// ── Support resolution ────────────────────────────────────────────────────────

function resolveSupport(cmd, villageMap) {
  db.prepare("UPDATE commands SET status='stationed' WHERE id=?").run(cmd.id);

  const fromInfo = db.prepare('SELECT player_id FROM villages WHERE id=?').get(cmd.from_village_id);
  const toInfo   = db.prepare('SELECT player_id FROM villages WHERE id=?').get(cmd.to_village_id);

  if (toInfo?.player_id)   scheduleVillageUpdate(toInfo.player_id,   cmd.to_village_id);
  if (fromInfo?.player_id) scheduleVillageUpdate(fromInfo.player_id, cmd.from_village_id);
}

// ── Scout resolution ──────────────────────────────────────────────────────────

function resolveScout(cmd, defVillage, attackUnits, now) {
  const sentScouts      = attackUnits.spy ?? 0;
  const defendingScouts = defVillage.units.spy ?? 0;

  let survivalRate, scoutWon;
  if (defendingScouts === 0) {
    survivalRate = 0.6 + Math.random() * 0.4;
    scoutWon     = true;
  } else {
    const atkPow = sentScouts      * (0.85 + Math.random() * 0.3);
    const defPow = defendingScouts * (0.85 + Math.random() * 0.3);
    scoutWon     = atkPow > defPow;
    survivalRate = scoutWon ? (atkPow - defPow) / atkPow * 0.8 : 0;
    if (scoutWon) {
      const defSurviving = Math.round(defendingScouts * 0.3);
      saveVillage({ ...defVillage, units: { ...defVillage.units, spy: defSurviving } });
    }
  }

  const survivingScouts = Math.round(sentScouts * survivalRate);
  let intel = null;
  if (scoutWon && survivingScouts > 0) {
    intel = { units: defVillage.units };
    if (survivalRate >= 0.5) intel.resources = { wood: Math.round(defVillage.wood), clay: Math.round(defVillage.clay), iron: Math.round(defVillage.iron) };
    if (survivalRate >= 0.7) intel.buildings = defVillage.buildings;
  }

  if (survivingScouts > 0) {
    const travelSecs = Math.round((cmd.arrival_time - cmd.created_at) / 1000);
    db.prepare("UPDATE commands SET status='returning', return_time=?, units=?, loot='{}' WHERE id=?")
      .run(now + travelSecs * 1000, JSON.stringify({ spy: survivingScouts }), cmd.id);
  } else {
    db.prepare("UPDATE commands SET status='completed', loot='{}' WHERE id=?").run(cmd.id);
  }

  const atkInfo = db.prepare(`
    SELECT v.name, v.player_id, p.name as player_name
    FROM villages v LEFT JOIN players p ON p.id=v.player_id WHERE v.id=?
  `).get(cmd.from_village_id);

  if (atkInfo?.player_id) {
    const title = scoutWon ? `Scout report — ${defVillage.name}` : `Scouts defeated at ${defVillage.name}`;
    db.prepare('INSERT INTO reports (player_id, type, title, data) VALUES (?, ?, ?, ?)')
      .run(atkInfo.player_id, 'scout', title, JSON.stringify({
        type: 'scout', scoutWon, survivalRate, sentScouts, survivingScouts,
        targetVillageId: defVillage.id, targetVillageName: defVillage.name, intel,
      }));
    broadcast(atkInfo.player_id, { type: 'REPORT_UNREAD' });
    scheduleVillageUpdate(atkInfo.player_id, cmd.from_village_id);
  }
}

// ── Noble conquest ────────────────────────────────────────────────────────────

function resolveConquest(cmd, defVillage, battleResult, loot, now) {
  const atkRow      = db.prepare('SELECT player_id, name FROM villages WHERE id=?').get(cmd.from_village_id);
  const prevOwnerId = defVillage.playerId;

  const garrison   = { ...battleResult.attackerSurvivors, snob: Math.max(0, (battleResult.attackerSurvivors.snob ?? 0) - 1) };

  db.prepare(`
    UPDATE villages SET player_id=?, loyalty=25, units=?, wood=?, clay=?, iron=?, last_tick=? WHERE id=?
  `).run(atkRow?.player_id ?? null, JSON.stringify(garrison),
         Math.max(0, defVillage.wood - loot.wood), Math.max(0, defVillage.clay - loot.clay),
         Math.max(0, defVillage.iron - loot.iron), now, defVillage.id);

  db.prepare("UPDATE commands SET status='completed', loot=? WHERE id=?").run(JSON.stringify(loot), cmd.id);
  db.prepare("UPDATE commands SET status='returning', return_time=? WHERE to_village_id=? AND type='support' AND status='stationed'")
    .run(now + 60000, defVillage.id);

  emitReports(cmd, defVillage, battleResult, loot, true,
    { loyaltyBefore: defVillage.loyalty ?? 100, loyaltyAfter: 0, conquered: true });

  if (atkRow?.player_id) scheduleVillageUpdate(atkRow.player_id, defVillage.id);

  if (prevOwnerId) {
    broadcast(prevOwnerId, { type: 'VILLAGE_LOST', villageId: defVillage.id, villageName: defVillage.name, byPlayer: atkRow?.name ?? 'unknown' });
    broadcast(prevOwnerId, { type: 'REPORT_UNREAD' });
    const remaining = db.prepare('SELECT COUNT(*) as n FROM villages WHERE player_id=?').get(prevOwnerId).n;
    if (remaining === 0) respawnPlayer(prevOwnerId, now);
  }
}

function respawnPlayer(playerId, now) {
  const npc = db.prepare(
    'SELECT id FROM villages WHERE is_npc=1 AND player_id IS NULL ORDER BY (x-250)*(x-250)+(y-250)*(y-250) LIMIT 1'
  ).get();
  if (!npc) return;
  const startBuildingsObj = { main:1,barracks:0,stable:0,garage:0,snob:0,smith:0,place:0,statue:0,market:0,wood:1,stone:1,iron:1,farm:1,storage:1,hide:0,wall:0 };
  const startUnitsObj     = { spear:0,sword:0,axe:0,archer:0,spy:0,light:0,marcher:0,heavy:0,ram:0,catapult:0,knight:0,snob:0,militia:0 };
  const startPoints       = calculatePoints(startBuildingsObj);
  db.prepare(`UPDATE villages SET player_id=?, is_npc=0, loyalty=100, wood=500, clay=500, iron=400, buildings=?, units=?, last_tick=?, points=? WHERE id=?`)
    .run(playerId, JSON.stringify(startBuildingsObj), JSON.stringify(startUnitsObj), now, startPoints, npc.id);
  broadcast(playerId, { type: 'RESPAWNED', villageId: npc.id });
  console.log(`[tick-worker] Player ${playerId} respawned at village ${npc.id}`);
}

// ── Returning troops ──────────────────────────────────────────────────────────

function resolveReturn(cmd, villageMap) {
  const returningUnits = JSON.parse(cmd.units);
  const loot           = cmd.loot ? JSON.parse(cmd.loot) : {};
  const homeVillage    = villageMap[cmd.from_village_id];
  if (!homeVillage) { db.prepare("UPDATE commands SET status='completed' WHERE id=?").run(cmd.id); return; }

  const newUnits = { ...homeVillage.units };
  for (const [uid, n] of Object.entries(returningUnits)) newUnits[uid] = (newUnits[uid] ?? 0) + (n ?? 0);

  const cap = storageCapacity(homeVillage.buildings.storage ?? 0);
  saveVillage({
    ...homeVillage,
    units: newUnits,
    wood: Math.min(cap, homeVillage.wood + (loot.wood ?? 0)),
    clay: Math.min(cap, homeVillage.clay + (loot.clay ?? 0)),
    iron: Math.min(cap, homeVillage.iron + (loot.iron ?? 0)),
  });
  db.prepare("UPDATE commands SET status='completed' WHERE id=?").run(cmd.id);

  const info = db.prepare('SELECT player_id FROM villages WHERE id=?').get(cmd.from_village_id);
  if (info?.player_id) scheduleVillageUpdate(info.player_id, cmd.from_village_id);
}

// ── Reports ───────────────────────────────────────────────────────────────────

function emitReports(cmd, defVillage, result, loot, isConquest, extra) {
  const atkInfo = db.prepare(`
    SELECT v.name, v.player_id, p.name as player_name FROM villages v LEFT JOIN players p ON p.id=v.player_id WHERE v.id=?
  `).get(cmd.from_village_id);
  const defInfo = db.prepare(`
    SELECT v.name, v.player_id, p.name as player_name FROM villages v LEFT JOIN players p ON p.id=v.player_id WHERE v.id=?
  `).get(cmd.to_village_id);

  const data = JSON.stringify({
    type: 'attack',
    attackerVillageId: cmd.from_village_id, attackerVillageName: atkInfo?.name, attackerPlayerName: atkInfo?.player_name,
    defenderVillageId: cmd.to_village_id,   defenderVillageName: defVillage.name, defenderPlayerName: defInfo?.player_name,
    attackersBefore: JSON.parse(cmd.units), attackersSurvived: result.attackerSurvivors,
    defendersBefore: defVillage.units,      defendersSurvived: result.defenderSurvivors,
    luck: result.luckPercent, morale: result.morale,
    wallLevel: defVillage.buildings.wall ?? 0, wallDamage: result.wallDamage,
    loot, ...extra,
  });

  if (atkInfo?.player_id) {
    const title = isConquest ? `Conquered ${defVillage.name}!`
      : result.attackerWon ? `Victory! Attack on ${defVillage.name}` : `Defeat — Attack on ${defVillage.name}`;
    db.prepare('INSERT INTO reports (player_id, type, title, data) VALUES (?, ?, ?, ?)').run(atkInfo.player_id, 'attack', title, data);
    broadcast(atkInfo.player_id, { type: 'REPORT_UNREAD' });
    scheduleVillageUpdate(atkInfo.player_id, cmd.from_village_id);
  }

  if (defInfo?.player_id) {
    const title = isConquest ? `${atkInfo?.player_name ?? 'Unknown'} conquered your village ${defVillage.name}!`
      : result.attackerWon ? `Defeat — Incoming attack from ${atkInfo?.player_name ?? 'unknown'}`
      : `Victory! Repelled attack from ${atkInfo?.player_name ?? 'unknown'}`;
    db.prepare('INSERT INTO reports (player_id, type, title, data) VALUES (?, ?, ?, ?)').run(defInfo.player_id, 'defense', title, data);
    broadcast(defInfo.player_id, { type: 'REPORT_UNREAD' });
    if (!isConquest) scheduleVillageUpdate(defInfo.player_id, cmd.to_village_id);
  }
}

// ── Periodic: militia expiry ──────────────────────────────────────────────────

function expireOldMilitia(now) {
  const expired = db.prepare('SELECT id FROM villages WHERE militia_active_until IS NOT NULL AND militia_active_until <= ?').all(now);
  for (const row of expired) {
    const v = loadVillage(row.id);
    if (!v) continue;
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE villages SET militia_active_until=NULL WHERE id=?').run(row.id);
      saveVillage({ ...v, units: { ...v.units, militia: 0 } });
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} continue; }
    const info = db.prepare('SELECT player_id FROM villages WHERE id=?').get(row.id);
    if (info?.player_id) {
      const fresh = loadVillage(row.id);
      if (fresh) parentPort.postMessage({ type: 'broadcast', playerId: info.player_id, data: { type: 'VILLAGE_UPDATE', village: publicVillage(fresh) } });
    }
  }
}

// ── Periodic: NPC resource regen ──────────────────────────────────────────────

function regenNpcResources() {
  const npcs  = db.prepare('SELECT id, buildings, wood, clay, iron FROM villages WHERE is_npc=1').all();
  const stmt  = db.prepare('UPDATE villages SET wood=?, clay=?, iron=? WHERE id=?');
  const CAPS  = [0,1000,1229,1512,1859,2285,2810,3454,4247,5222,6420,7893,9710,11943,14684,18055,22204,27304,33580,41293,50800,62475,76810,94476,116176,142880,175735,216079,265720,326800,400000];

  db.exec('BEGIN');
  try {
    for (const npc of npcs) {
      const b   = JSON.parse(npc.buildings);
      const cap = CAPS[Math.min(b.storage ?? 0, 30)] ?? 400000;
      stmt.run(
        Math.min(cap, npc.wood + productionPerHour(b.wood  ?? 0, WORLD_SPEED) * NPC_REGEN_HOURS),
        Math.min(cap, npc.clay + productionPerHour(b.stone ?? 0, WORLD_SPEED) * NPC_REGEN_HOURS),
        Math.min(cap, npc.iron + productionPerHour(b.iron  ?? 0, WORLD_SPEED) * NPC_REGEN_HOURS),
        npc.id,
      );
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} }
}

// ── Dominance / win condition ─────────────────────────────────────────────────

function checkDominance(now) {
  const total = db.prepare('SELECT COUNT(*) as n FROM villages WHERE is_npc=0 AND player_id IS NOT NULL').get().n;
  if (total < MIN_VILLAGES_FOR_WIN) return;

  const top = db.prepare(`
    SELECT p.tribe_id, COUNT(*) as n FROM villages v JOIN players p ON p.id=v.player_id
    WHERE v.is_npc=0 AND p.tribe_id IS NOT NULL GROUP BY p.tribe_id ORDER BY n DESC LIMIT 1
  `).get();

  if (!top || top.n / total < DOMINANCE_THRESHOLD) {
    db.prepare("DELETE FROM world_state WHERE key IN ('dominance_tribe_id','dominance_since')").run();
    return;
  }

  const storedId    = db.prepare("SELECT value FROM world_state WHERE key='dominance_tribe_id'").get()?.value;
  const storedSince = db.prepare("SELECT value FROM world_state WHERE key='dominance_since'").get()?.value;

  if (storedId !== String(top.tribe_id)) {
    db.prepare("INSERT OR REPLACE INTO world_state (key,value) VALUES ('dominance_tribe_id',?)").run(String(top.tribe_id));
    db.prepare("INSERT OR REPLACE INTO world_state (key,value) VALUES ('dominance_since',?)").run(String(now));
    const tribe = db.prepare('SELECT name, tag FROM tribes WHERE id=?').get(top.tribe_id);
    console.log(`[tick-worker] [${tribe?.tag}] ${tribe?.name} reached ${(top.n / total * 100).toFixed(1)}% dominance`);
    return;
  }

  if (now - parseInt(storedSince, 10) >= DOMINANCE_HOLD_MS) declareWinner(top.tribe_id, top.n, total);
}

function declareWinner(tribeId, villageCount, total) {
  _gameWon = true;
  const tribe = db.prepare('SELECT name, tag FROM tribes WHERE id=?').get(tribeId);
  db.prepare("INSERT OR REPLACE INTO world_state (key,value) VALUES ('game_won_tribe_id',?)").run(String(tribeId));
  const msg = { type: 'GAME_WON', tribeId, tribeName: tribe?.name, tribeTag: tribe?.tag, villageCount, totalVillages: total, percentage: Math.round(villageCount / total * 100) };
  console.log(`[tick-worker] GAME WON — [${tribe?.tag}] ${tribe?.name} controls ${msg.percentage}%`);
  for (const p of db.prepare('SELECT id FROM players').all()) parentPort.postMessage({ type: 'broadcast', playerId: p.id, data: msg });
}

// ── publicVillage + helpers ───────────────────────────────────────────────────

function publicVillage(v) {
  return {
    id: v.id, name: v.name, x: v.x, y: v.y, playerId: v.playerId,
    wood: v.wood, clay: v.clay, iron: v.iron, lastTick: v.lastTick,
    loyalty: v.loyalty ?? 100, militiaActiveUntil: v.militiaActiveUntil ?? null,
    buildings: v.buildings, units: v.units,
    buildQueue: v.buildQueue, trainQueue: v.trainQueue, points: v.points,
    outgoingCommands: getOutgoingCommands(v.id),
    incomingCommands: getIncomingCommands(v.id),
    stationedSupport: getStationedSupport(v.id),
  };
}

function getOutgoingCommands(vid) {
  return db.prepare(`
    SELECT c.id, c.to_village_id, c.units, c.type, c.arrival_time, c.return_time, c.status,
           v.name as target_name, v.x as target_x, v.y as target_y
    FROM commands c JOIN villages v ON v.id=c.to_village_id
    WHERE c.from_village_id=? AND c.status IN ('traveling','returning','stationed')
  `).all(vid).map(r => ({ id: r.id, toVillageId: r.to_village_id, units: JSON.parse(r.units), type: r.type, arrivalTime: r.arrival_time, returnTime: r.return_time, status: r.status, targetName: r.target_name, targetX: r.target_x, targetY: r.target_y }));
}

function getIncomingCommands(vid) {
  return db.prepare(`
    SELECT c.id, c.from_village_id, c.type, c.arrival_time,
           v.name as origin_name, v.x as origin_x, v.y as origin_y
    FROM commands c JOIN villages v ON v.id=c.from_village_id
    WHERE c.to_village_id=? AND c.status='traveling' AND c.type='attack'
  `).all(vid).map(r => ({ id: r.id, fromVillageId: r.from_village_id, type: r.type, arrivalTime: r.arrival_time, originName: r.origin_name, originX: r.origin_x, originY: r.origin_y }));
}

function getStationedSupport(vid) {
  return db.prepare(`
    SELECT c.id, c.from_village_id, c.units, v.name as origin_name, p.name as player_name
    FROM commands c JOIN villages v ON v.id=c.from_village_id LEFT JOIN players p ON p.id=v.player_id
    WHERE c.to_village_id=? AND c.type='support' AND c.status='stationed'
  `).all(vid).map(r => ({ id: r.id, fromVillageId: r.from_village_id, units: JSON.parse(r.units), originName: r.origin_name, playerName: r.player_name }));
}

// ── Start ─────────────────────────────────────────────────────────────────────

const saved = db.prepare("SELECT value FROM world_state WHERE key='game_won_tribe_id'").get();
if (saved) _gameWon = true;

setInterval(tick, TICK_INTERVAL);
console.log('[tick-worker] Game loop started');
