// Generazione deterministica dei dati del mondo (senza Three.js):
// altimetria, biomi, sentieri, torrente, alberi, legno morto, rocce, felci e celle ecologiche.
import { mulberry32, createNoise2D, fbm, clamp, smoothstep, pickWeighted } from '../core/rng.js';

export const WORLD_SIZE = 400;
export const RES = 200; // quadrati per lato -> 201x201 vertici, passo 2 m
export const STEP = WORLD_SIZE / RES;
export const HALF = WORLD_SIZE / 2;
export const CELL = 20; // dimensione cella ecologica (m)
export const CELLS = WORLD_SIZE / CELL;

export const BIOMES = ['conifere', 'faggeta', 'misto', 'antica', 'prati', 'alta'];
export const BIOME_LABEL = {
  conifere: 'Bosco di conifere', faggeta: 'Faggeta', misto: 'Bosco misto', antica: 'Foresta antica', prati: 'Prati e margini', alta: 'Alta montagna',
};
export const BIOME_COLOR = {
  conifere: '#3f5a3a', faggeta: '#8a6a3a', misto: '#5e6e3a', antica: '#3a4a34', prati: '#8ea05a', alta: '#8a8a7a',
};

// Composizione arborea per bioma
const TREE_MIX = {
  conifere: [['abete', 70], ['pino', 20], ['larice', 10]],
  faggeta: [['faggio', 88], ['abete', 12]],
  misto: [['castagno', 30], ['quercia', 30], ['betulla', 24], ['faggio', 16]],
  antica: [['abete', 45], ['faggio', 45], ['larice', 10]],
  prati: [['betulla', 40], ['pino', 30], ['quercia', 30]],
  alta: [['larice', 55], ['pino', 45]],
};
const TREE_DENSITY = { conifere: 0.62, faggeta: 0.5, misto: 0.5, antica: 0.6, prati: 0.035, alta: 0.14 };
const DEADWOOD = { conifere: 0.012, faggeta: 0.012, misto: 0.01, antica: 0.05, prati: 0.002, alta: 0.006 };
const ROCKS = { conifere: 0.008, faggeta: 0.006, misto: 0.005, antica: 0.01, prati: 0.004, alta: 0.06 };
const FERNS = { conifere: 0.05, faggeta: 0.03, misto: 0.07, antica: 0.14, prati: 0.01, alta: 0.0 };
const BUSHES = { conifere: 0.012, faggeta: 0.008, misto: 0.03, antica: 0.02, prati: 0.02, alta: 0.03 };

export const TREE_TYPES = ['abete', 'pino', 'larice', 'faggio', 'castagno', 'quercia', 'betulla'];
export const TREE_LABEL = { abete: 'Abete rosso', pino: 'Pino', larice: 'Larice', faggio: 'Faggio', castagno: 'Castagno', quercia: 'Quercia', betulla: 'Betulla' };

export function generateWorld(region) {
  const seed = region.seed;
  const rand = mulberry32(seed);
  const n1 = createNoise2D(seed + 1);
  const n2 = createNoise2D(seed + 2);
  const n3 = createNoise2D(seed + 3);
  const V = RES + 1;
  const heights = new Float32Array(V * V);
  const biome = new Uint8Array(V * V);
  const trailDist = new Float32Array(V * V).fill(99);
  const streamDist = new Float32Array(V * V).fill(99);

  const parking = { x: 0, z: HALF - 22 };
  const streamPhase = rand() * 10;
  const streamX = (z) => 70 * Math.sin(z / 95 + streamPhase) + 22 * n3(z / 60, 3.7) - 30;

  // --- altimetria grezza
  const raw = (x, z) => {
    let h = region.baseHeight + fbm(n1, x / 160, z / 160, 5) * region.relief;
    h += fbm(n2, x / 45, z / 45, 3) * region.relief * 0.12;
    h += (-z / HALF) * region.relief * 0.35; // sale verso nord
    const d = Math.abs(x - streamX(z));
    h -= region.relief * 0.35 * Math.exp(-((d / 45) ** 2));
    return h;
  };
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -HALF + i * STEP, z = -HALF + j * STEP;
    heights[j * V + i] = raw(x, z);
  }

  // --- torrente
  const stream = [];
  for (let z = -HALF - 4; z <= HALF + 4; z += 3) stream.push({ x: streamX(z), z });
  rasterDist(stream, streamDist, 6);

  // --- sentieri: dal parcheggio verso mete casuali
  const trails = [];
  const targets = [];
  for (let k = 0; k < 4; k++) {
    const ang = -Math.PI / 2 + (k - 1.5) * 0.7 + (rand() - 0.5) * 0.3;
    const dist = 140 + rand() * 170;
    targets.push({ x: clamp(parking.x + Math.cos(ang) * dist, -HALF + 20, HALF - 20), z: clamp(parking.z + Math.sin(ang) * dist, -HALF + 20, HALF - 20) });
  }
  for (const t of targets) trails.push(makeTrail(parking, t, n2, rand));
  // un anello che collega due mete
  trails.push(makeTrail(targets[1], targets[2], n2, rand));
  trails.push(makeTrail(targets[0], targets[3], n2, rand));
  for (const tr of trails) rasterDist(tr, trailDist, 6);

  // --- livellamento sentieri, scavo torrente, spiazzo parcheggio
  const smoothH = heights.slice();
  boxBlur(smoothH, V, 3);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const idx = j * V + i;
    const x = -HALF + i * STEP, z = -HALF + j * STEP;
    let h = heights[idx];
    const tw = 1 - smoothstep(1.2, 3.5, trailDist[idx]);
    h = h * (1 - tw * 0.8) + smoothH[idx] * tw * 0.8 - tw * 0.08;
    const sd = streamDist[idx];
    h -= 1.4 * (1 - smoothstep(0.8, 3.2, sd));
    const pd = Math.hypot(x - parking.x, z - parking.z);
    const pw = 1 - smoothstep(10, 18, pd);
    const ph = smoothH[Math.round((parking.z + HALF) / STEP) * V + Math.round((parking.x + HALF) / STEP)];
    h = h * (1 - pw) + ph * pw;
    heights[idx] = h;
  }

  // --- biomi: Voronoi con distorsione del dominio
  const seeds = [];
  const weights = Object.entries(region.biomeWeights);
  for (let k = 0; k < 22; k++) seeds.push({ x: (rand() - 0.5) * WORLD_SIZE * 1.05, z: (rand() - 0.5) * WORLD_SIZE * 1.05, b: pickWeighted(weights, rand) });
  seeds.push({ x: parking.x, z: parking.z, b: 'prati' });
  const biomeAtRaw = (x, z, h) => {
    if (h > region.alpineHeight + n2(x / 30, z / 30) * 3) return 'alta';
    const wx = x + n1(x / 70 + 9, z / 70) * 28, wz = z + n1(x / 70, z / 70 + 9) * 28;
    let best = Infinity, bb = 'misto';
    for (const s of seeds) { const d = (s.x - wx) ** 2 + (s.z - wz) ** 2; if (d < best) { best = d; bb = s.b; } }
    if (Math.hypot(x - parking.x, z - parking.z) < 30) return 'prati';
    return bb;
  };
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const idx = j * V + i;
    biome[idx] = BIOMES.indexOf(biomeAtRaw(-HALF + i * STEP, -HALF + j * STEP, heights[idx]));
  }

  const world = { region, heights, biome, trailDist, streamDist, trails, stream, parking, targets, V };
  world.heightAt = (x, z) => heightAt(world, x, z);
  world.biomeAt = (x, z) => BIOMES[biome[vIndex(x, z)]];
  world.trailAt = (x, z) => trailDist[vIndex(x, z)];
  world.streamAt = (x, z) => streamDist[vIndex(x, z)];
  world.slopeAt = (x, z) => {
    const e = 1.5;
    return Math.hypot(heightAt(world, x + e, z) - heightAt(world, x - e, z), heightAt(world, x, z + e) - heightAt(world, x, z - e)) / (2 * e);
  };

  // --- alberi (griglia jitterata)
  const trees = [];
  const G = 3.2;
  for (let gz = -HALF + G / 2; gz < HALF; gz += G) for (let gx = -HALF + G / 2; gx < HALF; gx += G) {
    const x = gx + (rand() - 0.5) * G * 0.9, z = gz + (rand() - 0.5) * G * 0.9;
    const b = world.biomeAt(x, z);
    let dens = TREE_DENSITY[b] * (0.55 + 0.9 * (0.5 + 0.5 * n3(x / 25, z / 25)));
    if (world.trailAt(x, z) < 2.6 || world.streamAt(x, z) < 2.4) continue;
    if (Math.hypot(x - parking.x, z - parking.z) < 22) continue;
    if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) continue;
    if (rand() > dens) continue;
    const type = pickWeighted(TREE_MIX[b], rand);
    let scale = 0.75 + rand() * 0.55;
    if (b === 'antica') scale *= 1.3;
    if (b === 'alta') scale *= 0.85;
    trees.push({ x, z, y: world.heightAt(x, z), type, scale, rot: rand() * Math.PI * 2, biome: b });
  }

  // --- elementi di sottobosco
  const logs = [], stumps = [], rocks = [], ferns = [], bushes = [];
  const scatter = (dens, cb) => {
    const S = 4;
    for (let gz = -HALF + S / 2; gz < HALF; gz += S) for (let gx = -HALF + S / 2; gx < HALF; gx += S) {
      const x = gx + (rand() - 0.5) * S, z = gz + (rand() - 0.5) * S;
      const b = world.biomeAt(x, z);
      if (world.trailAt(x, z) < 2.2 || world.streamAt(x, z) < 1.8) continue;
      if (Math.hypot(x - parking.x, z - parking.z) < 16) continue;
      if (rand() < dens[b] * S * S * 0.25) cb(x, z, b);
    }
  };
  scatter(DEADWOOD, (x, z, b) => {
    if (rand() < 0.55) logs.push({ x, z, y: world.heightAt(x, z), len: 3 + rand() * 6, r: 0.18 + rand() * 0.22, rot: rand() * Math.PI, biome: b, moss: rand() });
    else stumps.push({ x, z, y: world.heightAt(x, z), r: 0.25 + rand() * 0.25, h: 0.3 + rand() * 0.5, biome: b });
  });
  scatter(ROCKS, (x, z, b) => rocks.push({ x, z, y: world.heightAt(x, z), s: 0.3 + rand() ** 2 * (b === 'alta' ? 2.2 : 1.2), rot: rand() * 6.28, sq: 0.5 + rand() * 0.5 }));
  scatter(FERNS, (x, z) => { const n = 1 + Math.floor(rand() * 3); for (let k = 0; k < n; k++) { const fx = x + (rand() - 0.5) * 3, fz = z + (rand() - 0.5) * 3; ferns.push({ x: fx, z: fz, y: world.heightAt(fx, fz), s: 0.6 + rand() * 0.7, rot: rand() * 6.28 }); } });
  scatter(BUSHES, (x, z, b) => bushes.push({ x, z, y: world.heightAt(x, z), s: 0.5 + rand() * 0.8, rot: rand() * 6.28, biome: b }));

  world.trees = trees; world.logs = logs; world.stumps = stumps; world.rocks = rocks; world.ferns = ferns; world.bushes = bushes;

  // --- hash spaziale degli alberi (collisioni e habitat)
  const HS = 8, HN = WORLD_SIZE / HS;
  const grid = Array.from({ length: HN * HN }, () => []);
  for (const t of trees) {
    const gi = clamp(Math.floor((t.x + HALF) / HS), 0, HN - 1), gj = clamp(Math.floor((t.z + HALF) / HS), 0, HN - 1);
    grid[gj * HN + gi].push(t);
  }
  world.treesNear = (x, z, r) => {
    const out = [];
    const i0 = clamp(Math.floor((x - r + HALF) / HS), 0, HN - 1), i1 = clamp(Math.floor((x + r + HALF) / HS), 0, HN - 1);
    const j0 = clamp(Math.floor((z - r + HALF) / HS), 0, HN - 1), j1 = clamp(Math.floor((z + r + HALF) / HS), 0, HN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const t of grid[j * HN + i]) {
      if ((t.x - x) ** 2 + (t.z - z) ** 2 <= r * r) out.push(t);
    }
    return out;
  };

  // --- celle ecologiche
  const cells = [];
  for (let cj = 0; cj < CELLS; cj++) for (let ci = 0; ci < CELLS; ci++) {
    const x0 = -HALF + ci * CELL, z0 = -HALF + cj * CELL;
    const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
    const biomeCount = {};
    let hs = 0, nS = 0, streamNear = 0;
    for (let k = 0; k < 16; k++) {
      const x = x0 + ((k % 4) + 0.5) * (CELL / 4), z = z0 + (Math.floor(k / 4) + 0.5) * (CELL / 4);
      const b = world.biomeAt(x, z); biomeCount[b] = (biomeCount[b] || 0) + 1;
      hs += world.heightAt(x, z); nS++;
      if (world.streamAt(x, z) < 12) streamNear++;
    }
    const mainBiome = Object.entries(biomeCount).sort((a, b) => b[1] - a[1])[0][0];
    const tr = world.treesNear(cx, cz, CELL * 0.75);
    const treeFrac = {};
    for (const t of tr) treeFrac[t.type] = (treeFrac[t.type] || 0) + 1;
    for (const k in treeFrac) treeFrac[k] /= Math.max(6, tr.length);
    const dz = heightAt(world, cx, cz + 6) - heightAt(world, cx, cz - 6); // >0: versante esposto a nord (z negativo = nord)
    const northness = clamp(-dz / 6, -1, 1);
    const deadwood = logs.filter((l) => Math.abs(l.x - cx) < CELL / 2 && Math.abs(l.z - cz) < CELL / 2).length
      + stumps.filter((s) => Math.abs(s.x - cx) < CELL / 2 && Math.abs(s.z - cz) < CELL / 2).length;
    cells.push({
      i: ci, j: cj, idx: cj * CELLS + ci, cx, cz, x0, z0, biome: mainBiome, biomeCount, treeFrac, treeCount: tr.length,
      height: hs / nS, wetBonus: streamNear / 16 * 0.15 + northness * 0.06, exposure: tr.length < 6 ? 1 : 0, deadwood,
    });
  }
  world.cells = cells;
  world.cellAt = (x, z) => {
    const ci = clamp(Math.floor((x + HALF) / CELL), 0, CELLS - 1), cj = clamp(Math.floor((z + HALF) / CELL), 0, CELLS - 1);
    return cells[cj * CELLS + ci];
  };
  world.inBounds = (x, z) => Math.abs(x) < HALF - 0.5 && Math.abs(z) < HALF - 0.5;
  return world;
}

function vIndex(x, z) {
  const i = clamp(Math.round((x + HALF) / STEP), 0, RES), j = clamp(Math.round((z + HALF) / STEP), 0, RES);
  return j * (RES + 1) + i;
}

// Interpolazione coerente con la triangolazione della mesh del terreno
export function heightAt(world, x, z) {
  const V = RES + 1;
  const fx = clamp((x + HALF) / STEP, 0, RES - 1e-4), fz = clamp((z + HALF) / STEP, 0, RES - 1e-4);
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const h = world.heights;
  const h00 = h[j * V + i], h10 = h[j * V + i + 1], h01 = h[(j + 1) * V + i], h11 = h[(j + 1) * V + i + 1];
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

function makeTrail(from, to, noise, rand) {
  const pts = [{ x: from.x, z: from.z }];
  let x = from.x, z = from.z;
  const off = rand() * 100;
  for (let s = 0; s < 400; s++) {
    const dx = to.x - x, dz = to.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 4) break;
    let ang = Math.atan2(dz, dx) + noise(s / 18 + off, off) * 0.9;
    x += Math.cos(ang) * 3; z += Math.sin(ang) * 3;
    x = clamp(x, -HALF + 6, HALF - 6); z = clamp(z, -HALF + 6, HALF - 6);
    pts.push({ x, z });
  }
  pts.push({ x: to.x, z: to.z });
  return pts;
}

function rasterDist(poly, field, radius) {
  const V = RES + 1;
  for (let k = 0; k < poly.length - 1; k++) {
    const a = poly[k], b = poly[k + 1];
    const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
    const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
    const i0 = clamp(Math.floor((minX + HALF) / STEP), 0, RES), i1 = clamp(Math.ceil((maxX + HALF) / STEP), 0, RES);
    const j0 = clamp(Math.floor((minZ + HALF) / STEP), 0, RES), j1 = clamp(Math.ceil((maxZ + HALF) / STEP), 0, RES);
    const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
      const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
      const idx = j * V + i;
      if (d < field[idx]) field[idx] = d;
    }
  }
}

function boxBlur(arr, V, r) {
  const tmp = new Float32Array(arr.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const ii = pass === 0 ? clamp(i + k, 0, V - 1) : i, jj = pass === 0 ? j : clamp(j + k, 0, V - 1);
        s += arr[jj * V + ii]; n++;
      }
      tmp[j * V + i] = s / n;
    }
    arr.set(tmp);
  }
}
