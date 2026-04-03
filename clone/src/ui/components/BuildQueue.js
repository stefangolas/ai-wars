// Build and training queue sidebar component.
import { BUILDINGS } from '../../data/buildings.js';
import { UNITS }     from '../../data/units.js';
import { fmtCountdown } from '../utils.js';

export function renderBuildQueue(village) {
  const items = village.buildQueue;
  if (items.length === 0) return '<div class="queue-empty">No buildings queued</div>';

  return `
    <table class="vis queue-table">
      <tr><th colspan="3">Build Queue</th></tr>
      ${items.map((item, i) => {
        const name = BUILDINGS[item.building]?.name ?? item.building;
        const countdown = fmtCountdown(item.finishTime);
        return `
          <tr class="${i % 2 === 0 ? 'row_a' : 'row_b'}">
            <td>
              <img src="assets/graphic/buildings/${item.building}.webp" class="queue-icon" alt="">
              ${name}
            </td>
            <td>→ Lv ${item.level}</td>
            <td class="queue-time" data-finish="${item.finishTime}">${countdown}</td>
          </tr>`;
      }).join('')}
    </table>`;
}

export function renderTrainQueue(village) {
  const items = village.trainQueue;
  if (items.length === 0) return '<div class="queue-empty">No units queued</div>';

  return `
    <table class="vis queue-table">
      <tr><th colspan="3">Training Queue</th></tr>
      ${items.map((item, i) => {
        const name = UNITS[item.unit]?.name ?? item.unit;
        const countdown = fmtCountdown(item.finishTime);
        return `
          <tr class="${i % 2 === 0 ? 'row_a' : 'row_b'}">
            <td>
              <img src="assets/graphic/unit/${item.unit}.webp" class="queue-icon" alt="">
              ${name}
            </td>
            <td>×${item.count}</td>
            <td class="queue-time" data-finish="${item.finishTime}">${countdown}</td>
          </tr>`;
      }).join('')}
    </table>`;
}

// Refresh countdown timers in-place without re-rendering.
export function tickQueueTimers() {
  document.querySelectorAll('.queue-time[data-finish]').forEach(el => {
    el.textContent = fmtCountdown(parseInt(el.dataset.finish, 10));
  });
}
