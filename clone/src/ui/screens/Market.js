// Market screen — post trade offers, view and accept incoming offers.
import { BUILDINGS, MARKET_MERCHANTS, STORAGE_CAPACITY } from '../../data/buildings.js';
import { store }  from '../../state/store.js';
import { fmt }    from '../utils.js';

export default {
  mount(container, state) {
    this._render(container, state);
    this._bindEvents(container, state);
  },

  update(container, state) {
    this._render(container, state);
    this._bindEvents(container, state);
  },

  _render(container, state) {
    const village = state.villages[state.activeVillageId];
    const mLevel  = village.buildings.market ?? 0;

    if (mLevel === 0) {
      container.innerHTML = `<div class="not-built-msg">
        <p><strong>Market</strong> has not been constructed yet.</p>
        <p><a href="#main" data-nav="main">Go to Headquarters</a> to build it.</p>
      </div>`;
      return;
    }

    const merchants = MARKET_MERCHANTS[mLevel];
    const usedMerchants = (village.tradeOffers ?? []).reduce((s, o) => s + o.merchants, 0);
    const freeMerchants = merchants - usedMerchants;

    container.innerHTML = `
      <div id="market-screen">
        <h3>Market — Level ${mLevel}</h3>
        <p class="market-info">
          Merchants: <strong>${freeMerchants} / ${merchants}</strong> available
          &nbsp;·&nbsp; Carry capacity: <strong>1,000</strong> resources each
        </p>

        <div class="screen-layout">
          <div class="screen-main">

            <h4>Send resources</h4>
            <form id="trade-form" class="vis trade-form">
              <table class="vis" style="width:100%">
                <thead>
                  <tr>
                    <th>Offer</th><th>Amount</th><th>Request</th><th>Amount</th><th>Merchants</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <select name="offer_res" class="trade-select">
                        <option value="wood">Wood</option>
                        <option value="clay">Clay</option>
                        <option value="iron">Iron</option>
                      </select>
                    </td>
                    <td><input type="number" name="offer_amt" min="0" max="${STORAGE_CAPACITY[mLevel]}"
                               class="trade-input" placeholder="0"></td>
                    <td>
                      <select name="want_res" class="trade-select">
                        <option value="clay">Clay</option>
                        <option value="wood">Wood</option>
                        <option value="iron">Iron</option>
                      </select>
                    </td>
                    <td><input type="number" name="want_amt" min="0" max="${STORAGE_CAPACITY[mLevel]}"
                               class="trade-input" placeholder="0"></td>
                    <td id="merchants-needed">—</td>
                    <td><button type="submit" class="btn btn-trade" ${freeMerchants === 0 ? 'disabled' : ''}>Post Offer</button></td>
                  </tr>
                </tbody>
              </table>
              <div class="trade-resources">
                Available:
                <span class="icon header wood"></span> ${fmt(village.wood)} &nbsp;
                <span class="icon header stone"></span> ${fmt(village.clay)} &nbsp;
                <span class="icon header iron"></span> ${fmt(village.iron)}
              </div>
            </form>

            <h4>Your active offers</h4>
            ${renderActiveOffers(village)}

          </div>

          <div class="screen-sidebar">
            <h4>NPC Market</h4>
            <p class="inactive">Trade with NPC villages at 1:1 ratio (coming soon).</p>
          </div>
        </div>
      </div>`;
  },

  _bindEvents(container, state) {
    // Merchant count preview
    const offerAmt = container.querySelector('[name="offer_amt"]');
    const merchantDisplay = container.querySelector('#merchants-needed');
    if (offerAmt && merchantDisplay) {
      offerAmt.addEventListener('input', () => {
        const amt = parseInt(offerAmt.value, 10) || 0;
        const needed = Math.ceil(amt / 1000);
        merchantDisplay.textContent = needed > 0 ? `${needed} merchant${needed !== 1 ? 's' : ''}` : '—';
      });
    }

    // Post offer
    const form = container.querySelector('#trade-form');
    form?.addEventListener('submit', e => {
      e.preventDefault();
      const data     = new FormData(form);
      const offerRes = data.get('offer_res');
      const offerAmt = Math.floor(parseFloat(data.get('offer_amt'))) || 0;
      const wantRes  = data.get('want_res');
      const wantAmt  = Math.floor(parseFloat(data.get('want_amt'))) || 0;
      if (offerRes === wantRes) { alert('Cannot trade a resource for itself.'); return; }
      if (offerAmt <= 0)        { alert('Offer amount must be positive.'); return; }
      if (wantAmt  <= 0)        { alert('Request amount must be positive.'); return; }
      store.dispatch('POST_TRADE', { offerRes, offerAmt, wantRes, wantAmt });
    });

    // Cancel offer
    container.querySelectorAll('.btn-cancel-offer').forEach(btn => {
      btn.addEventListener('click', () => {
        store.dispatch('CANCEL_TRADE', { offerId: parseInt(btn.dataset.offerId, 10) });
      });
    });
  },
};

function renderActiveOffers(village) {
  if (!village.tradeOffers?.length) {
    return `<p class="inactive">No active offers.</p>`;
  }

  const NAMES = { wood: 'Wood', clay: 'Clay', iron: 'Iron' };
  return `
    <table class="vis" style="width:100%">
      <thead><tr><th>Offering</th><th>Requesting</th><th>Merchants</th><th></th></tr></thead>
      <tbody>
        ${village.tradeOffers.map(o => `
          <tr>
            <td>${fmt(o.offerAmt)} ${NAMES[o.offerRes] ?? o.offerRes}</td>
            <td>${fmt(o.wantAmt)} ${NAMES[o.wantRes] ?? o.wantRes}</td>
            <td>${o.merchants}</td>
            <td><button class="btn btn-cancel-offer btn-small" data-offer-id="${o.id}">Cancel</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
