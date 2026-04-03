// Resource bar shown at the top of every screen.
import { productionPerHour, storageCapacity } from '../../engine/resources.js';
import { populationUsedByBuildings } from '../../engine/construction.js';
import { populationUsedByUnits }     from '../../engine/training.js';
import { FARM_CAPACITY }             from '../../data/buildings.js';
import { fmt } from '../utils.js';

export function renderResourceBar(village, worldSpeed) {
  const cap      = storageCapacity(village.buildings.storage);
  const woodProd = productionPerHour(village.buildings.wood,  worldSpeed);
  const clayProd = productionPerHour(village.buildings.stone, worldSpeed);
  const ironProd = productionPerHour(village.buildings.iron,  worldSpeed);
  const popUsed  = populationUsedByBuildings(village.buildings) + populationUsedByUnits(village.units);
  const popMax   = FARM_CAPACITY[Math.min(village.buildings.farm, 30)];

  const woodFull = village.wood >= cap;
  const clayFull = village.clay >= cap;
  const ironFull = village.iron >= cap;

  return `
    <div id="resource_bar">
      <div class="res-item ${woodFull ? 'res-full' : ''}">
        <span class="res-icon res-wood"></span>
        <span class="res-value" id="res_wood">${fmt(village.wood)}</span>
        <span class="res-prod">+${woodProd}/h</span>
      </div>
      <div class="res-item ${clayFull ? 'res-full' : ''}">
        <span class="res-icon res-clay"></span>
        <span class="res-value" id="res_clay">${fmt(village.clay)}</span>
        <span class="res-prod">+${clayProd}/h</span>
      </div>
      <div class="res-item ${ironFull ? 'res-full' : ''}">
        <span class="res-icon res-iron"></span>
        <span class="res-value" id="res_iron">${fmt(village.iron)}</span>
        <span class="res-prod">+${ironProd}/h</span>
      </div>
      <div class="res-item">
        <span class="res-icon res-storage"></span>
        <span class="res-value">${fmt(cap)}</span>
      </div>
      <div class="res-item">
        <span class="res-icon res-pop"></span>
        <span class="res-value" id="res_pop" title="Population used / max">${popUsed}/${popMax}</span>
      </div>
    </div>`;
}

// Live-update just the numeric values without re-rendering the whole bar.
export function updateResourceBar(village, worldSpeed) {
  const cap = storageCapacity(village.buildings.storage);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('res_wood', fmt(village.wood));
  set('res_clay', fmt(village.clay));
  set('res_iron', fmt(village.iron));
}
