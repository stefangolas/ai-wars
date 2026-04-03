// World generator — seeds the map with NPC villages on first startup.
import { db, transaction } from '../db/database.js';
import { calculatePoints } from './points.js';

const NPC_COUNT   = 80;
const WORLD_SIZE  = 500;

// NPC village archetypes — varied strength
const NO_UNITS = { spear:0,sword:0,axe:0,archer:0,spy:0,light:0,marcher:0,heavy:0,ram:0,catapult:0,knight:0,snob:0,militia:0 };

const ARCHETYPES = [
  {
    name: 'Abandoned Farm',
    buildings: { main:1,barracks:0,stable:0,garage:0,snob:0,smith:0,place:1,statue:0,market:0,wood:1,stone:1,iron:1,farm:1,storage:1,hide:0,wall:0 },
    units: NO_UNITS,
    resources: [300, 500, 200],
  },
  {
    name: 'Small Settlement',
    buildings: { main:2,barracks:1,stable:0,garage:0,snob:0,smith:0,place:1,statue:0,market:0,wood:2,stone:2,iron:2,farm:2,storage:2,hide:1,wall:1 },
    units: NO_UNITS,
    resources: [600, 800, 400],
  },
  {
    name: "Barbarian Village",
    buildings: { main:3,barracks:2,stable:1,garage:0,snob:0,smith:2,place:1,statue:0,market:1,wood:4,stone:4,iron:4,farm:4,storage:4,hide:2,wall:3 },
    units: NO_UNITS,
    resources: [2000, 2000, 1500],
  },
  {
    name: 'Fortified Town',
    buildings: { main:5,barracks:5,stable:3,garage:2,snob:0,smith:5,place:1,statue:0,market:3,wood:7,stone:7,iron:7,farm:7,storage:7,hide:5,wall:8 },
    units: NO_UNITS,
    resources: [8000, 8000, 6000],
  },
];

export function seedWorld() {
  const existing = db.prepare('SELECT COUNT(*) as n FROM villages WHERE is_npc = 1').get().n;
  if (existing >= NPC_COUNT) return; // already seeded

  const taken = new Set(
    db.prepare('SELECT x, y FROM villages').all().map(r => `${r.x},${r.y}`)
  );

  const insert = db.prepare(`
    INSERT OR IGNORE INTO villages
      (player_id, name, x, y, wood, clay, iron, last_tick, buildings, units, is_npc, points)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const insertMany = transaction(() => {
    let placed = 0;
    let attempts = 0;

    while (placed < NPC_COUNT && attempts < 10000) {
      attempts++;
      const x = Math.floor(Math.random() * WORLD_SIZE) + 1;
      const y = Math.floor(Math.random() * WORLD_SIZE) + 1;
      if (taken.has(`${x},${y}`)) continue;

      const arch = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
      const [wood, clay, iron] = arch.resources;
      const points = calculatePoints(arch.buildings);

      insert.run(
        arch.name, x, y,
        wood + Math.floor(Math.random() * 500),
        clay + Math.floor(Math.random() * 500),
        iron + Math.floor(Math.random() * 400),
        Date.now(),
        JSON.stringify(arch.buildings),
        JSON.stringify(arch.units),
        points,
      );

      taken.add(`${x},${y}`);
      placed++;
    }

    console.log(`[worldgen] Placed ${placed} NPC villages`);
  });

  insertMany();
}
