// Combat engine — pure functions only.
// Implements the Tribal Wars battle formula.
//
// Morale: protects small players. morale = clamp(50%, 100%, 3*defPts/atkPts + 25%)
// Applied as a multiplier to attacker power only.
//
// Smithy: each smithy level boosts unit stats by 1.007× per level.
// Attacker's smithy boosts attack; defender's smithy boosts defense.
//
// Luck: ±15% random modifier applied to attacker power.

import { UNITS } from '../data/units.js';
import { wallBonus, HIDE_CAPACITY } from '../data/buildings.js';

function dominantAttackType(attackers) {
  const counts = { general: 0, cavalry: 0, archer: 0 };
  for (const [unitId, count] of Object.entries(attackers)) {
    const u = UNITS[unitId];
    if (!u || count <= 0) continue;
    if (['spy', 'light', 'marcher', 'heavy', 'knight'].includes(unitId)) {
      counts.cavalry += count;
    } else if (['archer', 'marcher'].includes(unitId)) {
      counts.archer += count;
    } else {
      counts.general += count;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function totalAttack(units, smithyMult = 1) {
  return Object.entries(units).reduce((sum, [id, count]) => {
    return sum + (UNITS[id]?.attack ?? 0) * smithyMult * count;
  }, 0);
}

function totalDefense(units, attackType, smithyMult = 1) {
  return Object.entries(units).reduce((sum, [id, count]) => {
    return sum + (UNITS[id]?.defense[attackType] ?? 0) * smithyMult * count;
  }, 0);
}

function applyLosses(units, survivalRatio) {
  const result = {};
  for (const [id, count] of Object.entries(units)) {
    result[id] = Math.round(count * survivalRatio);
  }
  return result;
}

// Returns true if all non-zero units in the attack are scouts.
export function isScoutAttack(attackers) {
  return Object.entries(attackers).every(([id, n]) => n === 0 || id === 'spy');
}

// Simulate a single battle.
// options: { luck, attackerSmithLevel, defenderSmithLevel, attackerPoints, defenderPoints }
// Returns { attackerSurvivors, defenderSurvivors, attackerWon, luckPercent, wallDamage,
//           morale, defSurvivalRatio, log }
export function simulateBattle(attackers, defenders, wallLevel = 0, options = {}) {
  const {
    luck: luckOverride           = null,
    attackerSmithLevel           = 0,
    defenderSmithLevel           = 0,
    attackerPoints               = 0,
    defenderPoints               = 0,
  } = options;

  const luck    = luckOverride ?? ((Math.random() * 0.3) - 0.15);
  const atkType = dominantAttackType(attackers);
  const wallMult = wallBonus(wallLevel);

  // Morale: clamp to [0.5, 1.0], only when both have points data
  const morale = (attackerPoints > 0)
    ? Math.min(1, Math.max(0.5, 3 * defenderPoints / attackerPoints + 0.25))
    : 1;

  const atkSmithMult = Math.pow(1.007, attackerSmithLevel);
  const defSmithMult = Math.pow(1.007, defenderSmithLevel);

  const atkPower = totalAttack(attackers, atkSmithMult) * (1 + luck) * morale;
  const defPower = totalDefense(defenders, atkType, defSmithMult) * wallMult;

  const log = [
    `Attack type: ${atkType}`,
    `Morale: ${(morale * 100).toFixed(0)}%`,
    `Attacker power: ${Math.round(atkPower)} (luck: ${luck >= 0 ? '+' : ''}${(luck * 100).toFixed(1)}%)`,
    `Defender power: ${Math.round(defPower)} (wall: +${((wallMult - 1) * 100).toFixed(0)}%, smithy: +${((defSmithMult - 1) * 100).toFixed(1)}%)`,
  ];

  let attackerSurvivors, defenderSurvivors, wallDamage = 0, defSurvivalRatio = 0;

  if (atkPower === 0 && defPower === 0) {
    return {
      attackerSurvivors: { ...attackers },
      defenderSurvivors: { ...defenders },
      attackerWon: false,
      luckPercent: luck * 100,
      wallDamage: 0,
      morale,
      defSurvivalRatio: 1,
      log,
    };
  }

  if (atkPower >= defPower) {
    const atkLossFraction = defPower > 0 ? 1 - Math.sqrt(defPower / (atkPower + defPower)) : 0;
    attackerSurvivors = applyLosses(attackers, 1 - atkLossFraction);
    defenderSurvivors = applyLosses(defenders, 0);
    defSurvivalRatio  = 0;

    const ramCount = attackers.ram ?? 0;
    if (ramCount > 0 && wallLevel > 0) {
      const dmg = Math.round(ramCount * (0.02 + Math.random() * 0.03) * wallLevel);
      wallDamage = Math.min(wallLevel, dmg);
    }

    log.push(`Attacker WINS — ${(atkLossFraction * 100).toFixed(1)}% losses`);
  } else {
    const defLossFraction = 1 - Math.sqrt(1 - atkPower / (atkPower + defPower));
    attackerSurvivors = applyLosses(attackers, 0);
    defSurvivalRatio  = 1 - defLossFraction;
    defenderSurvivors = applyLosses(defenders, defSurvivalRatio);
    log.push(`Defender WINS — ${(defLossFraction * 100).toFixed(1)}% losses`);
  }

  return {
    attackerSurvivors,
    defenderSurvivors,
    attackerWon: atkPower >= defPower,
    luckPercent: luck * 100,
    wallDamage,
    morale,
    defSurvivalRatio,
    log,
  };
}

export function calculateLoot(defenderVillage, attackerSurvivors, hideLevel = 0) {
  const hidden     = HIDE_CAPACITY[Math.min(hideLevel, 10)] ?? 0;
  const available  = {
    wood: Math.max(0, defenderVillage.wood  - hidden / 3),
    clay: Math.max(0, defenderVillage.clay  - hidden / 3),
    iron: Math.max(0, defenderVillage.iron  - hidden / 3),
  };

  const totalHaul = Object.entries(attackerSurvivors).reduce((sum, [id, count]) => {
    return sum + (UNITS[id]?.haul ?? 0) * count;
  }, 0);

  const totalAvailable = available.wood + available.clay + available.iron;
  if (totalAvailable === 0 || totalHaul === 0) return { wood: 0, clay: 0, iron: 0 };

  const ratio = Math.min(1, totalHaul / totalAvailable);
  return {
    wood: Math.floor(available.wood * ratio),
    clay: Math.floor(available.clay * ratio),
    iron: Math.floor(available.iron * ratio),
  };
}

export function travelTime(from, to, unitIds, worldSpeed = 1) {
  const dist    = Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
  const slowest = unitIds.reduce((max, id) => {
    const spd = UNITS[id]?.speed ?? 0;
    return spd > max ? spd : max;
  }, 0);
  if (slowest === 0) return 0;
  return Math.round(dist * slowest * 60 / worldSpeed);
}
