// WebSocket connection manager.
// Authenticates clients via JWT, routes messages to action handlers,
// broadcasts state updates back to affected players.

import { WebSocketServer } from 'ws';
import { verifyToken } from '../auth/auth.js';
import { ACTIONS, setBroadcast } from '../game/actions.js';
import { RateLimiter } from '../lib/rateLimiter.js';

const wsLimiter = new RateLimiter(30, 10_000);

// playerId → Set<WebSocket>
const connections = new Map();

export function initWss(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    // Expect first message to be { type: 'AUTH', token }
    let playerId = null;

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return ws.send(err('Invalid JSON')); }

      // ── Auth handshake ───────────────────────────────────────────────────
      if (!playerId) {
        if (msg.type !== 'AUTH') return ws.send(err('Send AUTH first'));
        const payload = verifyToken(msg.token);
        if (!payload) return ws.send(err('Invalid token'));

        playerId = payload.id;
        if (!connections.has(playerId)) connections.set(playerId, new Set());
        connections.get(playerId).add(ws);

        ws.send(JSON.stringify({ type: 'AUTH_OK', playerId, playerName: payload.name }));
        console.log(`[ws] Player ${payload.name} (${playerId}) connected`);
        return;
      }

      // ── Rate limit ───────────────────────────────────────────────────────
      if (!wsLimiter.allow(playerId)) {
        return ws.send(JSON.stringify({ type: 'ERROR', error: 'Rate limit exceeded — slow down' }));
      }

      // ── Dispatch action ──────────────────────────────────────────────────
      const { type, requestId, ...payload } = msg;
      const handler = ACTIONS[type];
      if (!handler) return ws.send(err(`Unknown action: ${type}`, requestId));

      let result;
      try {
        result = handler({ playerId, ...payload });
      } catch (e) {
        console.error(`[ws] Action ${type} threw:`, e);
        return ws.send(err('Server error', requestId));
      }

      ws.send(JSON.stringify({ type: 'ACTION_RESULT', requestId, ...result }));
    });

    ws.on('close', () => {
      if (playerId) {
        const set = connections.get(playerId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) connections.delete(playerId);
        }
        console.log(`[ws] Player ${playerId} disconnected`);
      }
    });

    ws.on('error', e => console.error('[ws] Socket error:', e.message));
  });

  setBroadcast(broadcast);
  console.log('[ws] WebSocket server attached');
  return wss;
}

// Send a message to all open sockets for a given player
export function broadcast(playerId, data) {
  const set = connections.get(playerId);
  if (!set) return;
  const msg = JSON.stringify(data);
  for (const ws of set) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg);
  }
}

function err(message, requestId) {
  return JSON.stringify({ type: 'ERROR', requestId, error: message });
}
