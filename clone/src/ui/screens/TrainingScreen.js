// Generic training screen factory used by Barracks, Stable, and Workshop.
// Each training screen is just this factory called with a different building/unit list.
import { BUILDINGS }    from '../../data/buildings.js';
import { UNITS, UNITS_BY_BUILDING } from '../../data/units.js';
import { unitTrainTime, unitRequirementsMet, unmetUnitRequirements, enqueueTraining }
  from '../../engine/training.js';
import { productionPerHour } from '../../engine/resources.js';
import { renderTrainQueue }  from '../components/BuildQueue.js';
import { renderUnmetReqs, fmt, fmtTime } from '../utils.js';
import { store } from '../../state/store.js';

export function createTrainingScreen(buildingId) {
  return {
    mount(container, state) {
      const v        = state.villages[state.activeVillageId];
      this._snapshot = JSON.stringify({ b: v?.buildings, u: v?.units, q: v?.trainQueue });
      this._render(container, state);
      this._bindEvents(container);
    },

    update(container, state) {
      // Only re-render when units/queue/buildings change — not on every resource tick
      const v        = state.villages[state.activeVillageId];
      const snapshot = JSON.stringify({ b: v?.buildings, u: v?.units, q: v?.trainQueue });
      if (snapshot === this._snapshot) return;
      this._snapshot = snapshot;
      this._render(container, state);
      this._bindEvents(container);
    },

    _render(container, state) {
      const village = state.villages[state.activeVillageId];
      const bLevel  = village.buildings[buildingId] ?? 0;
      const bName   = BUILDINGS[buildingId]?.name ?? buildingId;
      const unitIds = UNITS_BY_BUILDING[buildingId] ?? [];

      if (bLevel === 0) {
        container.innerHTML = notBuiltMsg(bName, BUILDINGS[buildingId]);
        return;
      }

      const available = unitIds.filter(id  => unitRequirementsMet(village.buildings, id));
      const locked    = unitIds.filter(id  => !unitRequirementsMet(village.buildings, id));

      container.innerHTML = `
        <div class="training-screen">
          <div class="screen-layout">
            <div class="screen-main">
              <h3>${bName} — Level ${bLevel}</h3>

              <form id="train_form" autocomplete="off">
                <table class="vis" style="width:100%">
                  <thead>
                    <tr>
                      <th style="width:20%">Unit</th>
                      <th style="min-width:400px">Cost (×1 unit)</th>
                      <th>In village</th>
                      <th style="width:120px">Recruit</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${available.map((id, i) => renderUnitRow(id, village, bLevel, state.worldSpeed, i)).join('')}
                    <tr>
                      <td colspan="3"></td>
                      <td><button type="submit" class="btn btn-recruit" id="btn-recruit">Recruit</button></td>
                    </tr>
                  </tbody>
                </table>
              </form>

              ${locked.length > 0 ? `
                <h3 class="section-title">Not yet available</h3>
                <table class="vis" style="width:100%">
                  <thead>
                    <tr>
                      <th style="width:25%">Unit</th>
                      <th>Requirements</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${locked.map(id => renderLockedUnitRow(id, village)).join('')}
                  </tbody>
                </table>` : ''}
            </div>

            <div class="screen-sidebar">
              ${renderTrainQueue(village)}
            </div>
          </div>
        </div>`;
    },

    _bindEvents(container) {
      const form = container.querySelector('#train_form');
      if (!form) return;

      form.addEventListener('submit', e => {
        e.preventDefault();
        const inputs = form.querySelectorAll('input.recruit_unit');
        let anyQueued = false;

        inputs.forEach(input => {
          const count = parseInt(input.value, 10);
          if (!count || count <= 0) return;
          const unitId  = input.dataset.unit;
          const village = store.activeVillage();
          const result  = enqueueTraining({ ...village }, unitId, count, store.getState().worldSpeed);
          if (result.ok) {
            store.dispatch('ENQUEUE_TRAINING', { unit: unitId, count });
            anyQueued = true;
          }
        });

        if (anyQueued) {
          form.querySelectorAll('input.recruit_unit').forEach(i => { i.value = ''; });
        }
      });

      // Max button per unit
      container.querySelectorAll('.btn-max').forEach(btn => {
        btn.addEventListener('click', () => {
          const unitId  = btn.dataset.unit;
          const village = store.activeVillage();
          const u       = UNITS[unitId];
          const cap     = store.getState().villages[store.getState().activeVillageId].clay; // reuse village
          const maxByWood  = u.cost.wood > 0 ? Math.floor(village.wood / u.cost.wood) : Infinity;
          const maxByClay  = u.cost.clay > 0 ? Math.floor(village.clay / u.cost.clay) : Infinity;
          const maxByIron  = u.cost.iron > 0 ? Math.floor(village.iron / u.cost.iron) : Infinity;
          const maxCount   = Math.min(maxByWood, maxByClay, maxByIron, 9999);
          const input      = container.querySelector(`input[data-unit="${unitId}"]`);
          if (input) input.value = maxCount > 0 ? maxCount : '';
        });
      });
    },
  };
}

function renderUnitRow(unitId, village, buildingLevel, worldSpeed, rowIndex) {
  const u       = UNITS[unitId];
  const count   = village.units[unitId] ?? 0;
  const time    = unitTrainTime(unitId, buildingLevel, worldSpeed);
  const canAfford1 = village.wood >= u.cost.wood && village.clay >= u.cost.clay && village.iron >= u.cost.iron;

  return `
    <tr class="${rowIndex % 2 === 0 ? 'row_a' : 'row_b'}">
      <td class="nowrap">
        <img src="assets/graphic/unit/${unitId}.webp" style="vertical-align:middle" alt="">
        ${u.name}
      </td>
      <td>
        <div class="recruit_req">
          <span><span class="icon header wood"></span>
            <span class="${village.wood < u.cost.wood ? 'warn' : ''}">${fmt(u.cost.wood)}</span></span>
          <span><span class="icon header stone"></span>
            <span class="${village.clay < u.cost.clay ? 'warn' : ''}">${fmt(u.cost.clay)}</span></span>
          <span><span class="icon header iron"></span>
            <span class="${village.iron < u.cost.iron ? 'warn' : ''}">${fmt(u.cost.iron)}</span></span>
          <span><span class="icon header population"></span>${u.pop}</span>
          <span><span class="icon header time"></span>${fmtTime(time)}</span>
        </div>
      </td>
      <td style="text-align:center">${count}</td>
      <td>
        <input type="text" class="recruit_unit" data-unit="${unitId}"
               name="${unitId}" maxlength="5" style="width:50px"
               ${!canAfford1 ? 'placeholder="0"' : ''}>
        <button type="button" class="btn-max btn-small" data-unit="${unitId}">Max</button>
      </td>
    </tr>`;
}

function renderLockedUnitRow(unitId, village) {
  const u    = UNITS[unitId];
  const reqs = unmetUnitRequirements(village.buildings, unitId);
  return `
    <tr style="line-height:30px">
      <td>
        <img src="assets/graphic/unit/${unitId}.webp" style="opacity:.7;vertical-align:middle" alt="">
        ${u.name}
      </td>
      <td>${renderUnmetReqs(reqs)}</td>
    </tr>`;
}

function notBuiltMsg(name, building) {
  return `
    <div class="not-built-msg">
      <p><strong>${name}</strong> has not been constructed yet.</p>
      <p><a href="#main" data-nav="main">Go to Headquarters</a> to build it.</p>
    </div>`;
}
