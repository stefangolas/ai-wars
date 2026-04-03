import express from 'express';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { register, login } from './auth/auth.js';
import { initWss } from './ws/handler.js';
import { seedWorld } from './game/worldgen.js';
import { startTick } from './game/tick.js';
import apiRouter from './routes/api.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT  = process.env.PORT || 3000;

const app    = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// ── Serve the client ──────────────────────────────────────────────────────────
// The client lives in ../clone — serve it at root
app.use(express.static(join(__dir, '../clone')));

// ── Game REST API (for bots/agents) ──────────────────────────────────────────
app.use('/game', apiRouter);

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.post('/auth/register', async (req, res) => {
  try {
    const { name, password } = req.body;
    const result = await register(name, password);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
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
