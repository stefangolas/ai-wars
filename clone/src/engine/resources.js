// Resource production engine — pure functions only, no DOM or state side-effects.
import { STORAGE_CAPACITY, HIDE_CAPACITY } from '../data/buildings.js';

// Base production per hour per resource building level (world speed = 1).
// Sourced from TW wiki: 5/hr base, 30/hr at level 1, ~1.163x per level.
const BASE_PRODUCTION = [5, 30, 35, 41, 47, 55, 64, 74, 86, 100, 117,
  136, 158, 184, 214, 249, 289, 336, 391, 454, 528,
  614, 713, 829, 963, 1119, 1300, 1511, 1756, 2040, 2370];

export function productionPerHour(level, worldSpeed = 1) {
  const base = BASE_PRODUCTION[Math.min(level, 30)] ?? 2370;
  return Math.round(base * worldSpeed);
}

// Apply one tick: update resources based on elapsed real time.
// Returns updated { wood, clay, iron } (does not mutate the input).
export function tickResources(village, now, worldSpeed = 1) {
  // Sanitize: recover from NaN state (can happen if lastTick was missing on first sync)
  const wood = isFinite(village.wood) ? village.wood : 0;
  const clay = isFinite(village.clay) ? village.clay : 0;
  const iron = isFinite(village.iron) ? village.iron : 0;

  // No lastTick means we haven't received a proper server sync yet — hold values
  if (!village.lastTick) return { wood, clay, iron };

  const elapsed = (now - village.lastTick) / 3_600_000; // hours
  const cap     = storageCapacity(village.buildings.storage);

  // Militia active: halve resource production for the duration
  const militiaActive = village.militiaActiveUntil && village.militiaActiveUntil > now;
  const productionMult = militiaActive ? 0.5 : 1.0;

  return {
    wood: Math.min(cap, wood + productionPerHour(village.buildings.wood,  worldSpeed) * elapsed * productionMult),
    clay: Math.min(cap, clay + productionPerHour(village.buildings.stone, worldSpeed) * elapsed * productionMult),
    iron: Math.min(cap, iron + productionPerHour(village.buildings.iron,  worldSpeed) * elapsed * productionMult),
  };
}

export function storageCapacity(level) {
  return STORAGE_CAPACITY[Math.min(level, 30)] ?? 400_000;
}

export function hideCapacity(level) {
  return HIDE_CAPACITY[Math.min(level, 10)] ?? 2000;
}

// Time (in hours) until a resource reaches a target amount given current amount + production.
export function timeUntilAffordable(current, target, perHour) {
  if (current >= target) return 0;
  if (perHour <= 0) return Infinity;
  return (target - current) / perHour;
}

// Returns true if all three resources are currently sufficient to pay `cost`.
export function canAfford(village, cost) {
  return village.wood >= cost.wood &&
         village.clay >= cost.clay &&
         village.iron >= cost.iron;
}

// Deduct a cost from village resources. Returns updated { wood, clay, iron }.
export function deductCost(village, cost) {
  return {
    wood: village.wood - cost.wood,
    clay: village.clay - cost.clay,
    iron: village.iron - cost.iron,
  };
}
