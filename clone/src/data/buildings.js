// Building definitions — pure data, no logic.
// Cost formula: baseCost * costFactor^(level-1)
// Time formula: baseTime * timeFactor^(level-1) * hq_speed_factor
//
// icon: key for big_buildings/{icon}{level}.webp  and  buildings/{icon}.webp
// screen: route hash this building links to

export const BUILDINGS = {
  main:     { name: 'Headquarters', screen: 'main',     maxLevel: 30, baseCost: { wood: 90,    clay: 80,    iron: 70    }, costFactor: 1.26, baseTime: 2400,  timeFactor: 1.2, popPerLevel: 5  },
  barracks: { name: 'Barracks',     screen: 'barracks', maxLevel: 25, baseCost: { wood: 200,   clay: 170,   iron: 90    }, costFactor: 1.26, baseTime: 1800,  timeFactor: 1.2, popPerLevel: 4  },
  stable:   { name: 'Stable',       screen: 'stable',   maxLevel: 20, baseCost: { wood: 270,   clay: 240,   iron: 260   }, costFactor: 1.26, baseTime: 3200,  timeFactor: 1.2, popPerLevel: 5  },
  garage:   { name: 'Workshop',     screen: 'garage',   maxLevel: 15, baseCost: { wood: 300,   clay: 240,   iron: 260   }, costFactor: 1.26, baseTime: 4500,  timeFactor: 1.2, popPerLevel: 3  },
  smith:    { name: 'Smithy',       screen: 'smith',    maxLevel: 20, baseCost: { wood: 220,   clay: 180,   iron: 240   }, costFactor: 1.26, baseTime: 2800,  timeFactor: 1.2, popPerLevel: 4  },
  place:    { name: 'Rally Point',  screen: 'place',    maxLevel: 1,  baseCost: { wood: 10,    clay: 40,    iron: 30    }, costFactor: 1.26, baseTime: 600,   timeFactor: 1.2, popPerLevel: 1  },
  statue:   { name: 'Statue',       screen: 'statue',   maxLevel: 1,  baseCost: { wood: 220,   clay: 220,   iron: 220   }, costFactor: 1.26, baseTime: 1800,  timeFactor: 1.2, popPerLevel: 2  },
  market:   { name: 'Market',       screen: 'market',   maxLevel: 25, baseCost: { wood: 100,   clay: 100,   iron: 100   }, costFactor: 1.26, baseTime: 1200,  timeFactor: 1.2, popPerLevel: 4  },
  wood:     { name: 'Timber Camp',  screen: 'wood',     maxLevel: 30, baseCost: { wood: 50,    clay: 80,    iron: 30    }, costFactor: 1.25, baseTime: 600,   timeFactor: 1.2, popPerLevel: 5, produces: 'wood' },
  stone:    { name: 'Clay Pit',     screen: 'stone',    maxLevel: 30, baseCost: { wood: 65,    clay: 50,    iron: 40    }, costFactor: 1.25, baseTime: 600,   timeFactor: 1.2, popPerLevel: 5, produces: 'clay' },
  iron:     { name: 'Iron Mine',    screen: 'iron',     maxLevel: 30, baseCost: { wood: 75,    clay: 65,    iron: 70    }, costFactor: 1.25, baseTime: 900,   timeFactor: 1.2, popPerLevel: 5, produces: 'iron' },
  farm:     { name: 'Farm',         screen: 'farm',     maxLevel: 30, baseCost: { wood: 45,    clay: 40,    iron: 30    }, costFactor: 1.26, baseTime: 1200,  timeFactor: 1.2, popPerLevel: 0  },
  storage:  { name: 'Warehouse',    screen: 'storage',  maxLevel: 30, baseCost: { wood: 60,    clay: 50,    iron: 40    }, costFactor: 1.26, baseTime: 900,   timeFactor: 1.2, popPerLevel: 1  },
  hide:     { name: 'Hiding Place', screen: 'hide',     maxLevel: 10, baseCost: { wood: 50,    clay: 60,    iron: 50    }, costFactor: 1.25, baseTime: 600,   timeFactor: 1.2, popPerLevel: 2  },
  wall:     { name: 'Wall',         screen: 'wall',     maxLevel: 20, baseCost: { wood: 50,    clay: 100,   iron: 20    }, costFactor: 1.26, baseTime: 1800,  timeFactor: 1.2, popPerLevel: 3  },
  snob:     { name: 'Academy',      screen: 'snob',     maxLevel: 1,  baseCost: { wood: 15000, clay: 25000, iron: 10000 }, costFactor: 1.26, baseTime: 86400, timeFactor: 1.2, popPerLevel: 80 },
};

// Which buildings are shown in the village visual overview (and their grid position [col, row])
export const OVERVIEW_LAYOUT = [
  // Resources
  { id: 'wood',    col: 0, row: 0 },
  { id: 'stone',   col: 1, row: 0 },
  { id: 'iron',    col: 2, row: 0 },
  // Storage / production support
  { id: 'farm',    col: 3, row: 0 },
  { id: 'storage', col: 0, row: 1 },
  { id: 'hide',    col: 1, row: 1 },
  // Military
  { id: 'barracks',col: 2, row: 1 },
  { id: 'stable',  col: 3, row: 1 },
  { id: 'garage',  col: 0, row: 2 },
  // Command / economy
  { id: 'main',    col: 1, row: 2 },
  { id: 'smith',   col: 2, row: 2 },
  { id: 'market',  col: 3, row: 2 },
  // Special
  { id: 'place',   col: 0, row: 3 },
  { id: 'statue',  col: 1, row: 3 },
  { id: 'wall',    col: 2, row: 3 },
  { id: 'snob',    col: 3, row: 3 },
];

// Prerequisite buildings for construction. Format: { buildingId: { requiredId: requiredLevel } }
export const REQUIREMENTS = {
  barracks: { main: 3 },
  stable:   { main: 10, barracks: 5, smith: 5 },
  garage:   { main: 10, smith: 10 },
  smith:    { main: 5, barracks: 1 },
  market:   { main: 3, storage: 2 },
  wall:     { barracks: 1 },
  snob:     { main: 20, smith: 20, market: 10 },
  statue:   { main: 3 },
};

// Wall defense bonus per level: (1 + 0.04*level)  — roughly 4% per level
export function wallBonus(level) {
  return 1 + 0.04 * level;
}

// Farm population capacity lookup
export const FARM_CAPACITY = [
  0, 240, 280, 330, 390, 460, 540, 640, 760, 900, 1070,
  1270, 1500, 1780, 2100, 2490, 2950, 3490, 4130, 4890, 5800,
  6860, 8120, 9610, 11370, 13460, 15930, 18850, 22310, 26400, 31200,
];

// Warehouse capacity lookup
export const STORAGE_CAPACITY = [
  0, 1000, 1229, 1512, 1859, 2285, 2810, 3454, 4247, 5222, 6420,
  7893, 9710, 11943, 14684, 18055, 22204, 27304, 33580, 41293, 50800,
  62475, 76810, 94476, 116176, 142880, 175735, 216079, 265720, 326800, 400000,
];

// Hiding Place capacity lookup (protects this many resources from plunder)
export const HIDE_CAPACITY = [
  0, 50, 100, 150, 200, 300, 400, 500, 700, 1000, 2000,
];

// Merchant capacity at each market level (max resources one merchant can carry = 1000 always;
// this is the number of merchants available at each level)
export const MARKET_MERCHANTS = [
  0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10,
  12, 14, 16, 19, 21, 25, 28, 33, 37, 45,
  56, 65, 80, 100, 120,
];
