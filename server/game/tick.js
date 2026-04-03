// Launches the tick loop in a Worker thread so the main event loop is never blocked.
// Routes broadcast messages from the worker to the right WebSocket connections.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { broadcast } from '../ws/handler.js';

const __dir = dirname(fileURLToPath(import.meta.url));

export function startTick() {
  const worker = new Worker(join(__dir, 'tick.worker.js'));

  worker.on('message', msg => {
    if (msg.type === 'broadcast') broadcast(msg.playerId, msg.data);
  });

  worker.on('error', err => {
    console.error('[tick] Worker error:', err.message);
  });

  // Auto-restart on crash so the game loop is never silently dead.
  worker.on('exit', code => {
    if (code !== 0) {
      console.error(`[tick] Worker exited with code ${code} — restarting in 1s`);
      setTimeout(startTick, 1000);
    }
  });
}
