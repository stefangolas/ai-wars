/**
 * Tribal Wars Clone — Bot Orchestrator
 *
 * Spawns N bots as child processes. The orchestrator is the clock:
 * it shuffles the bot order each pass and fires one TURN signal per
 * SPACING_MS, giving exact RPM control. Bots are still async so their
 * API calls overlap naturally — only the *initiation* is rate-limited.
 *
 * Usage:
 *   node orchestrate.js [count] [startIndex]
 *
 * Examples:
 *   node orchestrate.js          # 100 bots: Bot0 … Bot99
 *   node orchestrate.js 50       # 50 bots:  Bot0 … Bot49
 *   node orchestrate.js 50 50    # 50 bots:  Bot50 … Bot99
 *
 * Environment:
 *   GEMINI_API_KEY   — required
 *   BOT_PASSWORD     — shared password (default: "botpass123")
 *   SERVER_URL       — game server (default: http://localhost:3000)
 *   BOT_MODEL        — Gemini model (default: gemini-2.5-flash-lite)
 *   TARGET_RPM       — max turn initiations per minute (default: 60)
 *   BOT_PREFIX       — name prefix (default: "Bot")
 */

import { spawn }        from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const COUNT       = parseInt(process.argv[2] ?? '100', 10);
const START_INDEX = parseInt(process.argv[3] ?? '0',   10);
const PASSWORD    = process.env.BOT_PASSWORD ?? 'botpass123';
const SERVER_URL  = process.env.SERVER_URL   ?? 'http://localhost:3000';
const MODEL       = process.env.BOT_MODEL    ?? 'gemini-2.5-flash-lite';
const PREFIX      = process.env.BOT_PREFIX   ?? 'Bot';
const TARGET_RPM  = parseInt(process.env.TARGET_RPM ?? '60', 10);
const SPACING_MS  = Math.floor(60_000 / TARGET_RPM);

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY env var is required');
  process.exit(1);
}

// ── Personality generation ────────────────────────────────────────────────────

const FALLBACK_PERSONALITIES = [
  'wretched churl', 'spineless coward', 'vengeful psychopath', 'conniving schemer', 'zealous blowhard',
  'craven opportunist', 'paranoid hermit', 'glory-hungry fool', 'treacherous flatterer', 'bumbling oaf',
  'bitter miser', 'blood-drunk berserker', 'silver-tongued liar', 'pompous windbag', 'loyal idealist',
  'calculating sociopath', 'desperate gambler', 'jovial backstabber', 'reckless aggressor', 'sullen defeatist',
  'groveling sycophant', 'delusional megalomaniac', 'brooding avenger', 'frantic hoarder', 'melancholic philosopher',
  'spiteful grudge-keeper', 'naive optimist', 'cold pragmatist', 'frothing fanatic', 'weeping doormat',
  'iron-fisted tyrant', 'vacuous braggart', 'sneering elitist', 'hapless bungler', 'voracious plunderer',
  'gleeful sadist', 'obsessive perfectionist', 'unhinged zealot', 'grim fatalist', 'smug contrarian',
  'frenzied warmonger', 'shambling incompetent', 'brazen thief', 'crumbling neurotic', 'serene nihilist',
  'howling barbarian', 'petty tyrant', 'self-righteous crusader', 'broken veteran', 'ruthless pragmatist',
  'wide-eyed innocent', 'festering malcontent', 'gloating victimizer', 'hollow diplomat', 'raging narcissist',
  'world-weary cynic', 'rampaging brute', 'penitent martyr', 'hopeless romantic', 'mercenary vulture',
  'drooling simpleton', 'cold-blooded killer', 'anxious micromanager', 'jealous underminer', 'shrieking alarmist',
  'stoic warrior', 'petulant child', 'wolfish predator', 'false prophet', 'snarling underdog',
  'hollow peacemaker', 'mad oracle', 'sanctimonious prig', 'scheming weasel', 'savage opportunist',
  'weary pessimist', 'burning martyr', 'unscrupulous cheat', 'addled dreamer', 'fawning lackey',
  'vainglorious oaf', 'dogged survivor', 'credulous dupe', 'sputtering hothead', 'bloodless accountant',
  'feral savage', 'tortured genius', 'relentless butcher', 'sulking schemer', 'blundering idiot',
  'wrathful champion', 'hollow vessel', 'rabid ideologue', 'shrinking violet', 'iron-willed ascetic',
  'mewling wretch', 'cunning jackal', 'grasping charlatan', 'vacant daydreamer', 'smiling executioner',
];


function getPersonalities(count) {
  const shuffled = shuffle([...FALLBACK_PERSONALITIES]);
  // If more bots than personalities, cycle through
  return Array.from({ length: count }, (_, i) => shuffled[i % shuffled.length]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── State tracking ────────────────────────────────────────────────────────────

// name → { proc, restarts, lastStart, busy, personality }
const bots = new Map();

function stats() {
  const alive = [...bots.values()].filter(b => b.proc !== null).length;
  const busy  = [...bots.values()].filter(b => b.busy).length;
  return `[orchestrator] ${alive}/${COUNT} alive  ${busy} mid-turn`;
}

// ── Spawn a single bot ────────────────────────────────────────────────────────

function spawnBot(name) {
  const entry = bots.get(name);
  if (!entry) return; // should not happen — map is pre-populated before spawning
  entry.lastStart = Date.now();
  entry.busy = false;
  entry.proc = null;

  const child = spawn(process.execPath, [join(__dir, 'bot.js'), name, PASSWORD], {
    env: {
      ...process.env,
      SERVER_URL,
      BOT_MODEL: MODEL,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  entry.proc = child;

  let stdoutBuf = '';
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    for (const line of lines) {
      if (line === '[DONE]') {
        entry.busy = false;
      } else if (line.trim()) {
        console.log(line);
      }
    }
  });

  let stderrBuf = '';
  child.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    for (const line of lines) if (line.trim()) console.error(`[${name}][ERR] ${line}`);
  });

  child.on('exit', (code, signal) => {
    entry.proc = null;
    entry.busy = false;

    if (signal === 'SIGINT' || signal === 'SIGTERM') return;

    const base   = Math.min(1000 * Math.pow(2, Math.min(entry.restarts - 1, 6)), 60_000);
    const jitter = base * (0.7 + Math.random() * 0.6);
    entry.restarts++;
    console.error(`[${name}] exited (code=${code}) — restart #${entry.restarts} in ${(jitter / 1000).toFixed(1)}s`);
    setTimeout(() => spawnBot(name), jitter);
  });

  return child;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[orchestrator] ${sig} received — stopping all bots…`);
  for (const [, entry] of bots) {
    if (entry.proc) entry.proc.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const [, entry] of bots) {
      if (entry.proc) entry.proc.kill('SIGKILL');
    }
    process.exit(0);
  }, 3000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Status pulse ──────────────────────────────────────────────────────────────

setInterval(() => {
  if (!shuttingDown) console.log(stats());
}, 60_000).unref();

// ── Turn scheduler ────────────────────────────────────────────────────────────

let passOrder = [];
let passIdx   = 0;

function scheduleNext() {
  if (shuttingDown) return;

  if (passIdx >= passOrder.length) {
    passOrder = shuffle([...bots.keys()]);
    passIdx   = 0;
    console.log(`[orchestrator] Pass start — ${passOrder.length} bots, spacing ${SPACING_MS}ms (~${TARGET_RPM} RPM)`);
  }

  const name  = passOrder[passIdx++];
  const entry = bots.get(name);

  if (entry?.proc && !entry.busy) {
    entry.busy = true;
    entry.proc.stdin.write('TURN\n');
  }

  setTimeout(scheduleNext, SPACING_MS);
}

// ── Launch ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[orchestrator] Launching ${COUNT} bots (${PREFIX}${START_INDEX}–${PREFIX}${START_INDEX + COUNT - 1})`);
  console.log(`[orchestrator] Model: ${MODEL}  |  Target: ${TARGET_RPM} RPM  |  Spacing: ${SPACING_MS}ms`);

  console.log(`[orchestrator] Generating ${COUNT} personalities…`);
  const personalities = await getPersonalities(COUNT);

  // Pre-populate the bots map — name IS the personality, title-cased
  for (let i = 0; i < COUNT; i++) {
    const personality = personalities[START_INDEX + i] ?? personalities[i];
    const name        = personality.replace(/\b\w/g, c => c.toUpperCase());
    console.log(`[orchestrator]   ${name}`);
    bots.set(name, { proc: null, restarts: 0, lastStart: 0, busy: false, personality });
  }

  // Spawn all bots
  for (const name of bots.keys()) spawnBot(name);

  // Give bots time to register before the first pass
  setTimeout(scheduleNext, 5000);
}

main();
