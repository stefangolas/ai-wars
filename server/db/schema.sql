-- Tribal Wars Clone — SQLite schema
-- All timestamps are Unix milliseconds (Date.now())

CREATE TABLE IF NOT EXISTS players (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    UNIQUE NOT NULL COLLATE NOCASE,
  password_hash    TEXT    NOT NULL,
  tribe_id         INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  registration_ip  TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS tribes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    UNIQUE NOT NULL,
  tag         TEXT    UNIQUE NOT NULL COLLATE NOCASE,
  description TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS diplomacy (
  tribe_id        INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  target_tribe_id INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  status          TEXT    NOT NULL, -- 'ally' | 'nap' | 'war'
  PRIMARY KEY (tribe_id, target_tribe_id)
);

CREATE TABLE IF NOT EXISTS tribe_forum (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id    INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_name TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS villages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  name      TEXT    NOT NULL,
  x         INTEGER NOT NULL,
  y         INTEGER NOT NULL,
  wood      REAL    NOT NULL DEFAULT 2000,
  clay      REAL    NOT NULL DEFAULT 2000,
  iron      REAL    NOT NULL DEFAULT 2000,
  last_tick INTEGER NOT NULL,
  buildings TEXT    NOT NULL DEFAULT '{}',
  units     TEXT    NOT NULL DEFAULT '{}',
  is_npc    INTEGER NOT NULL DEFAULT 0,
  points    INTEGER NOT NULL DEFAULT 26,
  loyalty   INTEGER NOT NULL DEFAULT 100,
  UNIQUE(x, y)
);

-- World-level state: dominance tracking, win condition
CREATE TABLE IF NOT EXISTS world_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS build_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id  INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  building    TEXT    NOT NULL,
  level       INTEGER NOT NULL,
  finish_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS train_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id  INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  unit        TEXT    NOT NULL,
  count       INTEGER NOT NULL,
  finish_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commands (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  to_village_id   INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  units           TEXT    NOT NULL, -- JSON { spear: 100, ... }
  type            TEXT    NOT NULL DEFAULT 'attack', -- 'attack' | 'support'
  arrival_time    INTEGER NOT NULL,
  return_time     INTEGER,          -- set after battle if troops return
  status          TEXT    NOT NULL DEFAULT 'traveling', -- 'traveling' | 'returning' | 'stationed' | 'completed'
  loot            TEXT,             -- JSON, set after battle
  catapult_target TEXT,             -- building ID to target with catapults (null = random)
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL, -- 'attack' | 'defense' | 'support'
  title      TEXT    NOT NULL,
  data       TEXT    NOT NULL, -- JSON blob with full battle details
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS trade_offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id  INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  offer_res   TEXT    NOT NULL,
  offer_amt   INTEGER NOT NULL,
  want_res    TEXT    NOT NULL,
  want_amt    INTEGER NOT NULL,
  merchants   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject        TEXT    NOT NULL DEFAULT '',
  text           TEXT    NOT NULL,
  read           INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS tribe_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_id    INTEGER NOT NULL REFERENCES tribes(id)   ON DELETE CASCADE,
  inviter_id  INTEGER NOT NULL REFERENCES players(id)  ON DELETE CASCADE,
  invitee_id  INTEGER NOT NULL REFERENCES players(id)  ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(tribe_id, invitee_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_villages_player  ON villages(player_id);
CREATE INDEX IF NOT EXISTS idx_villages_coords  ON villages(x, y);
CREATE INDEX IF NOT EXISTS idx_build_queue_vil  ON build_queue(village_id, finish_time);
CREATE INDEX IF NOT EXISTS idx_train_queue_vil  ON train_queue(village_id, finish_time);
CREATE INDEX IF NOT EXISTS idx_commands_arrival ON commands(arrival_time, status);
CREATE INDEX IF NOT EXISTS idx_commands_from    ON commands(from_village_id);
CREATE INDEX IF NOT EXISTS idx_commands_to      ON commands(to_village_id);
CREATE INDEX IF NOT EXISTS idx_reports_player   ON reports(player_id, created_at);
