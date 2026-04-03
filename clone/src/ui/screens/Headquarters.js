// Headquarters screen — building upgrade list matching the original TW layout.
import { BUILDINGS, REQUIREMENTS }     from '../../data/buildings.js';
import { buildingCost, buildTime, requirementsMet, unmetRequirements, enqueueUpgrade }
  from '../../engine/construction.js';
import { canAfford, timeUntilAffordable, productionPerHour } from '../../engine/resources.js';
import { renderBuildQueue }            from '../components/BuildQueue.js';
import { renderCost, renderUnmetReqs, buildingImgSrc, fmtTime, fmt } from '../utils.js';
import { store }                       from '../../state/store.js';

// Buildings shown in the HQ upgrade list, in order.
const HQ_ORDER = ['main','barracks','stable','garage','smith','place','statue',
                   'market','wood','stone','iron','farm','storage','hide','wall','snob'];

export default {
  mount(container, state) {
    const v        = state.villages[state.activeVillageId];
    this._snapshot = JSON.stringify({ b: v?.buildings, q: v?.buildQueue });
    this._render(container, state);
    this._bindEvents(container, state);
  },

  update(container, state) {
    // Only re-render when village buildings/queue change, not on every resource tick
    const v        = state.villages[state.activeVillageId];
    const snapshot = JSON.stringify({ b: v?.buildings, q: v?.buildQueue });
    if (snapshot === this._snapshot) return;
    this._snapshot = snapshot;
    this._render(container, state);
    this._bindEvents(container, state);
  },

  _render(container, state) {
    const village = state.villages[state.activeVillageId];
    container.innerHTML = renderHQ(village, state.worldSpeed);
  },

  _bindEvents(container, state) {
    container.querySelectorAll('.btn-build[data-building]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id      = btn.dataset.building;
        const village = store.activeVillage();
        // Client-side check for immediate feedback; server validates authoritatively
        const result  = enqueueUpgrade({ ...village }, id, store.getState().worldSpeed);
        if (result.ok) {
          store.dispatch('ENQUEUE_UPGRADE', { building: id });
        }
      });
    });
  },
};

function renderHQ(village, worldSpeed) {
  const available = HQ_ORDER.filter(id => requirementsMet(village.buildings, id) || (village.buildings[id] ?? 0) > 0);
  const locked    = HQ_ORDER.filter(id => !requirementsMet(village.buildings, id) && (village.buildings[id] ?? 0) === 0);

  return `
    <div id="hq-screen">
      <div class="screen-layout">
        <div class="screen-main">
          <h3>Headquarters — Level ${village.buildings.main}</h3>
          <table id="buildings" class="vis nowrap">
            <thead>
              <tr>
                <th style="width:23%">Building</th>
                <th><span class="icon header wood"></span></th>
                <th><span class="icon header stone"></span></th>
                <th><span class="icon header iron"></span></th>
                <th><span class="icon header time"></span></th>
                <th><span class="icon header population"></span></th>
                <th style="width:30%">Action</th>
              </tr>
            </thead>
            <tbody>
              ${available.map(id => renderBuildingRow(id, village, worldSpeed)).join('')}
            </tbody>
          </table>

          ${locked.length > 0 ? `
            <h3 class="section-title">Not yet available</h3>
            <table id="buildings_unmet" class="vis nowrap">
              <thead>
                <tr>
                  <th style="width:25%">Building</th>
                  <th>Requirements</th>
                </tr>
              </thead>
              <tbody>
                ${locked.map(id => renderLockedRow(id, village)).join('')}
              </tbody>
            </table>` : ''}
        </div>

        <div class="screen-sidebar">
          ${renderBuildQueue(village)}
        </div>
      </div>
    </div>`;
}

function renderBuildingRow(id, village, worldSpeed) {
  const b          = BUILDINGS[id];
  const currentLvl = village.buildings[id] ?? 0;
  const nextLvl    = currentLvl + 1;
  const atMax      = currentLvl >= b.maxLevel;
  const src        = buildingImgSrc(id, currentLvl);

  if (atMax) {
    return `
      <tr id="main_buildrow_${id}">
        <td>
          <img src="${src}" class="bmain_list_img" alt="${b.name}">
          <a href="#${b.screen}" data-nav="${b.screen}">${b.name}</a><br>
          <span style="font-size:.9em">Level ${currentLvl}</span>
        </td>
        <td colspan="6" class="inactive center">Building fully constructed</td>
      </tr>`;
  }

  const cost        = buildingCost(id, nextLvl);
  const affordable  = canAfford(village, cost);
  const duration    = buildTime(id, nextLvl, village.buildings.main ?? 0, worldSpeed);
  const popCost     = b.popPerLevel;

  const woodProd    = productionPerHour(village.buildings.wood,  worldSpeed);
  const clayProd    = productionPerHour(village.buildings.stone, worldSpeed);
  const ironProd    = productionPerHour(village.buildings.iron,  worldSpeed);
  const waitHours   = affordable ? 0 : Math.max(
    village.wood < cost.wood  ? (cost.wood  - village.wood)  / woodProd : 0,
    village.clay < cost.clay  ? (cost.clay  - village.clay)  / clayProd : 0,
    village.iron < cost.iron  ? (cost.iron  - village.iron)  / ironProd : 0,
  );

  const label       = currentLvl === 0 ? 'Construct' : `Level ${nextLvl}`;
  const btnDisabled = !affordable ? ' btn-disabled' : '';

  return `
    <tr id="main_buildrow_${id}">
      <td>
        <img src="${src}" class="bmain_list_img" alt="${b.name}">
        <a href="#${b.screen}" data-nav="${b.screen}">${b.name}</a><br>
        <span style="font-size:.9em">${currentLvl > 0 ? `Level ${currentLvl}` : 'not constructed'}</span>
      </td>
      <td data-cost="${cost.wood}"  class="cost_wood  ${village.wood  < cost.wood  ? 'warn' : ''}">
        <span class="icon header wood"></span>${fmt(cost.wood)}
      </td>
      <td data-cost="${cost.clay}"  class="cost_stone ${village.clay  < cost.clay  ? 'warn' : ''}">
        <span class="icon header stone"></span>${fmt(cost.clay)}
      </td>
      <td data-cost="${cost.iron}"  class="cost_iron  ${village.iron  < cost.iron  ? 'warn' : ''}">
        <span class="icon header iron"></span>${fmt(cost.iron)}
      </td>
      <td><span class="icon header time"></span>${fmtTime(duration)}</td>
      <td><span class="icon header population"></span>${popCost}</td>
      <td class="build_options">
        <a class="btn btn-build${btnDisabled}" data-building="${id}">${label}</a>
        ${!affordable && isFinite(waitHours)
          ? `<div class="inactive">Available in ${fmtTime(Math.ceil(waitHours * 3600))}</div>`
          : ''}
      </td>
    </tr>`;
}

function renderLockedRow(id, village) {
  const b    = BUILDINGS[id];
  const reqs = unmetRequirements(village.buildings, id);
  return `
    <tr>
      <td>
        <img src="${buildingImgSrc(id, 0)}" class="bmain_list_img" alt="${b.name}" style="opacity:.6">
        ${b.name}
      </td>
      <td>${renderUnmetReqs(reqs)}</td>
    </tr>`;
}
