// Shared building-points formula — matches original Tribal Wars scale.
// Points = floor(total resources spent on all building upgrades / DIVISOR)
//
// Calibration (approximate):
//   Starting village  → ~13 pts
//   Stable unlocked   → ~300–400 pts
//   Noble prereqs met → ~4,000+ pts

import { BUILDINGS } from '../../clone/src/data/buildings.js';

const POINTS_DIVISOR = 80;

function levelCost(buildingId, level) {
  const b = BUILDINGS[buildingId];
  if (!b || level <= 0) return 0;
  const { wood, clay, iron } = b.baseCost;
  return Math.round((wood + clay + iron) * Math.pow(b.costFactor, level - 1));
}

export function calculatePoints(buildings) {
  let total = 0;
  for (const [id, level] of Object.entries(buildings)) {
    for (let lvl = 1; lvl <= level; lvl++) {
      total += levelCost(id, lvl);
    }
  }
  return Math.floor(total / POINTS_DIVISOR);
}
