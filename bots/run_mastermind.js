/**
 * Runs a single high-intelligence "Scheming Mastermind" bot
 * using a more capable model than the standard fleet.
 *
 * Usage:
 *   node run_mastermind.js
 *
 * Required env:
 *   GEMINI_API_KEY
 *
 * Optional env:
 *   BOT_PASSWORD   (default: botpass123)
 *   SERVER_URL     (default: http://localhost:3000)
 *   MASTERMIND_MODEL (default: gemini-2.5-pro-preview)
 *   MASTERMIND_INTERVAL_MS  (default: 12000 — one turn every 12s)
 */

import { spawn }         from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

const NAME        = 'Scheming Mastermind';
const PASSWORD    = process.env.BOT_PASSWORD        ?? 'botpass123';
const SERVER_URL  = process.env.SERVER_URL           ?? 'http://localhost:3000';
const MODEL       = process.env.MASTERMIND_MODEL     ?? 'models/gemini-3.1-pro-preview';
const INTERVAL_MS = parseInt(process.env.MASTERMIND_INTERVAL_MS ?? '12000', 10);

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY env var is required');
  process.exit(1);
}

console.log(`[mastermind] Launching "${NAME}" with model ${MODEL}`);
console.log(`[mastermind] Turn interval: ${INTERVAL_MS}ms`);

let proc = null;
let busy = false;
let restarts = 0;
let shuttingDown = false;
let turnTimer = null;

function spawnMastermind() {
  busy = false;

  proc = spawn(process.execPath, [join(__dir, 'bot.js'), NAME, PASSWORD], {
    env: {
      ...process.env,
      SERVER_URL,
      BOT_MODEL: MODEL,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  proc.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    for (const line of lines) {
      if (line === '[DONE]') {
        busy = false;
      } else if (line.trim()) {
        console.log(line);
      }
    }
  });

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    for (const line of lines) if (line.trim()) console.error(`[${NAME}][ERR] ${line}`);
  });

  proc.on('exit', (code, signal) => {
    proc = null;
    busy = false;
    if (shuttingDown) return;
    const delay = Math.min(1000 * Math.pow(2, Math.min(restarts, 6)), 30_000);
    restarts++;
    console.error(`[mastermind] exited (code=${code}) — restart #${restarts} in ${(delay/1000).toFixed(1)}s`);
    setTimeout(spawnMastermind, delay);
  });
}

function sendTurn() {
  if (shuttingDown) return;
  if (proc && !busy) {
    busy = true;
    proc.stdin.write('TURN\n');
  }
}

function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(turnTimer);
  console.log(`\n[mastermind] ${sig} — stopping…`);
  if (proc) proc.kill('SIGTERM');
  setTimeout(() => { if (proc) proc.kill('SIGKILL'); process.exit(0); }, 3000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

spawnMastermind();
// Give bot time to register before first turn
setTimeout(() => {
  sendTurn();
  turnTimer = setInterval(sendTurn, INTERVAL_MS);
}, 5000);
