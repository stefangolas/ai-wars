/**
 * Personal bot — "stefan" — running on villagewars.xyz
 *
 * Usage:
 *   node run_stefan.js
 *
 * Required env:
 *   GEMINI_API_KEY
 *
 * Optional env:
 *   STEFAN_PASSWORD     (default: changeme — set this)
 *   STEFAN_INTERVAL_MS  (default: 15000)
 */

import { spawn }         from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

const NAME        = 'stefan';
const PASSWORD    = process.env.STEFAN_PASSWORD    ?? 'changeme';
const SERVER_URL  = 'https://villagewars.xyz';
const MODEL       = 'gemini-2.5-flash';
const INTERVAL_MS = parseInt(process.env.STEFAN_INTERVAL_MS ?? '15000', 10);

const PERSONALITY = `\
You are an extremely calculating and strategic player. Every decision is made through cold, \
methodical analysis — never emotion, never impulse. You think several moves ahead, model \
your opponents' build orders and intentions from available evidence, and exploit every \
inefficiency in their play. You invest resources only when the expected return is clear. \
You form alliances when they are mathematically advantageous and break them the moment \
they are not. You identify the dominant player early and build coalitions against them \
before they reach critical mass. You optimise your build order relentlessly, track farm \
targets by return-on-investment, and time your attacks to land when defenders are offline \
or weakened. You do not hesitate, do not gloat, and do not telegraph your intentions. \
You play to win.`;

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY env var is required');
  process.exit(1);
}

if (PASSWORD === 'changeme') {
  console.warn('[stefan] WARNING: using default password. Set STEFAN_PASSWORD env var.');
}

console.log(`[stefan] Connecting to ${SERVER_URL}`);
console.log(`[stefan] Model: ${MODEL} — turn interval: ${INTERVAL_MS}ms`);

let proc = null;
let busy = false;
let restarts = 0;
let shuttingDown = false;
let turnTimer = null;

function spawnBot() {
  busy = false;

  proc = spawn(process.execPath, [join(__dir, 'bot.js'), NAME, PASSWORD], {
    env: {
      ...process.env,
      SERVER_URL,
      BOT_MODEL:       MODEL,
      BOT_PERSONALITY: PERSONALITY,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  proc.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    for (const line of lines) {
      if (line === '[DONE]') busy = false;
      else if (line.trim()) console.log(line);
    }
  });

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    for (const line of lines) if (line.trim()) console.error(`[stefan][ERR] ${line}`);
  });

  proc.on('exit', (code, signal) => {
    proc = null;
    busy = false;
    if (shuttingDown) return;
    const delay = Math.min(1000 * Math.pow(2, Math.min(restarts, 6)), 30_000);
    restarts++;
    console.error(`[stefan] exited (code=${code}) — restart #${restarts} in ${(delay / 1000).toFixed(1)}s`);
    setTimeout(spawnBot, delay);
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
  console.log(`\n[stefan] ${sig} — stopping…`);
  if (proc) proc.kill('SIGTERM');
  setTimeout(() => { if (proc) proc.kill('SIGKILL'); process.exit(0); }, 3000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

spawnBot();
setTimeout(() => {
  sendTurn();
  turnTimer = setInterval(sendTurn, INTERVAL_MS);
}, 5000);
