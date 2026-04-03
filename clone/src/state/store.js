// WebSocket-connected game store.
// Keeps the same state shape as the original localStorage store so existing
// UI code continues to work without changes.
// The TICK action is handled locally for smooth resource animation.
// All other game actions are forwarded to the server via WebSocket.

import { tickResources }    from '../engine/resources.js';
import { processBuildQueue } from '../engine/construction.js';
import { processTrainQueue } from '../engine/training.js';

// ── Auth helpers ──────────────────────────────────────────────────────────────

const TOKEN_KEY  = 'tw_token';
const PLAYER_KEY = 'tw_player';

export function saveAuth(token, playerId, playerName) {
  localStorage.setItem(TOKEN_KEY,  token);
  localStorage.setItem(PLAYER_KEY, JSON.stringify({ id: playerId, name: playerName }));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PLAYER_KEY);
}

export function getStoredToken()  { return localStorage.getItem(TOKEN_KEY); }
export function getStoredPlayer() {
  try { return JSON.parse(localStorage.getItem(PLAYER_KEY) ?? 'null'); } catch { return null; }
}

// ── Actions forwarded to the server ──────────────────────────────────────────

const SERVER_ACTIONS = new Set([
  'ENQUEUE_UPGRADE', 'ENQUEUE_TRAINING', 'SEND_ATTACK',
  'CANCEL_TRADE', 'POST_TRADE', 'ACCEPT_TRADE',
  'CREATE_TRIBE', 'JOIN_TRIBE', 'LEAVE_TRIBE', 'SET_DIPLOMACY',
  'POST_FORUM', 'RENAME_VILLAGE', 'GET_MAP', 'GET_REPORTS',
  'GET_TRADE_OFFERS', 'GET_VILLAGE',
  'SEND_MESSAGE', 'GET_MESSAGES', 'GET_PLAYERS',
  'SEND_SUPPORT', 'RECALL_SUPPORT', 'ACTIVATE_MILITIA',
]);

// ── State shape (mirrors old localStorage store) ──────────────────────────────

function blankState() {
  const player = getStoredPlayer() ?? { id: null, name: '', tribeId: null };
  return {
    worldSpeed:    1, // updated from /game/world on connect
    player,
    tribes:        {},          // { [id]: tribe }
    villages:      {},          // { [id]: village }
    activeVillageId: null,
    reports:       [],
    unreadReports: 0,
    messages:       [],
    unreadMessages: 0,
    players:        [],
    mapVillages:   [],
    tradeOffers:   [],
    connected:     false,
    error:         null,
    gameWon:       null,
  };
}

// ── Store internals ───────────────────────────────────────────────────────────

let _state     = blankState();
let _listeners = [];
let _ws        = null;
let _reqId     = 0;
const _pending = new Map(); // requestId → { resolve, reject }

function notify() {
  for (const l of _listeners) l(_state);
}

function setState(patch) {
  _state = { ..._state, ...patch };
  notify();
}

// Merge a server village into local state
function applyVillage(v) {
  if (!v) return;
  setState({
    villages:        { ..._state.villages, [v.id]: v },
    activeVillageId: _state.activeVillageId ?? v.id,
  });
}

// Merge all player villages (from GET_VILLAGE response)
function applyMyVillages(villages) {
  if (!villages?.length) return;
  const merged = { ..._state.villages };
  for (const v of villages) merged[v.id] = v;
  setState({
    villages:        merged,
    activeVillageId: _state.activeVillageId ?? villages[0].id,
  });
}

// Merge a server tribe into local state
function applyTribe(tribe) {
  if (tribe) {
    setState({
      tribes: { ..._state.tribes, [tribe.id]: tribe },
      player: { ..._state.player, tribeId: tribe.id },
    });
  } else {
    setState({ player: { ..._state.player, tribeId: null } });
  }
}

// ── WebSocket connection ──────────────────────────────────────────────────────

export function connect() {
  const token = getStoredToken();
  if (!token || _ws) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _ws = new WebSocket(`${proto}://${location.host}`);

  _ws.addEventListener('open', () => {
    _ws.send(JSON.stringify({ type: 'AUTH', token }));
  });

  _ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleServerMsg(msg);
  });

  _ws.addEventListener('close', () => {
    _ws = null;
    setState({ connected: false });
    if (getStoredToken()) setTimeout(connect, 3000);
  });

  _ws.addEventListener('error', () => {});
}

function handleServerMsg(msg) {
  switch (msg.type) {

    case 'AUTH_OK':
      setState({
        connected: true,
        error: null,
        player: { ..._state.player, id: msg.playerId, name: msg.playerName },
      });
      // Fetch world speed then initial village
      fetch('/game/world').then(r => r.json()).then(d => {
        if (d.worldSpeed) setState({ worldSpeed: d.worldSpeed });
      }).catch(() => {});
      _sendRaw('GET_VILLAGE', {});
      break;

    case 'ERROR':
      resolvePending(msg.requestId, null, msg.error);
      setState({ error: msg.error });
      break;

    case 'ACTION_RESULT': {
      resolvePending(msg.requestId, msg, null);
      if (!msg.ok) { setState({ error: msg.error }); return; }
      setState({ error: null });  // clear stale errors on any successful action
      if (msg.village)    applyVillage(msg.village);
      if (msg.myVillages) applyMyVillages(msg.myVillages);
      if ('tribe' in msg) applyTribe(msg.tribe);
      if (typeof msg.unreadMessages === 'number') setState({ unreadMessages: msg.unreadMessages });
      if (msg.villages) setState({ mapVillages: msg.villages });
      if (msg.reports)  setState({ reports: msg.reports, unreadReports: 0 });
      if (msg.offers)   setState({ tradeOffers: msg.offers });
      if (msg.messages) setState({ messages: msg.messages, unreadMessages: msg.unread ?? 0 });
      if ('unreadMessages' in msg) setState({ unreadMessages: msg.unreadMessages });
      if (msg.players)  setState({ players: msg.players });
      break;
    }

    case 'VILLAGE_UPDATE':
      applyVillage(msg.village);
      break;

    case 'REPORT_UNREAD':
      setState({ unreadReports: _state.unreadReports + 1 });
      break;

    case 'MESSAGE_RECEIVED':
      setState({ unreadMessages: _state.unreadMessages + 1 });
      break;

    case 'GAME_WON':
      setState({ gameWon: msg });
      break;

    case 'VILLAGE_LOST': {
      // Remove the conquered village; switch active if needed
      const remaining = { ..._state.villages };
      delete remaining[msg.villageId];
      const remainingIds = Object.keys(remaining);
      setState({
        villages:        remaining,
        activeVillageId: msg.villageId === _state.activeVillageId
          ? (remainingIds.length ? Number(remainingIds[0]) : null)
          : _state.activeVillageId,
      });
      break;
    }

    case 'RESPAWNED':
      // We have a new village — fetch it
      _sendRaw('GET_VILLAGE', {}).catch(() => {});
      break;
  }
}

function _sendRaw(type, payload) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'));
  const requestId = ++_reqId;
  _ws.send(JSON.stringify({ type, requestId, ...payload }));
  return new Promise((resolve, reject) => {
    _pending.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (_pending.has(requestId)) { _pending.delete(requestId); reject(new Error('Timeout')); }
    }, 10000);
  });
}

function resolvePending(requestId, result, error) {
  const p = _pending.get(requestId);
  if (!p) return;
  _pending.delete(requestId);
  if (error) p.reject(new Error(error));
  else p.resolve(result);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const store = {
  getState()      { return _state; },
  activeVillage() { return _state.villages[_state.activeVillageId] ?? null; },
  isConnected()   { return _state.connected; },

  dispatch(action, payload = {}) {
    if (action === 'TICK') {
      // Animate resources locally between server syncs
      const v = this.activeVillage();
      if (!v) return;
      const now = payload.now ?? Date.now();
      const resources  = tickResources(v, now, _state.worldSpeed);
      const { buildings, buildQueue } = processBuildQueue(v, now);
      const { units, trainQueue }     = processTrainQueue(v, now);
      setState({
        villages: {
          ..._state.villages,
          [v.id]: {
            ...v, ...resources,
            buildings: { ...v.buildings, ...buildings },
            units, buildQueue, trainQueue, lastTick: now,
          },
        },
      });
      return;
    }

    if (SERVER_ACTIONS.has(action)) {
      const p = _sendRaw(action, payload);
      p.catch(e => setState({ error: e.message }));
      return p;
    }
  },

  subscribe(listener) {
    _listeners.push(listener);
    return () => { _listeners = _listeners.filter(l => l !== listener); };
  },
};
