// Village Overview screen — visual building grid with click-through navigation.
import { BUILDINGS, OVERVIEW_LAYOUT, FARM_CAPACITY } from '../../data/buildings.js';
import { populationUsedByBuildings } from '../../engine/construction.js';
import { populationUsedByUnits }     from '../../engine/training.js';
import { renderBuildQueue }          from '../components/BuildQueue.js';
import { buildingImgSrc, fmt }       from '../utils.js';
import { navigate }                  from '../router.js';

export default {
  mount(container, state) {
    const village  = state.villages[state.activeVillageId];
    container.innerHTML = renderOverview(village);
    this._bindEvents(container, village);
  },

  update(container, state) {
    const village  = state.villages[state.activeVillageId];
    const queue    = container.querySelector('#build-queue-panel');
    if (queue) queue.innerHTML = renderBuildQueue(village);
    // Refresh building levels in tiles (levels can change when queue completes)
    container.querySelectorAll('[data-building]').forEach(tile => {
      const id    = tile.dataset.building;
      const level = village.buildings[id] ?? 0;
      const img   = tile.querySelector('.building-img');
      const lbl   = tile.querySelector('.building-level');
      if (img) img.src = buildingImgSrc(id, level);
      if (lbl) lbl.textContent = level > 0 ? `Level ${level}` : 'Not built';
    });
  },

  _bindEvents(container, village) {
    container.querySelectorAll('[data-building]').forEach(tile => {
      tile.addEventListener('click', () => {
        const id = tile.dataset.building;
        navigate(BUILDINGS[id]?.screen ?? id);
      });
    });
  },
};

function renderOverview(village) {
  const popBuildings = populationUsedByBuildings(village.buildings);
  const popUnits     = populationUsedByUnits(village.units);
  const popUsed      = popBuildings + popUnits;
  const popMax       = FARM_CAPACITY[Math.min(village.buildings.farm, 30)];

  return `
    <div id="overview-screen">
      <div class="overview-header">
        <h2>${village.name}</h2>
        <span class="coord">(${village.x}|${village.y})</span>
        <span class="pop-display">
          <span class="icon header population"></span>
          ${popUsed} / ${popMax}
        </span>
      </div>

      <div class="overview-main">
        <div class="village-grid">
          ${OVERVIEW_LAYOUT.map(pos => renderBuildingTile(pos.id, village)).join('')}
        </div>

        <div class="overview-sidebar">
          <div id="build-queue-panel">
            ${renderBuildQueue(village)}
          </div>
        </div>
      </div>
    </div>`;
}

function renderBuildingTile(id, village) {
  const b     = BUILDINGS[id];
  const level = village.buildings[id] ?? 0;
  const name  = b?.name ?? id;
  const src   = buildingImgSrc(id, level);

  return `
    <div class="building-tile ${level === 0 ? 'tile-unbuilt' : ''}" data-building="${id}" title="${name}">
      <img class="building-img" src="${src}" alt="${name}">
      <div class="building-label">
        <span class="building-name">${name}</span>
        <span class="building-level">${level > 0 ? `Level ${level}` : 'Not built'}</span>
      </div>
    </div>`;
}
