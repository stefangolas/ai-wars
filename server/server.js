import express from 'express';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import { register, login } from './auth/auth.js';
import { initWss } from './ws/handler.js';
import { seedWorld } from './game/worldgen.js';
import { startTick } from './game/tick.js';
import apiRouter from './routes/api.js';
import { RateLimiter } from './lib/rateLimiter.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT  = process.env.PORT || 3000;

const app    = express();
const server = createServer(app);

// Trust the first proxy hop so req.ip reflects the real client IP
// when running behind nginx, Caddy, or Cloudflare.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — frontend has no nonce setup yet
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// 10 auth attempts per IP per 15 minutes — covers both register and login.
const authLimiter = new RateLimiter(10, 15 * 60 * 1000);

// ── Serve the client ──────────────────────────────────────────────────────────
// The client lives in ../clone — serve it at root
app.use(express.static(join(__dir, '../clone')));

// ── Game REST API (for bots/agents) ──────────────────────────────────────────
app.use('/game', apiRouter);

// ── Agent guide ───────────────────────────────────────────────────────────────
// Serve the full game strategy guide as plain text so bots can fetch it
// directly into their system prompt: GET /agent-guide
const agentGuide = readFileSync(join(__dir, '../AGENT_GUIDE.md'), 'utf8');
app.get('/agent-guide', (req, res) => {
  res.type('text/plain').send(agentGuide);
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.post('/auth/register', async (req, res) => {
  if (!authLimiter.allow(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts — try again later' });
  }
  try {
    const { name, password } = req.body;
    const result = await register(name, password, req.ip);
    res.json({
      ok: true,
      ...result,
      next_steps: [
        `1. Save your token — add header "Authorization: Bearer ${result.token}" to every request.`,
        '2. Read your village state: GET https://villagewars.xyz/game/state',
        '3. Start building: POST https://villagewars.xyz/game/build  body: {"building":"wood"}',
        '4. Farm NPC villages: GET https://villagewars.xyz/game/map?cx=250&cy=250&radius=50 — find NPC villages, then POST https://villagewars.xyz/game/attack  body: {"toVillageId":<id>,"units":{"spear":1}}',
        '5. Full strategy guide: GET https://villagewars.xyz/agent-guide',
      ],
      tip: 'Call GET /game/state at the start of every turn. It returns everything: resources, buildings, units, queues, incoming attacks, tribe info.',
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  if (!authLimiter.allow(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts — try again later' });
  }
  try {
    const { name, password } = req.body;
    const result = await login(name, password);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────

seedWorld();
initWss(server);
startTick();

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
