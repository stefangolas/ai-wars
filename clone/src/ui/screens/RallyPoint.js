// Rally Point screen — troop overview and attack simulator.
import { UNITS } from '../../data/units.js';
import { simulateBattle } from '../../engine/combat.js';
import { fmt, fmtTime } from '../utils.js';
import { store } from '../../state/store.js';

export default {
  mount(container, state) {
    this._render(container, state);
    this._bindEvents(container);
  },

  update(container, state) {
    const wasOpen = container.querySelector('#sim-results');
    this._render(container, state);
    this._bindEvents(container);
  },

  _render(container, state) {
    // Pre-fill coords if navigated here from the map
    this._mapTarget = window._mapTarget ?? null;
    if (window._mapTarget) window._mapTarget = null;
    const village = state.villages[state.activeVillageId];
    container.innerHTML = `
      <div id="rally-screen">
        <h3>Rally Point</h3>
        <div class="screen-layout">
          <div class="screen-main">
            ${renderTroopOverview(village)}
            <hr>
            ${renderAttackForm(village, this._mapTarget)}
            <hr>
            ${renderCombatSim(village)}
          </div>
          <div class="screen-sidebar">
            ${renderOutgoing(village)}
            ${renderIncoming(village)}
          </div>
        </div>
      </div>`;
  },

  _bindEvents(container) {
    container.querySelector('#btn-simulate')?.addEventListener('click', () => {
      runSimulation(container);
    });

    container.querySelector('#attack-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const tx  = parseInt(fd.get('target_x'), 10);
      const ty  = parseInt(fd.get('target_y'), 10);
      if (!tx || !ty) { alert('Enter target coordinates.'); return; }

      // Try cached village id (set when clicking Attack from the map)
      let toVillageId = parseInt(fd.get('target_village_id'), 10) || null;

      // Fall back to mapVillages lookup
      if (!toVillageId) {
        const found = store.getState().mapVillages?.find(v => v.x === tx && v.y === ty);
        if (found) toVillageId = found.id;
      }

      if (!toVillageId) {
        alert('Village not found at those coordinates. Open the Map first to load village data.');
        return;
      }

      const units = {};
      container.querySelectorAll('.atk-unit-input').forEach(inp => {
        const n = parseInt(inp.value, 10) || 0;
        if (n > 0) units[inp.dataset.unit] = n;
      });
      if (Object.keys(units).length === 0) { alert('Select at least one unit.'); return; }
      store.dispatch('SEND_ATTACK', { toVillageId, units });
    });
  },
};

function renderTroopOverview(village) {
  const rows = Object.entries(UNITS)
    .filter(([id]) => id !== 'militia')
    .map(([id, u]) => {
      const count = village.units[id] ?? 0;
      return `
        <tr>
          <td>
            <img src="assets/graphic/unit/${id}.webp" style="vertical-align:middle" alt="">
            ${u.name}
          </td>
          <td style="text-align:center">${count}</td>
          <td style="text-align:center">${u.attack}</td>
          <td style="text-align:center">${u.defense.general}</td>
          <td style="text-align:center">${u.defense.cavalry}</td>
          <td style="text-align:center">${u.defense.archer}</td>
          <td style="text-align:center">${u.haul}</td>
        </tr>`;
    });

  return `
    <h4>Troops in village</h4>
    <table class="vis" style="width:100%">
      <thead>
        <tr>
          <th>Unit</th><th>Count</th>
          <th title="Attack">Att</th>
          <th title="Defense vs General">Def</th>
          <th title="Defense vs Cavalry">Def Cav</th>
          <th title="Defense vs Archer">Def Arch</th>
          <th title="Haul capacity">Haul</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderCombatSim(village) {
  const unitInputs = Object.entries(UNITS)
    .filter(([id]) => id !== 'militia' && id !== 'snob')
    .map(([id, u]) => `
      <tr>
        <td>
          <img src="assets/graphic/unit/${id}.webp" style="vertical-align:middle" alt="">
          ${u.name}
        </td>
        <td><input type="number" class="sim-input" data-unit="${id}" data-side="atk"
                   min="0" value="${village.units[id] ?? 0}" style="width:60px"></td>
        <td><input type="number" class="sim-input" data-unit="${id}" data-side="def"
                   min="0" value="0" style="width:60px"></td>
      </tr>`).join('');

  return `
    <h4>Battle Simulator</h4>
    <table class="vis" style="width:100%">
      <thead>
        <tr><th>Unit</th><th>Attacker</th><th>Defender</th></tr>
      </thead>
      <tbody>${unitInputs}</tbody>
    </table>
    <div style="margin-top:8px">
      <label>Defender wall level:
        <input type="number" id="sim-wall" min="0" max="20" value="0" style="width:50px">
      </label>
      &nbsp;
      <button class="btn btn-simulate" id="btn-simulate">Simulate</button>
    </div>
    <div id="sim-results"></div>`;
}

function renderAttackForm(village, mapTarget) {
  const unitRows = Object.entries(UNITS)
    .filter(([id]) => id !== 'militia' && id !== 'snob' && (village.units[id] ?? 0) > 0)
    .map(([id, u]) => `
      <tr>
        <td>
          <img src="assets/graphic/unit/${id}.webp" style="vertical-align:middle" alt="">
          ${u.name}
        </td>
        <td style="text-align:center">${village.units[id] ?? 0}</td>
        <td><input type="number" class="atk-unit-input" data-unit="${id}"
                   min="0" max="${village.units[id] ?? 0}" value="0" style="width:60px"></td>
      </tr>`).join('');

  return `
    <h4>Send attack</h4>
    <form id="attack-form">
      <div style="margin-bottom:8px">
        Target:
        X <input type="number" name="target_x" style="width:60px" min="1" max="500"
                 value="${mapTarget?.x ?? ''}">
        Y <input type="number" name="target_y" style="width:60px" min="1" max="500"
                 value="${mapTarget?.y ?? ''}">
        <input type="hidden" name="target_village_id" value="${mapTarget?.id ?? ''}">
        <button type="button" class="btn btn-small" id="btn-preview-target">Preview</button>
      </div>
      ${unitRows.length ? `
        <table class="vis" style="width:100%">
          <thead><tr><th>Unit</th><th>Available</th><th>Send</th></tr></thead>
          <tbody>${unitRows}</tbody>
        </table>
        <button type="submit" class="btn" style="margin-top:8px">Send attack</button>
      ` : `<p class="inactive">No troops available to send.</p>`}
    </form>`;
}

function renderOutgoing(village) {
  if (!village.outgoingCommands?.length) {
    return `<h4>Outgoing</h4><p class="inactive">No active commands.</p>`;
  }
  return `
    <h4>Outgoing</h4>
    <table class="vis">
      <thead><tr><th>Target</th><th>Arrives</th></tr></thead>
      <tbody>
        ${village.outgoingCommands.map(c => `
          <tr>
            <td>${c.targetName ?? ''} (${c.targetX}|${c.targetY})</td>
            <td>${fmtTime(Math.max(0, Math.ceil((c.arrivalTime - Date.now()) / 1000)))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderIncoming(village) {
  if (!village.incomingCommands?.length) return '';
  return `
    <h4>Incoming attacks</h4>
    <table class="vis">
      <thead><tr><th>Origin</th><th>Arrives</th></tr></thead>
      <tbody>
        ${village.incomingCommands.map(c => `
          <tr>
            <td>${c.originName ?? ''} (${c.originX}|${c.originY})</td>
            <td>${fmtTime(Math.max(0, Math.ceil((c.arrivalTime - Date.now()) / 1000)))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function runSimulation(container) {
  const attackers = {}, defenders = {};
  container.querySelectorAll('.sim-input').forEach(input => {
    const count = parseInt(input.value, 10) || 0;
    if (count <= 0) return;
    if (input.dataset.side === 'atk') attackers[input.dataset.unit] = count;
    else                              defenders[input.dataset.unit] = count;
  });
  const wallLevel = parseInt(container.querySelector('#sim-wall')?.value, 10) || 0;

  const result  = simulateBattle(attackers, defenders, wallLevel);
  const resultsEl = container.querySelector('#sim-results');
  if (!resultsEl) return;

  resultsEl.innerHTML = `
    <div class="sim-result ${result.attackerWon ? 'sim-win' : 'sim-loss'}">
      <strong>${result.attackerWon ? '⚔ Attacker wins' : '🛡 Defender wins'}</strong>
      <div class="sim-log">${result.log.map(l => `<div>${l}</div>`).join('')}</div>
      <div class="sim-survivors">
        <div>
          <strong>Attacker survivors:</strong>
          ${renderSurvivors(result.attackerSurvivors)}
        </div>
        <div>
          <strong>Defender survivors:</strong>
          ${renderSurvivors(result.defenderSurvivors)}
        </div>
      </div>
      ${result.wallDamage > 0
        ? `<div class="inactive">Wall damaged by ${result.wallDamage} level(s)</div>`
        : ''}
    </div>`;
}

function renderSurvivors(units) {
  const active = Object.entries(units).filter(([, n]) => n > 0);
  if (active.length === 0) return '<span class="inactive">None</span>';
  return active.map(([id, n]) =>
    `<span><img src="assets/graphic/unit/${id}.webp" style="vertical-align:middle;height:16px" alt=""> ${n}</span>`
  ).join(' &nbsp; ');
}
