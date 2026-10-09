// Mappa della regione: biomi con ombreggiatura del rilievo, sentieri, torrente,
// zone esplorate, punti d'interesse e (con GPS) la posizione del giocatore.
import { WORLD_SIZE, HALF, BIOMES, BIOME_COLOR, BIOME_LABEL, CELLS, CELL, RES, STEP } from '../world/worldgen.js';
import { el } from './dom.js';
import { ZONE_BY_ID } from '../data/zones.js';

const baseCache = new WeakMap();

function baseImage(world, px) {
  const key = baseCache.get(world);
  if (key && key.px === px) return key.canvas;
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  const img = g.createImageData(px, px);
  const rgb = BIOMES.map((b) => hexToRgb(BIOME_COLOR[b]));
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const wx = -HALF + ((x + 0.5) / px) * WORLD_SIZE, wz = -HALF + ((y + 0.5) / px) * WORLD_SIZE;
    const b = BIOMES.indexOf(world.biomeAt(wx, wz));
    const h = world.heightAt(wx, wz);
    const hx = world.heightAt(wx + 2, wz) - world.heightAt(wx - 2, wz);
    const hz = world.heightAt(wx, wz + 2) - world.heightAt(wx, wz - 2);
    const shade = 1 + (-hx * 0.6 - hz * 0.6) * 0.18;
    const contour = Math.abs((h / 4) - Math.round(h / 4)) < 0.04 ? 0.82 : 1;
    let [r, gg, bb] = rgb[b];
    const tr = world.trailAt(wx, wz), st = world.streamAt(wx, wz);
    if (st < 2.2) { r = 70; gg = 120; bb = 150; }
    const i = (y * px + x) * 4;
    const k = shade * contour * (0.92 + h / 400);
    img.data[i] = clamp255(r * k * 1.25); img.data[i + 1] = clamp255(gg * k * 1.25); img.data[i + 2] = clamp255(bb * k * 1.25); img.data[i + 3] = 255;
    if (tr < 1.4) { img.data[i] = 214; img.data[i + 1] = 196; img.data[i + 2] = 150; }
  }
  g.putImageData(img, 0, 0);
  baseCache.set(world, { px, canvas: c });
  return c;
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

export function drawMap(canvas, world, opts) {
  const px = canvas.width;
  const g = canvas.getContext('2d');
  g.drawImage(baseImage(world, 400), 0, 0, px, px);
  const toPx = (x) => ((x + HALF) / WORLD_SIZE) * px;
  // nebbia di guerra: celle non esplorate
  if (opts.explored) {
    g.fillStyle = 'rgba(20,24,20,0.55)';
    const cs = px / CELLS;
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      if (opts.explored[j * CELLS + i] !== '1') g.fillRect(i * cs, j * cs, cs + 0.5, cs + 0.5);
    }
  }
  // zone di raccolta: bordi, zone chiuse tratteggiate, nomi
  if (opts.zones && world.cells[0].zone) {
    const cs = px / CELLS;
    const zoneOf = (i, j) => (i < 0 || j < 0 || i >= CELLS || j >= CELLS ? null : world.cells[j * CELLS + i].zone);
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      const z = zoneOf(i, j);
      const def = ZONE_BY_ID[z];
      if (!opts.zones.unlocked.has(z)) {
        g.fillStyle = 'rgba(10,10,12,0.5)'; g.fillRect(i * cs, j * cs, cs + 0.5, cs + 0.5);
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(i * cs, (j + 1) * cs); g.lineTo((i + 1) * cs, j * cs); g.stroke();
      }
      g.strokeStyle = def.color; g.lineWidth = 2.5;
      if (zoneOf(i + 1, j) !== z && zoneOf(i + 1, j)) { g.beginPath(); g.moveTo((i + 1) * cs, j * cs); g.lineTo((i + 1) * cs, (j + 1) * cs); g.stroke(); }
      if (zoneOf(i, j + 1) !== z && zoneOf(i, j + 1)) { g.beginPath(); g.moveTo(i * cs, (j + 1) * cs); g.lineTo((i + 1) * cs, (j + 1) * cs); g.stroke(); }
    }
    g.textAlign = 'center';
    for (const [zid, c] of Object.entries(world.zoneCenters)) {
      const def = ZONE_BY_ID[zid];
      const x = ((c.x + HALF) / WORLD_SIZE) * px, y = ((c.z + HALF) / WORLD_SIZE) * px;
      const open = opts.zones.unlocked.has(zid), lic = opts.zones.licensed.has(zid);
      const label = `${open ? '' : '🔒 '}${def.short}`;
      const sub = open ? (lic ? '✓ permesso' : 'senza permesso') : `livello ${def.level}`;
      g.font = 'bold 12px system-ui';
      const w = Math.max(g.measureText(label).width, 70) + 12;
      g.fillStyle = 'rgba(15,16,12,0.72)'; g.beginPath(); g.roundRect(x - w / 2, y - 14, w, 30, 6); g.fill();
      g.fillStyle = def.color; g.fillText(label, x, y);
      g.font = '10px system-ui'; g.fillStyle = open ? (lic ? '#a9d68a' : '#f0b46a') : '#bbb'; g.fillText(sub, x, y + 12);
    }
  }
  // parcheggio
  const p = world.parking;
  g.fillStyle = '#2f5a6e'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.roundRect(toPx(p.x) - 8, toPx(p.z) - 8, 16, 16, 3); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillText('P', toPx(p.x), toPx(p.z) + 4);
  // punti d'interesse
  for (const poi of opts.poi || []) {
    const x = toPx(poi.x), y = toPx(poi.z);
    g.fillStyle = '#f0c040'; g.strokeStyle = '#3a2a10'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y - 12); g.lineTo(x + 5, y - 12); g.closePath(); g.fill(); g.stroke();
    g.font = '10px system-ui'; g.fillStyle = '#fff'; g.textAlign = 'left';
    g.fillText(poi.label, x + 7, y - 6);
  }
  // giocatore
  if (opts.player) {
    const x = toPx(opts.player.x), y = toPx(opts.player.z);
    if (opts.player.exact) {
      g.save(); g.translate(x, y); g.rotate(-opts.player.yaw);
      g.fillStyle = '#ff5533'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -10); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
    } else if (opts.player.radius) {
      const r = (opts.player.radius / WORLD_SIZE) * px;
      g.fillStyle = 'rgba(255,90,50,0.18)'; g.strokeStyle = 'rgba(255,90,50,0.8)'; g.setLineDash([4, 4]);
      g.beginPath(); g.arc(x + opts.player.ox / WORLD_SIZE * px, y + opts.player.oz / WORLD_SIZE * px, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.setLineDash([]);
    }
  }
  // rosa dei venti
  g.save(); g.translate(px - 26, 30);
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(0, 0, 18, 0, 6.28); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillText('N', 0, -5);
  g.beginPath(); g.moveTo(0, -2); g.lineTo(4, 10); g.lineTo(-4, 10); g.closePath(); g.fillStyle = '#e55'; g.fill();
  g.restore();
  // scala
  const m100 = (100 / WORLD_SIZE) * px;
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(10, px - 24, m100 + 12, 16);
  g.fillStyle = '#fff'; g.fillRect(16, px - 14, m100, 3);
  g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText('100 m', 18, px - 17);
}

export function mapLegend() {
  return el('div', { class: 'legend' }, BIOMES.map((b) => el('span', { class: 'leg' }, el('i', { style: { background: BIOME_COLOR[b] } }), BIOME_LABEL[b])),
    el('span', { class: 'leg' }, el('i', { style: { background: '#d6c496' } }), 'Sentiero'),
    el('span', { class: 'leg' }, el('i', { style: { background: '#46788f' } }), 'Torrente'),
    el('span', { class: 'leg' }, el('i', { style: { background: '#f0c040' } }), 'Punto salvato'));
}

export function markExplored(state, regionId, cellIdx) {
  let s = state.explored[regionId];
  if (!s || s.length !== CELLS * CELLS) s = '0'.repeat(CELLS * CELLS);
  if (s[cellIdx] === '1') return false;
  state.explored[regionId] = s.slice(0, cellIdx) + '1' + s.slice(cellIdx + 1);
  return true;
}

export { CELL, RES, STEP };
