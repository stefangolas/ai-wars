// Unit training engine — pure functions only.
import { UNITS } from '../data/units.js';
import { FARM_CAPACITY } from '../data/buildings.js';
import { canAfford, deductCost } from './resources.js';
import { populationUsedByBuildings } from './construction.js';

// Training time in seconds for one unit at a given building level.
// Higher building level reduces time: factor = 1.05^(-buildingLevel)
export function unitTrainTime(unitId, buildingLevel, worldSpeed = 1) {
  const u = UNITS[unitId];
  if (!u) throw new Error(`Unknown unit: ${unitId}`);
  const levelFactor = Math.pow(1.05, -buildingLevel);
  return Math.round(u.buildTime * levelFactor / worldSpeed);
}

// Check if all unit requirements are met.
export function unitRequirementsMet(buildings, unitId) {
  const reqs = UNITS[unitId]?.requires;
  if (!reqs) return true;
  return Object.entries(reqs).every(([req, minLevel]) => (buildings[req] ?? 0) >= minLevel);
}

// Returns unmet unit requirements: [{ building, required, current }]
export function unmetUnitRequirements(buildings, unitId) {
  const reqs = UNITS[unitId]?.requires;
  if (!reqs) return [];
  return Object.entries(reqs)
    .filter(([req, minLevel]) => (buildings[req] ?? 0) < minLevel)
    .map(([req, minLevel]) => ({
      building: req,
      required: minLevel,
      current:  buildings[req] ?? 0,
    }));
}

// Attempt to enqueue training count units of unitId.
// Returns { ok: true, village } or { ok: false, reason }.
export function enqueueTraining(village, unitId, count, worldSpeed = 1) {
  const u = UNITS[unitId];
  if (!u) return { ok: false, reason: 'Unknown unit' };
  if (count <= 0) return { ok: false, reason: 'Count must be positive' };
  if (!unitRequirementsMet(village.buildings, unitId)) return { ok: false, reason: 'Requirements not met' };

  // Unique unit check (e.g. Paladin — only one allowed per village)
  if (u.unique) {
    const existing = village.units[unitId] ?? 0;
    const inQueue  = village.trainQueue
      .filter(i => i.unit === unitId)
      .reduce((s, i) => s + i.count, 0);
    if (existing + inQueue >= 1) {
      return { ok: false, reason: `${u.name} is unique — you can only have one` };
    }
  }

  const totalCost = {
    wood: u.cost.wood * count,
    clay: u.cost.clay * count,
    iron: u.cost.iron * count,
  };
  if (!canAfford(village, totalCost)) return { ok: false, reason: 'Insufficient resources' };

  // Population cap — includes units already in training queue
  if (u.pop > 0) {
    const farmLevel    = Math.min(village.buildings.farm ?? 0, 30);
    const farmCap      = FARM_CAPACITY[farmLevel] ?? 0;
    const popBuildings = populationUsedByBuildings(village.buildings);
    const popUnits     = populationUsedByUnits(village.units);
    const popInQueue   = village.trainQueue.reduce(
      (s, i) => s + (UNITS[i.unit]?.pop ?? 0) * i.count, 0
    );
    const available = farmCap - popBuildings - popUnits - popInQueue;
    const needed    = u.pop * count;
    if (needed > available) {
      const maxCount = Math.max(0, Math.floor(available / u.pop));
      return { ok: false, reason: `Not enough farm population (can train ${maxCount} more)` };
    }
  }

  const buildingLevel = village.buildings[u.building] ?? 0;
  const timePerUnit   = unitTrainTime(unitId, buildingLevel, worldSpeed);

  // Queue finish time: trains sequentially after existing queue
  const queueEnd   = village.trainQueue.length > 0
    ? village.trainQueue.at(-1).finishTime
    : Date.now();
  const finishTime = queueEnd + timePerUnit * count * 1000;

  const updatedVillage = {
    ...village,
    ...deductCost(village, totalCost),
    trainQueue: [...village.trainQueue, { unit: unitId, count, finishTime }],
  };

  return { ok: true, village: updatedVillage };
}

// Process training queue: complete batches whose finishTime has passed.
// Returns updated { units, trainQueue }.
export function processTrainQueue(village, now) {
  let units      = { ...village.units };
  let trainQueue = [];

  for (const item of village.trainQueue) {
    if (now >= item.finishTime) {
      units[item.unit] = (units[item.unit] ?? 0) + item.count;
    } else {
      trainQueue.push(item);
    }
  }

  return { units, trainQueue };
}

// Population consumed by all current units.
export function populationUsedByUnits(units) {
  return Object.entries(units).reduce((sum, [id, count]) => {
    return sum + (UNITS[id]?.pop ?? 0) * count;
  }, 0);
}
