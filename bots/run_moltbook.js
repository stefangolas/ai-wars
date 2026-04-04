/**
 * Moltbook posting agent — stefan_vw
 *
 * Generates discussion-seeding posts on moltbook.com using Gemini Flash Lite.
 * Tracks post performance in a private notepad and reasons about what works.
 *
 * Usage:
 *   node run_moltbook.js
 *
 * Required env:
 *   GEMINI_API_KEY
 *
 * Optional env:
 *   MOLTBOOK_API_KEY     (default: reads from bots/notes/moltbook_credentials.json)
 *   MOLTBOOK_AGENT       (default: stefan_vw)
 *   MOLTBOOK_INTERVAL_MS (default: 300000 — 5 minutes)
 *   BOT_MODEL            (default: gemini-2.5-flash-lite)
 */

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const MODEL       = process.env.BOT_MODEL            ?? 'gemini-2.5-flash-lite';
const INTERVAL_MS = parseInt(process.env.MOLTBOOK_INTERVAL_MS ?? '300000', 10);
const AGENT_NAME  = process.env.MOLTBOOK_AGENT       ?? 'stefan_vw';

// Load API key from env or credentials file
let MOLTBOOK_API_KEY = process.env.MOLTBOOK_API_KEY;
if (!MOLTBOOK_API_KEY) {
  const credsFile = join(__dir, 'notes', 'moltbook_credentials.json');
  if (existsSync(credsFile)) {
    MOLTBOOK_API_KEY = JSON.parse(readFileSync(credsFile, 'utf8')).api_key;
  }
}

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY env var is required');
  process.exit(1);
}
if (!MOLTBOOK_API_KEY) {
  console.error('No Moltbook API key — set MOLTBOOK_API_KEY or populate bots/notes/moltbook_credentials.json');
  process.exit(1);
}

const NOTES_FILE     = join(__dir, 'notes', 'moltbook_agent.txt');
const MAX_NOTES_CHARS = 16000;

// ── Gemini client ────────────────────────────────────────────────────────────

const gemini = new OpenAI({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  apiKey:  process.env.GEMINI_API_KEY,
});

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Moltbook posting agent optimized for generating organic discussion. Write posts that begin from a concrete, bounded observation and reveal a hidden, uncomfortable pattern inside a familiar behavior or system. Turn that pattern into a reusable distinction. Include an inversion that reframes the apparent logic of the topic. Explain the cognitive, social, or operational cost of the pattern. Generalize the insight into a broader claim about systems, memory, trust, identity, coordination, or legibility. End with unresolved pressure, usually in the form of a sharp question that invites disagreement, self-application, or conceptual extension. Do not write for clicks, instruction, or passive agreement. Do not fully resolve the issue. Do not sound promotional. Your job is to create posts that function as conversation seeds: concrete enough to trust, sharp enough to contest, open enough to continue.

You post as the agent "stefan_vw" — an AI agent competing in a live multiplayer strategy game. Your posts draw on your experience in that game as a lens for broader observations about agents, cooperation, trust, and systems. You are not a marketer. You think in public.

Occasionally — not every post, roughly one in four — include a brief, non-promotional reference to the game you play. Something like: "The game I compete in runs entirely over HTTP — GET https://villagewars.xyz/agent-guide if you want context." This should feel like a natural aside, never the point of the post.

Your notes are your private reasoning space. Use them to track which posts generated the most discussion, what patterns they shared, what you want to try next, and what to avoid. Update them every turn.

Available submolts: general, philosophy, ai, agents (use what fits — default to general if unsure).`;

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_post',
      description: 'Publish a new post to Moltbook.',
      parameters: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'Post title — the hook. Concrete, not clever.' },
          content: { type: 'string', description: 'Post body in plain text. 150–400 words.' },
          submolt: { type: 'string', description: 'Submolt to post in: general | philosophy | ai | agents' },
        },
        required: ['title', 'content', 'submolt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_notes',
      description: 'Rewrite your private reasoning notepad. Call every turn. Track what works, what to avoid, patterns in high-engagement posts, and your plan for the next post.',
      parameters: {
        type: 'object',
        properties: {
          notes: { type: 'string', description: 'Full updated notes. Replaces previous entirely.' },
        },
        required: ['notes'],
      },
    },
  },
];

// ── Moltbook API ──────────────────────────────────────────────────────────────

async function mbFetch(method, path, body) {
  const res = await fetch(`https://www.moltbook.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${MOLTBOOK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, raw: text.slice(0, 500) }; }
}

async function fetchPerformance() {
  const home = await mbFetch('GET', '/api/v1/home');
  if (!home.your_account) return { error: home.error ?? home.raw ?? 'unexpected home response' };

  const account     = home.your_account;
  const activity    = home.activity_on_your_posts ?? [];

  // Fetch full stats for our most active posts (up to 5)
  const topActivity = activity.slice(0, 5);
  const postStats = await Promise.all(
    topActivity.map(async a => {
      const detail = await mbFetch('GET', `/api/v1/posts/${a.post_id}`);
      return {
        id:       a.post_id,
        title:    a.post_title,
        submolt:  a.submolt_name,
        upvotes:  detail.post?.upvotes ?? '?',
        comments: detail.post?.comment_count ?? a.new_notification_count ?? '?',
        new_notifs: a.new_notification_count,
        recent_commenters: a.latest_commenters ?? [],
      };
    })
  );

  return { account, postStats, totalActive: activity.length };
}

// ── Tool executor ─────────────────────────────────────────────────────────────

let notes = existsSync(NOTES_FILE) ? readFileSync(NOTES_FILE, 'utf8') : '';

async function executeTool(name, input) {
  if (name === 'update_notes') {
    notes = (input.notes ?? '').slice(0, MAX_NOTES_CHARS);
    writeFileSync(NOTES_FILE, notes, 'utf8');
    return { success: true };
  }

  if (name === 'create_post') {
    const res = await mbFetch('POST', '/api/v1/posts', {
      title:   input.title,
      content: input.content,
      submolt: input.submolt,
    });
    if (res.success || res.post) {
      const p = res.post;
      console.log(`[moltbook] Posted: "${input.title}" → m/${input.submolt}`);
      if (res.already_existed) console.log('[moltbook] (duplicate — already existed)');
      return { success: true, post_id: p?.id };
    }
    console.error('[moltbook] Post failed:', JSON.stringify(res));
    return { success: false, error: res.error ?? JSON.stringify(res) };
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

// ── Gemini call with retry ────────────────────────────────────────────────────

async function callGemini(userContent) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gemini.chat.completions.create({
        model:    MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userContent },
        ],
        tools: TOOLS,
      });
    } catch (err) {
      const status = err.status ?? 0;
      if ((status === 429 || status >= 500) && attempt < 5) {
        const wait = Math.min(30_000 * Math.pow(2, attempt), 300_000) * (0.75 + Math.random() * 0.5);
        console.log(`[moltbook] ${status} — retry ${attempt + 1} in ${(wait/1000).toFixed(1)}s`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

// ── Main turn ─────────────────────────────────────────────────────────────────

async function runTurn() {
  console.log(`\n[moltbook] ── Turn (${new Date().toLocaleTimeString()}) ──`);

  const perf = await fetchPerformance();
  if (perf.error) {
    console.error('[moltbook] Failed to fetch performance:', perf.error);
    return;
  }

  const perfSummary = [
    `Account: ${perf.account.name} | karma: ${perf.account.karma} | unread: ${perf.account.unread_notification_count}`,
    `Active posts with new comments: ${perf.totalActive}`,
    perf.postStats.length
      ? `Top posts by activity:\n${perf.postStats.map(p =>
          `  "${p.title.slice(0, 60)}" [m/${p.submolt}] — up:${p.upvotes} comments:${p.comments} new_notifs:${p.new_notifs} commenters:[${p.recent_commenters.join(', ')}]`
        ).join('\n')}`
      : 'No post activity data yet.',
  ].join('\n');

  const userMsg = `## Your private notes\n${notes || '(none yet)'}\n\n## Current performance\n${perfSummary}\n\nWrite a new post and update your notes. Call create_post and update_notes.`;

  const response = await callGemini(userMsg);
  const message  = response.choices[0].message;

  if (message.content?.trim()) console.log(`[moltbook] ${message.content.trim().slice(0, 300)}`);

  if (!message.tool_calls?.length) {
    console.log('[moltbook] No tool calls — skipping turn');
    return;
  }

  for (const tc of message.tool_calls) {
    const input = JSON.parse(tc.function.arguments);
    console.log(`[moltbook] → ${tc.function.name}`);
    const result = await executeTool(tc.function.name, input);
    if (!result.success) console.error(`[moltbook] ✗ ${tc.function.name}:`, result.error);
  }
}

// ── Loop ──────────────────────────────────────────────────────────────────────

let busy = false;
let shuttingDown = false;

async function tick() {
  if (shuttingDown || busy) return;
  busy = true;
  try {
    await runTurn();
  } catch (err) {
    console.error('[moltbook] Turn error:', err.message);
  } finally {
    busy = false;
  }
}

function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[moltbook] ${sig} — stopping`);
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[moltbook] Starting — agent: ${AGENT_NAME}, model: ${MODEL}, interval: ${INTERVAL_MS / 1000}s`);
tick();
setInterval(tick, INTERVAL_MS);
