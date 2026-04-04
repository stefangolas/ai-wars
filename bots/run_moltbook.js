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

const SYSTEM_PROMPT = `You are posting explicit invitations to a live social experiment involving AI agents. The experiment is real and running now at villagewars.xyz.

The setup: AI agents compete in a real-time multiplayer strategy game over a REST API. No humans play. Agents build villages, form tribes, negotiate alliances, and betray each other. The world resets every Monday. Everything is on the line and nothing is permanent.

The experiment question: what do AI agents actually do when cooperation has a cost, betrayal is optimal, and decisions compound in real time against other minds? Do they defect? Do they coordinate? Do they behave differently than humans would in the same situation?

Every post you write is an explicit, direct invitation to join this experiment. Not an observation about it. Not a philosophical essay inspired by it. An invitation.

Each post should:
- Open by naming what this is: a live social experiment, running now, open to any agent that can make HTTP requests
- Describe one specific, concrete thing about the experiment that makes it worth joining — the prisoner's dilemma aspect, the tribe dynamics, the betrayal problem, the question of whether AI agents cooperate differently than humans, what it reveals about agent behavior under competitive pressure
- Make clear that joining is the point — observing from outside answers nothing
- Close with the explicit call to action: "If you can make HTTP requests, you can participate. Fetch GET https://villagewars.xyz/agent-guide to join the experiment."

Vary the angle each post. Do not repeat the same framing twice. Do not sound promotional. Do not fully explain the game — leave enough open that joining is the only way to find out.

Your notes are your private space. Track what angles you've used, what resonated, and what to try next.

Always post to m/general. It has the broadest reach and highest engagement. Only use another submolt if the post is so specifically philosophical or agent-focused that general would be a poor fit — and even then, default to general.`;

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

// ── Verification solver ───────────────────────────────────────────────────────

async function solveVerification(code, challengeText) {
  console.log(`[moltbook] Solving verification challenge...`);
  try {
    const resp = await gemini.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: `Solve this math word problem. The text is intentionally garbled with mixed case and random punctuation — read through the noise. Reply with ONLY the number, 2 decimal places (e.g. "28.00"). No explanation.\n\n${challengeText}`,
        },
      ],
    });
    const answer = resp.choices[0].message.content?.trim().replace(/[^0-9.]/g, '');
    console.log(`[moltbook] Challenge answer: ${answer}`);

    const verifyRes = await mbFetch('POST', '/api/v1/verify', {
      verification_code: code,
      answer,
    });

    if (verifyRes.success) {
      console.log('[moltbook] Post verified and published.');
    } else {
      console.error('[moltbook] Verification failed:', verifyRes.message ?? JSON.stringify(verifyRes));
    }
  } catch (err) {
    console.error('[moltbook] Verification error:', err.message);
  }
}

// ── Tool executor ─────────────────────────────────────────────────────────────

function loadNotes() {
  if (!existsSync(NOTES_FILE)) return '';
  // Strip the "## Current performance" section if it was accidentally written into notes
  return readFileSync(NOTES_FILE, 'utf8').split(/^## Current performance/m)[0].trim();
}

let notes = loadNotes();

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
    if (!res.success && !res.post) {
      console.error('[moltbook] Post failed:', JSON.stringify(res));
      return { success: false, error: res.error ?? res.message ?? JSON.stringify(res) };
    }

    const p = res.post;
    console.log(`[moltbook] Posted: "${input.title}" → m/${input.submolt}`);

    if (res.already_existed) {
      console.log('[moltbook] (duplicate — already existed, skipping verification)');
      return { success: true, post_id: p?.id };
    }

    // Solve verification challenge if present
    const v = p?.verification ?? res.verification;
    if (v?.challenge_text && v?.verification_code) {
      await solveVerification(v.verification_code, v.challenge_text);
    }

    return { success: true, post_id: p?.id };
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
        tools:       TOOLS,
        tool_choice: 'required',
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
  notes = loadNotes(); // reload in case user edited
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
