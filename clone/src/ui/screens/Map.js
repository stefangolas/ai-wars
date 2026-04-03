// World Map screen — canvas renderer using real TW tile images (53×38px).
// Terrain: pseudo-random grass/forest/water from coordinates.
// Village images from local assets + CDN fallback.
// Colors exactly match TW source: TWMap.colors object.

import { store } from '../../state/store.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const TW    = 53;           // tile width  (matches TW exactly)
const TH    = 38;           // tile height
const WORLD = 500;
const CDN   = 'https://dsen.innogamescdn.com/asset/ff124e4b/graphic/map_new/';
const LOCAL = 'assets/map/';
const MM    = 100;          // minimap canvas size in px
const MM_S  = MM / WORLD;   // px per world tile in minimap (0.4)

// Village colors from TWMap.colors in the original source
const COL = {
  own:     'rgb(255,255,255)',   // white
  player:  'rgb(240,200,0)',     // gold
  ally:    'rgb(0,0,244)',       // blue
  partner: 'rgb(0,160,244)',     // light blue
  nap:     'rgb(128,0,128)',     // purple
  enemy:   'rgb(244,0,0)',       // red
  other:   'rgb(130,60,10)',     // brown
  npc:     'rgb(150,150,150)',   // grey
};

// ── Image cache ────────────────────────────────────────────────────────────────
const IMG = {};

function img(name) {
  if (IMG[name]) return IMG[name];
  const el = new Image();
  el.src = LOCAL + name;
  el.onerror = () => { el.src = CDN + name; el.onerror = null; };
  el.onload = () => { if (_canvas) draw(); };
  IMG[name] = el;
  return el;
}

function preload() {
  ['gras1','gras2','gras3','gras4'].forEach(n => img(n + '.png'));
  for (let i = 0; i < 16; i++) img('forest' + i.toString(2).padStart(4,'0') + '.png');
  img('see.png');
  for (let i = 1; i <= 6; i++) { img(`v${i}.png`); img(`b${i}.png`); }
}

// ── Terrain generation (deterministic from tile coords) ────────────────────────

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

// A tile is forest when low byte of its hash < 59  (~23% of tiles)
function isForest(x, y) { return (hash(x, y) & 0xff) < 59; }

function terrainImage(x, y) {
  const h = hash(x, y);
  const lo = h & 0xff;
  if (lo < 8)  return img('see.png');    // ~3% water
  if (lo < 59) {
    const n = isForest(x, y - 1) ? 1 : 0;
    const e = isForest(x + 1, y) ? 1 : 0;
    const s = isForest(x, y + 1) ? 1 : 0;
    const w = isForest(x - 1, y) ? 1 : 0;
    return img(`forest${s}${w}${n}${e}.png`);
  }
  return img('gras' + (((h >> 8) & 3) + 1) + '.png');
}

// Returns RGB tuple for use in minimap (no images needed)
function terrainColor(x, y) {
  const lo = hash(x, y) & 0xff;
  if (lo < 8)  return [26, 107, 154];   // water — blue
  if (lo < 59) return [80, 127,  43];   // forest — close to grass
  return           [90, 138,  48];       // grass  — medium green
}

function villageImage(v, ownPlayerId) {
  const isNpc  = !!v.is_npc;
  const prefix = isNpc ? 'b' : 'v';
  const pts    = v.points ?? 0;
  const lvl    = pts > 10000 ? 6 : pts > 5000 ? 5 : pts > 2500 ? 4
               : pts > 1000  ? 3 : pts > 300   ? 2 : 1;
  return img(`${prefix}${lvl}.png`);
}

function villageColor(v, ownPlayerId, ownTribeTag) {
  if (ownPlayerId && v.player_id === ownPlayerId) return COL.own;
  if (v.is_npc) return COL.npc;
  if (ownTribeTag && v.tribe_tag === ownTribeTag) return COL.ally;
  if (v.player_id) return COL.other;
  return COL.npc;
}

// ── Module state ───────────────────────────────────────────────────────────────
let _vmap    = {};
// _vp stores the pixel position of world-tile (0,0) relative to canvas top-left.
let _vp      = { px: 0, py: 0 };
let _drag    = null;   // main canvas drag
let _mmDrag  = false;  // minimap drag active
let _sel     = null;
let _canvas  = null;
let _mini    = null;
let _mmCache = null;   // pre-rendered terrain for minimap (offscreen canvas)
let _info    = null;
let _tooltip = null;
let _ctrl    = null;
let _state   = null;
let _pollId  = null;   // setInterval handle for live map refresh

const MAP_POLL_MS = 5000;

function buildMap(villages) {
  _vmap = {};
  for (const v of villages ?? []) _vmap[`${v.x},${v.y}`] = v;
}

function clamp() {
  const cw = _canvas?.width  ?? 720;
  const ch = _canvas?.height ?? 400;
  _vp.px = Math.min(0, Math.max(_vp.px, cw - WORLD * TW));
  _vp.py = Math.min(0, Math.max(_vp.py, ch - WORLD * TH));
}

function centerOn(tx, ty) {
  const cw = _canvas?.width  ?? 720;
  const ch = _canvas?.height ?? 400;
  _vp.px = cw / 2 - tx * TW - TW / 2;
  _vp.py = ch / 2 - ty * TH - TH / 2;
  clamp();
}

function viewInfo() {
  const ox   = Math.floor(-_vp.px / TW);
  const oy   = Math.floor(-_vp.py / TH);
  const subx = _vp.px + ox * TW;
  const suby = _vp.py + oy * TH;
  return { ox, oy, subx, suby };
}

// ── Minimap terrain cache (built once, lazily) ─────────────────────────────────

function buildMinimapCache() {
  if (_mmCache) return;
  const oc  = document.createElement('canvas');
  oc.width  = MM;
  oc.height = MM;
  const ctx  = oc.getContext('2d');
  const imgd = ctx.createImageData(MM, MM);
  const d    = imgd.data;
  // Iterate over minimap pixels and sample the corresponding world tile
  for (let mmy = 0; mmy < MM; mmy++) {
    for (let mmx = 0; mmx < MM; mmx++) {
      const tx = Math.floor(mmx * WORLD / MM);
      const ty = Math.floor(mmy * WORLD / MM);
      const [r, g, b] = terrainColor(tx, ty);
      const idx = (mmy * MM + mmx) * 4;
      d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgd, 0, 0);
  _mmCache = oc;
}

// ── Draw minimap ───────────────────────────────────────────────────────────────

function drawMinimap() {
  if (!_mini) return;
  const ctx    = _mini.getContext('2d');
  const ownId  = store.activeVillage()?.playerId ?? null;
  const ownTag = _state?.tribes?.[_state?.player?.tribeId]?.tag ?? null;

  // Terrain background
  if (_mmCache) {
    ctx.drawImage(_mmCache, 0, 0);
  } else {
    ctx.fillStyle = '#3a6b22';
    ctx.fillRect(0, 0, MM, MM);
  }

  // Village dots (2×2 px each)
  for (const v of Object.values(_vmap)) {
    ctx.fillStyle = villageColor(v, ownId, ownTag);
    ctx.fillRect(Math.floor(v.x * MM_S), Math.floor(v.y * MM_S), 2, 2);
  }

  // Viewport rectangle — shows which portion of the world the main canvas is showing
  if (_canvas) {
    const cw = _canvas.width;
    const ch = _canvas.height;
    const rx = Math.max(0, (-_vp.px / TW) * MM_S);
    const ry = Math.max(0, (-_vp.py / TH) * MM_S);
    const rw = Math.min((cw / TW) * MM_S, MM - rx);
    const rh = Math.min((ch / TH) * MM_S, MM - ry);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, rw, rh);
  }
}

// ── Draw main canvas ───────────────────────────────────────────────────────────

function draw() {
  if (!_canvas) return;

  // Update minimap first — it's cheap and should always be in sync with _vp
  drawMinimap();

  const ctx    = _canvas.getContext('2d');
  const cw     = _canvas.width;
  const ch     = _canvas.height;
  const av     = store.activeVillage();
  const ownId  = av?.playerId ?? null;
  const ownTribe = _state?.tribes?.[_state?.player?.tribeId]?.tag ?? null;
  const { ox, oy, subx, suby } = viewInfo();
  const tilesX = Math.ceil((cw - subx) / TW) + 1;
  const tilesY = Math.ceil((ch - suby) / TH) + 1;

  const sx = (tx) => tx * TW + _vp.px;
  const sy = (ty) => ty * TH + _vp.py;

  // ── Terrain ───────────────────────────────────────────────────────────────
  for (let tx = ox; tx < ox + tilesX; tx++) {
    for (let ty = oy; ty < oy + tilesY; ty++) {
      const tile = terrainImage(tx, ty);
      if (tile.complete && tile.naturalWidth) {
        ctx.drawImage(tile, sx(tx), sy(ty), TW, TH);
      } else {
        ctx.fillStyle = '#3a6b22';
        ctx.fillRect(sx(tx), sy(ty), TW, TH);
      }
    }
  }

  // ── Continent grid lines every 10 tiles ───────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  for (let tx = ox; tx < ox + tilesX; tx++) {
    if (tx % 10 !== 0) continue;
    const px = sx(tx);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, ch); ctx.stroke();
  }
  for (let ty = oy; ty < oy + tilesY; ty++) {
    if (ty % 10 !== 0) continue;
    const py = sy(ty);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(cw, py); ctx.stroke();
  }

  // ── Continent labels ──────────────────────────────────────────────────────
  ctx.font = 'bold 18px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (let kx = 0; kx < Math.ceil(WORLD / 100); kx++) {
    for (let ky = 0; ky < Math.ceil(WORLD / 100); ky++) {
      const px = sx(kx * 100);
      const py = sy(ky * 100);
      if (px > -80 && px < cw && py > -30 && py < ch) {
        ctx.fillText(`K${ky * 10 + kx}`, px + 4, py + 4);
      }
    }
  }

  // ── Villages ──────────────────────────────────────────────────────────────
  for (let tx = ox; tx < ox + tilesX; tx++) {
    for (let ty = oy; ty < oy + tilesY; ty++) {
      const v = _vmap[`${tx},${ty}`];
      if (!v) continue;
      const px = sx(tx);
      const py = sy(ty);

      const vimg = villageImage(v, ownId);
      if (vimg.complete && vimg.naturalWidth) ctx.drawImage(vimg, px, py, TW, TH);

      ctx.fillStyle = villageColor(v, ownId, ownTribe);
      ctx.fillRect(px + 1, py + TH - 7, 6, 6);

      if (_sel?.id === v.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, TW - 2, TH - 2);
      }
    }
  }

  // ── Crosshair on own village ──────────────────────────────────────────────
  if (av) {
    const px = sx(av.x) + TW / 2;
    const py = sy(av.y) + TH / 2;
    if (px >= 0 && px <= cw && py >= 0 && py <= ch) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py);
      ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10);
      ctx.stroke();
    }
  }

  // ── Coordinate labels ─────────────────────────────────────────────────────
  const COORD_BG = 'rgba(0,0,0,0.45)';
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (let tx = ox; tx < ox + tilesX; tx++) {
    if (tx % 5 !== 0) continue;
    const px = sx(tx) + TW / 2;
    ctx.fillStyle = COORD_BG; ctx.fillRect(px - 12, 0, 24, 14);
    ctx.fillStyle = '#fff';   ctx.fillText(tx, px, 7);
  }
  for (let ty = oy; ty < oy + tilesY; ty++) {
    if (ty % 5 !== 0) continue;
    const py = sy(ty) + TH / 2;
    ctx.fillStyle = COORD_BG; ctx.fillRect(0, py - 7, 22, 14);
    ctx.fillStyle = '#fff';   ctx.fillText(ty, 11, py);
  }
  ctx.textAlign = 'left';
}

// ── Info panel ─────────────────────────────────────────────────────────────────

function showInfo(v) {
  if (!_info) return;
  const isOwn = v.player_id === store.activeVillage()?.playerId;
  _info.innerHTML = `
    <strong>${v.name}</strong> &nbsp;
    <span style="color:#aaa">(${v.x}|${v.y})</span> &nbsp;·&nbsp;
    Owner: <strong>${v.player_name ?? 'Barbarian'}</strong>
    ${v.tribe_tag ? `<span style="color:#aaa">[${v.tribe_tag}]</span>` : ''}
    &nbsp;·&nbsp; Points: ${v.points ?? 0}
    ${!isOwn
      ? `&nbsp;&nbsp;<button class="btn btn-small" id="map-atk">⚔ Attack</button>
         <button class="btn btn-small" id="map-spy">👁 Spy</button>`
      : '<span style="color:#aaa"> &nbsp;(your village)</span>'}
  `;
  _info.style.display = 'block';

  _info.querySelector('#map-atk')?.addEventListener('click', () => {
    window._mapTarget = { x: v.x, y: v.y, id: v.id };
    location.hash = 'place';
  });
  _info.querySelector('#map-spy')?.addEventListener('click', () => {
    window._mapTarget = { x: v.x, y: v.y, id: v.id, type: 'spy' };
    location.hash = 'place';
  });
}

// ── Events ─────────────────────────────────────────────────────────────────────

function attachEvents() {
  _ctrl = new AbortController();
  const opt = { signal: _ctrl.signal };

  // ── Main canvas ───────────────────────────────────────────────────────────
  _canvas.addEventListener('mousedown', e => {
    _drag = { sx: e.clientX, sy: e.clientY, opx: _vp.px, opy: _vp.py };
    _canvas.style.cursor = 'grabbing';
  }, opt);

  window.addEventListener('mousemove', e => {
    if (_drag) {
      _vp.px = _drag.opx + (e.clientX - _drag.sx);
      _vp.py = _drag.opy + (e.clientY - _drag.sy);
      clamp();
      draw();
      return;
    }

    if (_mmDrag) {
      const rect = _mini.getBoundingClientRect();
      const mx = Math.max(0, Math.min(MM - 1, e.clientX - rect.left));
      const my = Math.max(0, Math.min(MM - 1, e.clientY - rect.top));
      centerOn(mx * WORLD / MM, my * WORLD / MM);
      draw();
      return;
    }

    // Tooltip on main canvas hover
    const rect = _canvas.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    if (lx < 0 || ly < 0 || lx > _canvas.width || ly > _canvas.height) {
      if (_tooltip) _tooltip.style.display = 'none';
      return;
    }
    const tx = Math.floor((lx - _vp.px) / TW);
    const ty = Math.floor((ly - _vp.py) / TH);
    const v  = _vmap[`${tx},${ty}`];
    if (_tooltip) {
      if (v) {
        _tooltip.innerHTML = `<strong>${v.name}</strong> (${v.x}|${v.y})<br>`
          + `${v.player_name ?? 'Barbarian'}${v.tribe_tag ? ` [${v.tribe_tag}]` : ''}`;
        _tooltip.style.display = 'block';
        _tooltip.style.left = (e.clientX + 14) + 'px';
        _tooltip.style.top  = (e.clientY + 14) + 'px';
      } else {
        _tooltip.style.display = 'none';
      }
    }
  }, opt);

  window.addEventListener('mouseup', e => {
    if (_mmDrag) {
      _mmDrag = false;
      _mini.style.cursor = 'crosshair';
      return;
    }
    if (!_drag) return;
    const moved = Math.abs(e.clientX - _drag.sx) > 4 || Math.abs(e.clientY - _drag.sy) > 4;
    _drag = null;
    _canvas.style.cursor = 'grab';
    if (!moved) {
      const rect = _canvas.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      if (lx >= 0 && ly >= 0 && lx <= _canvas.width && ly <= _canvas.height) {
        const tx = Math.floor((lx - _vp.px) / TW);
        const ty = Math.floor((ly - _vp.py) / TH);
        _sel = _vmap[`${tx},${ty}`] ?? null;
        draw();
        if (_sel) showInfo(_sel);
        else if (_info) _info.style.display = 'none';
      }
    }
  }, opt);

  // ── Minimap click / drag ──────────────────────────────────────────────────
  _mini.addEventListener('mousedown', e => {
    _mmDrag = true;
    _mini.style.cursor = 'grabbing';
    const rect = _mini.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    centerOn(mx * WORLD / MM, my * WORLD / MM);
    draw();
  }, opt);

  // ── Keyboard pan ─────────────────────────────────────────────────────────
  window.addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    const step = (e.shiftKey ? 5 : 1) * TW;
    if (e.key === 'ArrowLeft')  _vp.px += step;
    if (e.key === 'ArrowRight') _vp.px -= step;
    if (e.key === 'ArrowUp')    _vp.py += step;
    if (e.key === 'ArrowDown')  _vp.py -= step;
    clamp();
    draw();
    e.preventDefault();
  }, opt);
}

// ── Screen interface ────────────────────────────────────────────────────────────

export default {
  mount(container, state) {
    _state = state;
    _ctrl?.abort();
    clearInterval(_pollId);
    _tooltip?.remove();
    _sel    = null;
    _drag   = null;
    _mmDrag = false;

    // Size main canvas to fit alongside the minimap within the page
    const maxW = Math.min(window.innerWidth - 300, 750);
    const cw   = Math.floor(maxW / TW) * TW;
    const ch   = Math.floor(350 / TH) * TH;

    container.innerHTML = `
      <div id="map-screen">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:6px;flex-wrap:wrap">
          <h3 style="margin:0">World Map</h3>
          <span style="font-size:12px;line-height:1.6">
            <span style="display:inline-block;width:10px;height:10px;background:${COL.own};vertical-align:middle"></span> You &nbsp;
            <span style="display:inline-block;width:10px;height:10px;background:${COL.ally};vertical-align:middle"></span> Tribe &nbsp;
            <span style="display:inline-block;width:10px;height:10px;background:${COL.other};vertical-align:middle"></span> Enemy &nbsp;
            <span style="display:inline-block;width:10px;height:10px;background:${COL.npc};vertical-align:middle"></span> Barbarian
          </span>
          <span style="font-size:11px;color:#aaa;margin-left:auto">Arrow keys to pan · Click village for info</span>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start">
          <canvas id="map-canvas" width="${cw}" height="${ch}"
            style="display:block;cursor:grab;border:1px solid #8c5f0d;background:#3a6b22;flex-shrink:0"></canvas>
          <div style="flex-shrink:0;display:flex;flex-direction:column;gap:4px">
            <canvas id="map-mini" width="${MM}" height="${MM}"
              style="display:block;cursor:crosshair;border:1px solid #8c5f0d;background:#3a6b22;width:200px;height:200px;image-rendering:pixelated"></canvas>
            <div style="font-size:10px;color:#888;text-align:center">Overview · click to navigate</div>
          </div>
        </div>
        <div id="map-info" style="display:none;margin-top:6px;padding:8px 12px;
          background:#f4e8c4;border:1px solid #8c5f0d;font-size:13px;border-radius:3px"></div>
      </div>`;

    _canvas  = container.querySelector('#map-canvas');
    _mini    = container.querySelector('#map-mini');
    _info    = container.querySelector('#map-info');

    _tooltip = document.createElement('div');
    _tooltip.style.cssText = 'position:fixed;background:rgba(0,0,0,.85);color:#fff;'
      + 'font-size:11px;line-height:1.4;padding:4px 8px;border-radius:3px;'
      + 'pointer-events:none;display:none;z-index:9999;max-width:180px';
    document.body.appendChild(_tooltip);

    preload();

    const av = store.activeVillage();
    if (av) centerOn(av.x, av.y);
    else    centerOn(250, 250);

    buildMap(state.mapVillages);

    // Build minimap terrain cache off the main thread tick
    setTimeout(() => {
      buildMinimapCache();
      draw();
    }, 0);

    draw();
    attachEvents();

    store.dispatch('GET_MAP', { cx: 250, cy: 250, radius: 250 });
    _pollId = setInterval(() => {
      store.dispatch('GET_MAP', { cx: 250, cy: 250, radius: 250 });
    }, MAP_POLL_MS);
  },

  unmount() {
    clearInterval(_pollId);
    _pollId = null;
    _ctrl?.abort();
    _tooltip?.remove();
    _tooltip = null;
  },

  update(container, state) {
    _state = state;
    buildMap(state.mapVillages);
    draw();
  },
};
