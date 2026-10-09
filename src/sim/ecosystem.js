// Ecosistema: ogni cella del bosco ha uno stato ambientale da cui dipende la
// probabilità che le specie producano corpi fruttiferi. I funghi nascono, maturano,
// invecchiano, vengono mangiati o marciscono indipendentemente dal giocatore.
import { SPECIES, SPECIES_BY_ID } from '../data/species.js';
import { dayOfYear, seasonFactor } from '../data/calendar.js';
import { mulberry32, clamp, smoothstep, poisson } from '../core/rng.js';
import { regionalDay } from './weather.js';
import { CELL, HALF } from '../world/worldgen.js';

const BASE_RATE = 0.045;
const MAX_MUSHROOMS = 3500;

export function createEcoState(regionId) {
  return { regionId, soil: {}, snow: 0, mushrooms: [], nextId: 1, simulatedUntil: null, pressure: {} };
}

// Precalcoli per regione (non salvati)
export function prepareEco(world) {
  const cells = world.cells;
  const deadwoodByCell = cells.map(() => []);
  const put = (item, kind) => {
    const c = world.cellAt(item.x, item.z);
    deadwoodByCell[c.idx].push({ ...item, kind });
  };
  world.logs.forEach((l) => put(l, 'log'));
  world.stumps.forEach((s) => put(s, 'stump'));
  const habitat = cells.map((cell) => {
    const res = {};
    for (const sp of SPECIES) {
      let b = 0, tot = 0;
      for (const [bio, n] of Object.entries(cell.biomeCount)) { b += (sp.biomes[bio] || 0) * n; tot += n; }
      b /= tot;
      let t = 1;
      const trees = Object.entries(sp.trees);
      if (trees.length) {
        let ts = 0;
        for (const [tt, w] of trees) ts += Math.min(1, (cell.treeFrac[tt] || 0) * 2.5) * w;
        t = 0.12 + Math.min(1.2, ts);
      }
      let h = b * t;
      if (sp.traits.substrate === 'legno') h *= Math.min(1.2, deadwoodByCell[cell.idx].length / 2);
      if (sp.biomes.prati && cell.exposure) h *= 1.3;
      if (h > 0.04) res[sp.id] = h;
    }
    return res;
  });
  world.eco = { habitat, deadwoodByCell };
}

export function stageOf(m, day) {
  const f = (day - m.birth) / m.life;
  if (f < 0.3) return 'giovane';
  if (f < 0.75) return 'maturo';
  return 'vecchio';
}

export function growthScale(m, day) {
  const f = clamp((day - m.birth + 0.5) / m.life, 0, 1.2);
  const g = f < 0.3 ? 0.42 + (f / 0.3) * 0.38 : f < 0.75 ? 0.8 + ((f - 0.3) / 0.45) * 0.2 : 1.0 + (f - 0.75) * 0.25;
  return g * m.size;
}

export function soilMoistureOn(eco, day) {
  return eco.soil[day] ?? 50;
}

// Valori ambientali di una cella (per strumenti e competenza habitat)
export function cellReadings(world, eco, ws, cell, day, region) {
  const rec = regionalDay(ws, day, region);
  const m = clamp(soilMoistureOn(eco, day) * (1 + cell.wetBonus), 0, 100);
  const temps = [];
  for (let k = 0; k < 4; k++) { const r = regionalDay(ws, day - k, region); temps.push((r.tMin + r.tMax) / 2); }
  const tMean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const hab = world.eco.habitat[cell.idx];
  let best = 0, tempFav = 0;
  const doy = dayOfYear(day);
  for (const [id, h] of Object.entries(hab)) {
    const sp = SPECIES_BY_ID[id];
    const s = seasonFactor(doy, sp.season);
    const tf = tempScore(sp, tMean);
    if (h * s > best) { best = h * s; tempFav = tf; }
  }
  const vis = clamp(1 - (cell.biome === 'faggeta' ? 0.35 : cell.biome === 'antica' ? 0.3 : cell.biome === 'prati' ? 0.05 : 0.2) - (rec.type === 'nebbia' ? 0.15 : 0), 0.2, 1);
  return { moisture: m, tempFav: tempFav * 100, habitat: clamp(best, 0, 1) * 100, visibility: vis * 100, tMean };
}

function tempScore(sp, t) {
  const [a, b] = sp.temp;
  if (t >= a && t <= b) return 1;
  const d = t < a ? a - t : t - b;
  return Math.exp(-((d / 3.5) ** 2));
}

function stepSoil(eco, rec, prevM) {
  let m = prevM;
  m += rec.rain * 1.5 * (1 - m / 125);
  const evap = (0.8 + Math.max(0, rec.tMax) * 0.13) * (rec.sun / 9 + 0.35);
  m -= evap;
  // neve: accumulo e fusione
  eco.snow *= 0.96; // assestamento e sublimazione
  if (rec.snow > 0) eco.snow += rec.snow * 0.8;
  if (eco.snow > 0 && rec.tMax > 1.5) {
    const melt = Math.min(eco.snow, (rec.tMax - 1) * 1.6);
    eco.snow -= melt; m += melt * 0.9;
  }
  return clamp(m, 4, 100);
}

// Avanza la simulazione fino al giorno `day` (incluso)
export function simulateUntil(world, eco, ws, region, day) {
  if (eco.simulatedUntil === null || day - eco.simulatedUntil > 45) {
    // riscaldamento: 40 giorni di storia
    eco.mushrooms = []; eco.snow = 0; eco.soil = {};
    eco.soil[day - 41] = 50;
    eco.simulatedUntil = day - 41;
  }
  while (eco.simulatedUntil < day) {
    const d = eco.simulatedUntil + 1;
    stepDay(world, eco, ws, region, d);
    eco.simulatedUntil = d;
  }
  // pulizia dello storico umidità
  for (const k of Object.keys(eco.soil)) if (+k < day - 30) delete eco.soil[k];
}

function stepDay(world, eco, ws, region, d) {
  const rec = regionalDay(ws, d, region);
  const prevM = eco.soil[d - 1] ?? 50;
  eco.soil[d] = +stepSoil(eco, rec, prevM).toFixed(1);
  const rand = mulberry32((region.seed * 31 + d * 7349) >>> 0);
  const doy = dayOfYear(d);

  // --- invecchiamento e scomparsa
  const frost = rec.tMin < -1.5;
  const dry = eco.soil[d] < 24;
  const keep = [];
  for (const m of eco.mushrooms) {
    const sp = SPECIES_BY_ID[m.sp];
    if (frost && sp.temp[0] > 3) m.life = Math.min(m.life, d - m.birth + 1);
    if (dry && rand() < 0.4) m.life -= 1;
    if (d - m.birth > m.life) continue;
    if (rand() < 0.012) continue; // raccolto da animali / altri cercatori
    if (!m.eaten && rand() < 0.03) m.eaten = 1;
    if (!m.slugs && eco.soil[d] > 60 && rec.rain > 2 && rand() < 0.1) m.slugs = 1;
    keep.push(m);
  }
  eco.mushrooms = keep;

  // --- pressione di raccolta che si attenua
  for (const k of Object.keys(eco.pressure)) { eco.pressure[k] *= 0.85; if (eco.pressure[k] < 0.02) delete eco.pressure[k]; }

  // --- nuove fruttificazioni
  if (eco.mushrooms.length > MAX_MUSHROOMS) return;
  const temps = [];
  for (let k = 0; k < 4; k++) { const r = regionalDay(ws, d - k, region); temps.push((r.tMin + r.tMax) / 2); }
  const tMean = temps.reduce((a, b) => a + b, 0) / 4;
  const spFactors = {};
  for (const sp of SPECIES) {
    const s = seasonFactor(doy, sp.season);
    if (s <= 0) continue;
    const tf = tempScore(sp, tMean);
    let lagM = 0, n = 0;
    for (let k = sp.lag - 1; k <= sp.lag + 1; k++) { lagM += eco.soil[d - k] ?? eco.soil[d] ?? 50; n++; }
    lagM /= n;
    const mf = smoothstep(sp.moisture - 16, sp.moisture + 12, lagM) * smoothstep(sp.moisture - 32, sp.moisture - 8, eco.soil[d]);
    const snowF = sp.id === 'dormiente' ? 1 : eco.snow > 4 ? 0.05 : 1;
    const f = s * tf * mf * snowF * sp.abundance;
    if (f > 0.01) spFactors[sp.id] = f;
  }
  for (const cell of world.cells) {
    const hab = world.eco.habitat[cell.idx];
    const pressure = 1 - Math.min(0.6, eco.pressure[cell.idx] || 0);
    const wet = 1 + cell.wetBonus * 2;
    for (const [id, h] of Object.entries(hab)) {
      const f = spFactors[id];
      if (!f) continue;
      const lambda = BASE_RATE * h * f * wet * pressure;
      const n = poisson(lambda, rand);
      for (let k = 0; k < n; k++) spawnCluster(world, eco, SPECIES_BY_ID[id], cell, d, rand);
    }
  }
}

function spawnCluster(world, eco, sp, cell, d, rand) {
  const morph = sp.morph;
  let cx, cz, attach = null;
  // scegli il punto d'origine in base al substrato / alberi simbionti
  if (sp.traits.substrate === 'legno') {
    const dw = world.eco.deadwoodByCell[cell.idx];
    if (!dw.length) return;
    const item = dw[Math.floor(rand() * dw.length)];
    attach = item;
  } else {
    const treeTypes = Object.keys(sp.trees);
    let placed = false;
    if (treeTypes.length) {
      const near = world.treesNear(cell.cx, cell.cz, CELL * 0.75).filter((t) => sp.trees[t.type]);
      if (near.length) {
        const t = near[Math.floor(rand() * near.length)];
        const a = rand() * Math.PI * 2, r = 1.2 + rand() * 5;
        cx = t.x + Math.cos(a) * r; cz = t.z + Math.sin(a) * r; placed = true;
      }
    }
    if (!placed) { cx = cell.x0 + rand() * CELL; cz = cell.z0 + rand() * CELL; }
  }
  const count = sp.cluster[0] + Math.floor(rand() * (sp.cluster[1] - sp.cluster[0] + 1));
  const lifeBase = sp.lifespan * (0.75 + rand() * 0.5);
  const baseCover = { faggeta: 0.55, antica: 0.45, misto: 0.4, conifere: 0.35, prati: 0.1, alta: 0.15 }[cell.biome] ?? 0.3;
  const ringR = 1.4 + rand() * 1.8, ringA = rand() * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    let x, z, ay = 0, face = rand() * Math.PI * 2;
    if (attach) {
      if (attach.kind === 'log') {
        const t = (rand() - 0.5) * attach.len * 0.85;
        const ax = Math.cos(attach.rot), az = Math.sin(attach.rot);
        const side = rand() < 0.5 ? 1 : -1;
        const px = -az * side, pz = ax * side;
        if (morph.growth === 'mensola') {
          x = attach.x + ax * t + px * attach.r * 0.95; z = attach.z + az * t + pz * attach.r * 0.95;
          ay = attach.r * (0.6 + rand() * 0.5); face = Math.atan2(pz, px);
        } else {
          const off = attach.r + 0.08 + rand() * 0.25;
          x = attach.x + ax * t + px * off; z = attach.z + az * t + pz * off;
        }
      } else {
        const a = rand() * Math.PI * 2;
        if (morph.growth === 'mensola') {
          x = attach.x + Math.cos(a) * attach.r * 0.95; z = attach.z + Math.sin(a) * attach.r * 0.95;
          ay = attach.h * (0.3 + rand() * 0.6); face = a;
        } else {
          const r = attach.r + 0.05 + rand() * 0.3;
          x = attach.x + Math.cos(a) * r; z = attach.z + Math.sin(a) * r;
        }
      }
    } else if (morph.growth === 'cerchio') {
      const a = ringA + (k / count) * Math.PI * 1.3;
      x = cx + Math.cos(a) * ringR + (rand() - 0.5) * 0.3; z = cz + Math.sin(a) * ringR + (rand() - 0.5) * 0.3;
    } else if (morph.growth === 'cespitoso') {
      x = cx + (rand() - 0.5) * 0.35; z = cz + (rand() - 0.5) * 0.35;
    } else {
      const spread = morph.growth === 'singolo' ? 1.2 : 1.6;
      x = cx + (rand() - 0.5) * spread * 2; z = cz + (rand() - 0.5) * spread * 2;
    }
    if (!world.inBounds(x, z)) continue;
    if (world.trailAt(x, z) < 1.4 || world.streamAt(x, z) < 1.6) continue;
    if (Math.abs(x - world.parking.x) < 14 && Math.abs(z - world.parking.z) < 14) continue;
    const birth = d - (k === 0 ? 0 : Math.floor(rand() * 2));
    eco.mushrooms.push({
      id: eco.nextId++, sp: sp.id, x: +x.toFixed(2), z: +z.toFixed(2), ay: +ay.toFixed(2), face: +face.toFixed(2),
      birth, life: Math.max(2, Math.round(lifeBase + (rand() - 0.5) * 2)), size: +(0.8 + rand() * 0.45).toFixed(2),
      seed: Math.floor(rand() * 1e6), tilt: +((rand() - 0.5) * 0.25).toFixed(2),
      cover: +clamp(baseCover * (sp.id === 'trombetta' || sp.id === 'dormiente' ? 1.6 : 1) * (0.4 + rand()), 0, 0.95).toFixed(2),
      eaten: 0, slugs: 0, cell: world.cellAt(x, z).idx,
    });
  }
}

export function removeMushroom(eco, id) {
  const i = eco.mushrooms.findIndex((m) => m.id === id);
  if (i >= 0) {
    const m = eco.mushrooms[i];
    eco.mushrooms.splice(i, 1);
    eco.pressure[m.cell] = (eco.pressure[m.cell] || 0) + 0.04;
    return m;
  }
  return null;
}

// Per la modalità libera: un "bosco generoso" senza toccare lo stato reale
export function boostedCopy(world, eco, ws, region, day) {
  const copy = { ...eco, mushrooms: eco.mushrooms.slice() };
  const rand = mulberry32(day * 13 + 7);
  const doy = dayOfYear(day);
  for (const cell of world.cells) {
    for (const [id, h] of Object.entries(world.eco.habitat[cell.idx])) {
      const sp = SPECIES_BY_ID[id];
      const s = Math.max(seasonFactor(doy, sp.season), 0.3);
      if (rand() < h * s * sp.abundance * 0.12) spawnCluster(world, copy, sp, cell, day - Math.floor(rand() * 3), rand);
    }
  }
  return copy;
}

export { HALF };
