// Hash-based screen router with auth gate.
// On load: if no token → show Login screen.
// After auth: connect WebSocket, show game UI.

import { store, connect, getStoredToken, clearAuth } from '../state/store.js';
import { renderResourceBar, updateResourceBar } from './components/ResourceBar.js';
import { tickQueueTimers } from './components/BuildQueue.js';

import Overview      from './screens/Overview.js';
import Headquarters  from './screens/Headquarters.js';
import Market        from './screens/Market.js';
import RallyPoint    from './screens/RallyPoint.js';
import Tribe         from './screens/Tribe.js';
import Map           from './screens/Map.js';
import Messages      from './screens/Messages.js';
import Login         from './screens/Login.js';
import { createTrainingScreen } from './screens/TrainingScreen.js';

const Barracks = createTrainingScreen('barracks');
const Stable   = createTrainingScreen('stable');
const Workshop = createTrainingScreen('garage');

const SCREENS = {
  overview: Overview,
  main:     Headquarters,
  barracks: Barracks,
  stable:   Stable,
  garage:   Workshop,
  place:    RallyPoint,
  market:   Market,
  ally:     Tribe,
  map:      Map,
  messages: Messages,
  wood: Headquarters, stone: Headquarters, iron: Headquarters,
  farm: Headquarters, storage: Headquarters, hide: Headquarters,
  wall: Headquarters, smith: Headquarters, statue: Headquarters, snob: Headquarters,
};

let _currentScreenId = null;
let _currentScreen   = null;
let _contentEl       = null;
let _resourceBarEl   = null;
let _navEl           = null;
let _gameStarted     = false;

export function navigate(screenId) {
  location.hash = screenId;
}

export function initRouter(contentEl, resourceBarEl, navEl) {
  _contentEl     = contentEl;
  _resourceBarEl = resourceBarEl;
  _navEl         = navEl;

  if (!getStoredToken()) {
    showLogin();
    return;
  }

  bootGame();
}

function showLogin() {
  if (_resourceBarEl) _resourceBarEl.innerHTML = '';
  if (_navEl)         _navEl.style.display = 'none';
  Login.mount(_contentEl, bootGame);
}

function bootGame() {
  if (_gameStarted) return; // guard against double-call
  if (_navEl) _navEl.style.display = '';

  connect();

  // Single subscriber: wait for village data then start rendering
  store.subscribe(state => {
    const v = store.activeVillage();
    if (!_gameStarted && v) {
      _gameStarted = true;
      window.addEventListener('hashchange', () => _route());
      _route();
      setInterval(() => {
        store.dispatch('TICK', { now: Date.now() });
        tickQueueTimers();
      }, 1000);
      return; // _route already rendered
    }
    if (_gameStarted) {
      if (v) updateResourceBar(v, state.worldSpeed);
      _currentScreen?.update?.(_contentEl, state);
      updateNavHighlight(state);
      updateGameWonBanner(state);
    }
  });

  _contentEl.innerHTML = '<p style="text-align:center;padding:2em;color:#888">Connecting to server…</p>';
}

function _route() {
  const hash     = location.hash.slice(1) || 'overview';
  const screenId = hash.split('?')[0];
  const Screen   = SCREENS[screenId] ?? Overview;

  _currentScreen?.unmount?.();
  _currentScreenId = screenId;
  _currentScreen   = Screen;

  const state = store.getState();
  const v     = store.activeVillage();

  if (_resourceBarEl && v) {
    _resourceBarEl.innerHTML = renderResourceBar(v, state.worldSpeed);
  }

  updateNavHighlight(state);
  Screen.mount(_contentEl, state);
}

let _gameWonBanner = null;

function updateGameWonBanner(state) {
  if (!state.gameWon || _gameWonBanner) return;
  const w = state.gameWon;
  _gameWonBanner = document.createElement('div');
  _gameWonBanner.id = 'game-won-banner';
  _gameWonBanner.style.cssText = [
    'position:fixed;top:0;left:0;right:0;bottom:0',
    'background:rgba(0,0,0,0.75)',
    'display:flex;align-items:center;justify-content:center',
    'z-index:9999;flex-direction:column;gap:16px',
  ].join(';');
  _gameWonBanner.innerHTML = `
    <div style="background:#2a1a00;border:3px solid #c84;padding:40px 60px;text-align:center;max-width:500px">
      <div style="font-size:2em;color:#f0a000;margin-bottom:12px">⚔ Game Over ⚔</div>
      <div style="font-size:1.4em;color:#fff;margin-bottom:8px">
        [${w.tribeTag}] ${w.tribeName}
      </div>
      <div style="color:#aaa">has conquered the world!</div>
      <div style="color:#888;font-size:0.9em;margin-top:8px">
        ${w.percentage}% of all villages (${w.villageCount} / ${w.totalVillages})
      </div>
      <button id="btn-close-banner" style="margin-top:24px;padding:8px 24px;background:#c84;border:none;color:#000;font-weight:bold;cursor:pointer;font-size:1em">
        Continue Playing
      </button>
    </div>`;
  document.body.appendChild(_gameWonBanner);
  _gameWonBanner.querySelector('#btn-close-banner').addEventListener('click', () => {
    _gameWonBanner.style.display = 'none';
  });
}

function updateNavHighlight(state) {
  if (!_navEl) return;
  _navEl.querySelectorAll('[data-screen]').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === _currentScreenId);
  });

  // Unread report badge
  const reportsLink = _navEl.querySelector('[data-screen="reports"]');
  if (reportsLink && state.unreadReports > 0) {
    reportsLink.dataset.badge = state.unreadReports;
  }

  // Loyalty warning badge on current village name
  const nameEl = _navEl.querySelector('#village-name');
  if (nameEl) {
    const v = store.activeVillage();
    nameEl.textContent = v?.name ?? 'Village';
    if (v && v.loyalty < 100) {
      nameEl.title = `Loyalty: ${v.loyalty}`;
      nameEl.style.color = v.loyalty <= 50 ? '#c44' : '#c84';
    } else if (nameEl.style.color) {
      nameEl.style.color = '';
      nameEl.title = '';
    }
  }

  // Unread message badge
  const messagesLink = _navEl.querySelector('[data-screen="messages"]');
  if (messagesLink) {
    if (state.unreadMessages > 0) {
      messagesLink.dataset.badge = state.unreadMessages;
    } else {
      delete messagesLink.dataset.badge;
    }
  }
}
