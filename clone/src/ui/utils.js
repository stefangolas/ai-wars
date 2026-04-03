// Shared UI utility functions.

// Format a number with thousands separators.
export function fmt(n) {
  return Math.floor(isFinite(n) ? n : 0).toLocaleString('en-US');
}

// Format seconds as HH:MM:SS.
export function fmtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

// Format a future timestamp as a live countdown string.
export function fmtCountdown(finishTime) {
  const remaining = Math.max(0, Math.ceil((finishTime - Date.now()) / 1000));
  return fmtTime(remaining);
}

// Render resource cost spans (wood/clay/iron) with warn class if can't afford.
export function renderCost(cost, village) {
  const warn = (res, val) => village[res] < val ? 'warn' : '';
  return `
    <span class="cost-item cost-wood ${warn('wood', cost.wood)}">
      <span class="icon header wood"></span>${fmt(cost.wood)}
    </span>
    <span class="cost-item cost-clay ${warn('clay', cost.clay)}">
      <span class="icon header stone"></span>${fmt(cost.clay)}
    </span>
    <span class="cost-item cost-iron ${warn('iron', cost.iron)}">
      <span class="icon header iron"></span>${fmt(cost.iron)}
    </span>`;
}

// Render an unmet requirements list.
export function renderUnmetReqs(reqs) {
  if (reqs.length === 0) return '';
  return `<div class="unmet_req">${reqs.map(r =>
    `<span><img src="assets/graphic/buildings/${r.building}.webp" class="req-icon" alt="">
     <span class="inactive">${r.building} (Level ${r.required})</span></span>`
  ).join('')}</div>`;
}

// Return the best available big_building image path for a building at a given level.
// Falls back to the lowest level image if the exact level image doesn't exist.
// Known available levels are checked against a static map.
const KNOWN_LEVELS = {
  main:     [1, 2, 3],
  barracks: [1, 2],
  smith:    [1, 2, 3],
  market:   [1, 2],
  // everything else has only level 1
};

export function buildingImgSrc(id, level) {
  if (level === 0) return `assets/graphic/buildings/${id}.webp`;
  const known = KNOWN_LEVELS[id] ?? [1];
  const best  = [...known].reverse().find(l => l <= level) ?? 1;
  return `assets/graphic/big_buildings/${id}${best}.webp`;
}

// Inline SVG icons for resources (fallback when webp is unavailable).
export const RESOURCE_ICONS = {
  wood: '🪵',
  clay: '🧱',
  iron: '⚙️',
  pop:  '👤',
};
