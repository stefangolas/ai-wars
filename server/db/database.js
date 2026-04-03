import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WORLD_SPEED as _WORLD_SPEED } from '../config.js';

const __dir = dirname(fileURLToPath(import.meta.url));

export const db = new DatabaseSync(join(__dir, '../game.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000'); // wait up to 5s if tick worker is writing
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA synchronous = NORMAL');

// Run schema (CREATE IF NOT EXISTS — safe to run every startup)
const schema = readFileSync(join(__dir, 'schema.sql'), 'utf8');
db.exec(schema);

// ── Migrations (safe to run on existing DBs) ──────────────────────────────────
try { db.exec('ALTER TABLE villages ADD COLUMN loyalty INTEGER NOT NULL DEFAULT 100'); } catch {}
try { db.exec('ALTER TABLE villages ADD COLUMN militia_active_until INTEGER'); } catch {}
try { db.exec('ALTER TABLE commands ADD COLUMN catapult_target TEXT'); } catch {}
try { db.exec('ALTER TABLE players ADD COLUMN tribe_role TEXT DEFAULT NULL'); } catch {}
try { db.exec('ALTER TABLE players ADD COLUMN registration_ip TEXT'); } catch {}
try { db.exec(`CREATE TABLE IF NOT EXISTS tribe_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id   INTEGER NOT NULL REFERENCES tribes(id)  ON DELETE CASCADE,
  inviter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(tribe_id, invitee_id)
)`); } catch {}
// (world_state table is created by schema above)

// ── Transaction helper ─────────────────────────────────────────────────────────
// Wraps a function in BEGIN/COMMIT/ROLLBACK, mirroring better-sqlite3's API.

export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  };
}

// ── Village helpers ────────────────────────────────────────────────────────────

import { tickResources }       from '../../clone/src/engine/resources.js';
import { processBuildQueue }   from '../../clone/src/engine/construction.js';
import { processTrainQueue }   from '../../clone/src/engine/training.js';
import { calculatePoints }     from '../game/points.js';

export const WORLD_SPEED = _WORLD_SPEED;

// Load a village from DB, applying elapsed time to resources and processing queues.
// Returns a plain object ready to send to clients or pass into engine functions.
export function loadVillage(villageId) {
  const row = db.prepare('SELECT * FROM villages WHERE id = ?').get(villageId);
  if (!row) return null;

  const buildQueue = db.prepare(
    'SELECT * FROM build_queue WHERE village_id = ? ORDER BY finish_time'
  ).all(villageId).map(r => ({ building: r.building, level: r.level, finishTime: r.finish_time }));

  const trainQueue = db.prepare(
    'SELECT * FROM train_queue WHERE village_id = ? ORDER BY finish_time'
  ).all(villageId).map(r => ({ unit: r.unit, count: r.count, finishTime: r.finish_time }));

  const now = Date.now();
  const village = {
    id:        row.id,
    playerId:  row.player_id,
    name:      row.name,
    x:         row.x,
    y:         row.y,
    isNpc:     !!row.is_npc,
    points:    row.points,
    lastTick:  row.last_tick,
    loyalty:            row.loyalty ?? 100,
    militiaActiveUntil: row.militia_active_until ?? null,
    buildings: JSON.parse(row.buildings),
    units:     JSON.parse(row.units),
    buildQueue,
    trainQueue,
    wood: row.wood,
    clay: row.clay,
    iron: row.iron,
  };

  // Apply elapsed time
  const resources               = tickResources(village, now, WORLD_SPEED);
  const { buildings, buildQueue: newBQ } = processBuildQueue(village, now);
  const { units,     trainQueue: newTQ } = processTrainQueue(village, now);

  return {
    ...village,
    ...resources,
    buildings: { ...village.buildings, ...buildings },
    units,
    buildQueue: newBQ,
    trainQueue: newTQ,
    lastTick:   now,
  };
}

// Persist a village object back to the database inside a transaction.
export const saveVillage = transaction(village => {
  const points = calculatePoints(village.buildings);

  db.prepare(`
    UPDATE villages
    SET wood=?, clay=?, iron=?, last_tick=?, buildings=?, units=?, points=?
    WHERE id=?
  `).run(
    village.wood, village.clay, village.iron, village.lastTick,
    JSON.stringify(village.buildings), JSON.stringify(village.units),
    points, village.id,
  );

  db.prepare('DELETE FROM build_queue WHERE village_id = ?').run(village.id);
  const bqInsert = db.prepare(
    'INSERT INTO build_queue (village_id, building, level, finish_time) VALUES (?, ?, ?, ?)'
  );
  for (const item of village.buildQueue) {
    bqInsert.run(village.id, item.building, item.level, item.finishTime);
  }

  db.prepare('DELETE FROM train_queue WHERE village_id = ?').run(village.id);
  const tqInsert = db.prepare(
    'INSERT INTO train_queue (village_id, unit, count, finish_time) VALUES (?, ?, ?, ?)'
  );
  for (const item of village.trainQueue) {
    tqInsert.run(village.id, item.unit, item.count, item.finishTime);
  }
});


// Get public info about a village (for map/diplomacy — no troops/resources)
export function getPublicVillageInfo(villageId) {
  const row = db.prepare(`
    SELECT v.id, v.name, v.x, v.y, v.points, v.is_npc,
           p.id as player_id, p.name as player_name,
           t.tag as tribe_tag, t.id as tribe_id
    FROM villages v
    LEFT JOIN players p ON p.id = v.player_id
    LEFT JOIN tribes  t ON t.id = p.tribe_id
    WHERE v.id = ?
  `).get(villageId);
  return row ?? null;
}
