// Building construction engine — pure functions only.
import { BUILDINGS, REQUIREMENTS } from '../data/buildings.js';
import { canAfford, deductCost } from './resources.js';

// Cost to upgrade a building TO targetLevel.
export function buildingCost(buildingId, targetLevel) {
  const b = BUILDINGS[buildingId];
  if (!b) throw new Error(`Unknown building: ${buildingId}`);
  const factor = Math.pow(b.costFactor, targetLevel - 1);
  return {
    wood: Math.round(b.baseCost.wood  * factor),
    clay: Math.round(b.baseCost.clay  * factor),
    iron: Math.round(b.baseCost.iron  * factor),
  };
}

// Build time in seconds to upgrade TO targetLevel, accounting for HQ speed bonus.
// Higher HQ level reduces build time: factor = 1.05^(-hqLevel)
export function buildTime(buildingId, targetLevel, hqLevel, worldSpeed = 1) {
  const b = BUILDINGS[buildingId];
  if (!b) throw new Error(`Unknown building: ${buildingId}`);
  const levelFactor = Math.pow(b.timeFactor, targetLevel - 1);
  const hqFactor    = Math.pow(1.05, -hqLevel);
  return Math.round(b.baseTime * levelFactor * hqFactor / worldSpeed);
}

// Check if all prerequisite buildings are met to start constructing buildingId at nextLevel.
export function requirementsMet(buildings, buildingId) {
  const reqs = REQUIREMENTS[buildingId];
  if (!reqs) return true;
  return Object.entries(reqs).every(([req, minLevel]) => (buildings[req] ?? 0) >= minLevel);
}

// Returns an array of unmet requirement descriptors: [{ building, required, current }]
export function unmetRequirements(buildings, buildingId) {
  const reqs = REQUIREMENTS[buildingId];
  if (!reqs) return [];
  return Object.entries(reqs)
    .filter(([req, minLevel]) => (buildings[req] ?? 0) < minLevel)
    .map(([req, minLevel]) => ({
      building: req,
      required: minLevel,
      current:  buildings[req] ?? 0,
    }));
}

const BUILD_QUEUE_LIMIT = 10;

// Attempt to enqueue an upgrade for buildingId.
// Returns { ok: true, village } on success or { ok: false, reason } on failure.
export function enqueueUpgrade(village, buildingId, worldSpeed = 1) {
  const b = BUILDINGS[buildingId];
  if (!b) return { ok: false, reason: 'Unknown building' };

  const builtLevel = village.buildings[buildingId] ?? 0;
  // Account for levels already queued — sequential upgrades on the same building are allowed
  const queuedLevel = village.buildQueue
    .filter(item => item.building === buildingId)
    .reduce((max, item) => Math.max(max, item.level), builtLevel);
  const nextLevel = queuedLevel + 1;

  if (queuedLevel >= b.maxLevel) return { ok: false, reason: 'Already at max level' };
  if (village.buildQueue.length >= BUILD_QUEUE_LIMIT) {
    return { ok: false, reason: `Build queue is full (max ${BUILD_QUEUE_LIMIT} items)` };
  }
  if (!requirementsMet(village.buildings, buildingId)) return { ok: false, reason: 'Requirements not met' };

  const cost = buildingCost(buildingId, nextLevel);
  if (!canAfford(village, cost)) return { ok: false, reason: 'Insufficient resources' };

  const duration   = buildTime(buildingId, nextLevel, village.buildings.main ?? 0, worldSpeed);
  // Queue finish time: starts after any currently queued item
  const queueEnd   = village.buildQueue.length > 0
    ? village.buildQueue.at(-1).finishTime
    : Date.now();
  const finishTime = queueEnd + duration * 1000;

  const updatedVillage = {
    ...village,
    ...deductCost(village, cost),
    buildQueue: [...village.buildQueue, { building: buildingId, level: nextLevel, finishTime }],
  };

  return { ok: true, village: updatedVillage };
}

// Process the build queue: complete any items whose finishTime has passed.
// Returns updated { buildings, buildQueue }.
export function processBuildQueue(village, now) {
  let buildings  = { ...village.buildings };
  let buildQueue = [];

  for (const item of village.buildQueue) {
    if (now >= item.finishTime) {
      buildings[item.building] = item.level;
    } else {
      buildQueue.push(item);
    }
  }

  return { buildings, buildQueue };
}

// Population consumed by all current buildings.
export function populationUsedByBuildings(buildings) {
  return Object.entries(buildings).reduce((sum, [id, level]) => {
    return sum + (BUILDINGS[id]?.popPerLevel ?? 0) * level;
  }, 0);
}
