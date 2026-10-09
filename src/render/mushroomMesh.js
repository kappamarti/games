// Generatore procedurale di modelli 3D dei funghi: ogni specie ha profilo, colori,
// superficie inferiore (pori, lamelle, pliche, aculei...), gambo, anello e volva propri.
// Le varianti cambiano con età, stato (mangiato, lumache) e un seme individuale.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D, mulberry32, smoothstep, clamp } from '../core/rng.js';
import { patchMaterial } from './envShader.js';

const nz = createNoise2D(4242);
const cache = new Map();

// --- lathe personalizzato con colori e deformazioni per vertice -------------
function lathe(profile, segs, colorFn, { theta0 = 0, thetaLen = Math.PI * 2, disp = null } = {}) {
  const P = profile.length;
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const th = theta0 + (i / segs) * thetaLen;
    const ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j < P; j++) {
      const p = profile[j];
      let r = p.r, y = p.y;
      if (disp) { const d = disp(i, j, th, p); r += d.dr || 0; y += d.dy || 0; r = Math.max(0, r); }
      pos.push(r * ct, y, r * st);
      colorFn(c, th, p, i, j);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < P - 1; j++) {
    const a = i * P + j, b = (i + 1) * P + j, cc = (i + 1) * P + j + 1, d = i * P + j + 1;
    idx.push(a, b, d, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function colored(geo, hex, jitter = 0, seed = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const v = 1 + (r() - 0.5) * jitter;
    arr[i * 3] = base.r * v; arr[i * 3 + 1] = base.g * v; arr[i * 3 + 2] = base.b * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

const C = (h) => new THREE.Color(h);

function ageColor(c, stage) {
  if (stage === 'vecchio') {
    const hsl = {}; c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s * 0.7, hsl.l * 0.78);
  }
  return c;
}

/**
 * @param {object} sp specie
 * @param {'giovane'|'maturo'|'vecchio'} stage
 * @param {number} variant 0..3
 * @param {{eaten?:boolean, slugs?:boolean, washed?:boolean}} flags
 */
export function mushroomGeometry(sp, stage, variant = 0, flags = {}) {
  const key = `${sp.id}|${stage}|${variant}|${flags.eaten ? 1 : 0}${flags.slugs ? 1 : 0}${flags.washed ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const geo = build(sp, stage, variant, flags);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  cache.set(key, geo);
  return geo;
}

function build(sp, stage, variant, flags) {
  const m = sp.morph;
  const rand = mulberry32(variant * 7919 + sp.id.length * 31 + 1);
  const parts = [];
  const young = stage === 'giovane', old = stage === 'vecchio';
  const R = m.cap.r * (young ? 0.78 : old ? 1.1 : 1) * (0.92 + rand() * 0.16);
  const stemH = m.stem.h * (young ? 0.6 : old ? 1.05 : 1) * (0.9 + rand() * 0.2);
  const stemR = m.stem.r * (young ? 1.12 : 1);
  const capCol = C(m.cap.color), capCol2 = C(m.cap.color2), rimCol = C(m.cap.rim);
  const underCol = C(old && m.under.colorOld ? m.under.colorOld : m.under.color);
  const stemCol = C(m.stem.color), stemCol2 = C(m.stem.color2 || m.stem.color);
  const biteA = rand() * Math.PI * 2;
  const seedA = rand() * 100;

  // ---------- GAMBO
  let stemTopY = stemH;
  if (m.stem.shape !== 'nessuno' && stemH > 0) {
    const prof = [];
    const N = 20;
    for (let k = 0; k <= N; k++) {
      const t = 1 - k / N; // dall'alto verso il basso (normali verso l'esterno)
      let r = stemR;
      switch (m.stem.shape) {
        case 'panciuto': r = stemR * (0.85 + 0.75 * Math.exp(-(((t - 0.28) / 0.33) ** 2))) * (young ? 1.2 : 1); break;
        case 'conico': r = stemR * (0.55 + 0.9 * t ** 1.4); break;
        case 'slanciato': r = stemR * (0.9 + 0.15 * (1 - t)); break;
        case 'laterale': r = stemR * (0.8 + 0.4 * t); break;
        default: r = stemR * (1 + 0.15 * (1 - t));
      }
      if (m.stem.bulbo) r *= 1 + 1.1 * Math.exp(-((t / 0.12) ** 2));
      if (t < 0.04) r *= 0.8 + t * 5;
      prof.push({ r, y: t * stemH - 0.01, t });
    }
    prof.push({ r: 0, y: -0.012, t: 0 });
    const stem = lathe(prof, 30, (c, th, p) => {
      c.copy(stemCol2).lerp(stemCol, smoothstep(0.0, 0.8, p.t));
      if (m.stem.reticolo && p.t > 0.35) {
        const net = Math.abs(nz(th * 5 + seedA, p.t * 22)) < 0.12;
        if (net) c.lerp(sp.id === 'satanas' ? C('#a82018') : C(m.stem.color2 === m.stem.color ? '#ffffff' : '#f2ead6'), 0.55);
      }
      if (m.stem.zebrato) { const z = Math.sin(p.t * 38 + nz(th * 2, p.t * 4) * 3); if (z > 0.55) c.lerp(C(sp.id === 'amanita_phalloides' ? '#b4bc90' : '#6a4a30'), 0.6); }
      if (m.stem.squame) { if (nz(th * 9 + seedA, p.t * 40) > 0.35) c.copy(stemCol2); else c.copy(stemCol); }
      if (m.stem.scrobicoli && nz(th * 4, p.t * 9) > 0.55) c.multiplyScalar(0.7);
      if (m.stem.volvaWarts && p.t < 0.22 && Math.sin(p.t * 90) > 0.6) c.set('#fbf8f0');
      ageColor(c, stage);
    }, { disp: (i, j, th, p) => ({ dr: nz(th * 2 + seedA, p.t * 3) * stemR * 0.08 }) });
    // leggera curvatura del gambo
    const pa = stem.attributes.position;
    const bend = (rand() - 0.5) * 0.25 * stemH;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setX(i, pa.getX(i) + bend * (y / stemH) ** 2); }
    stem.computeVertexNormals();
    parts.push(stem);
    // anello
    if (m.stem.ring && !(young && sp.id === 'mazza_tamburo')) {
      const ry = stemH * (sp.id === 'mazza_tamburo' ? 0.72 : 0.8);
      const ringProf = [
        { r: stemR * 1.0, y: ry + 0.004 }, { r: stemR * 1.9, y: ry - 0.006 }, { r: stemR * 2.3, y: ry - 0.02 }, { r: stemR * 2.0, y: ry - 0.03 }, { r: stemR * 0.98, y: ry - 0.01 },
      ];
      parts.push(lathe(ringProf, 30, (c, th) => { c.set(m.stem.ring); c.multiplyScalar(0.9 + nz(th * 6, 1) * 0.1); ageColor(c, stage); },
        { disp: (i, j, th) => ({ dy: j >= 2 ? nz(th * 4 + seedA, 2) * 0.006 : 0 }) }));
    }
    // volva a sacco
    if (m.stem.volva) {
      const vb = stemR * (m.stem.bulbo ? 2.1 : 1.4);
      const vProf = [
        { r: vb * 1.02, y: 0.045 }, { r: vb * 1.18, y: 0.03 }, { r: vb * 1.15, y: 0.005 }, { r: vb * 0.6, y: -0.012 }, { r: 0, y: -0.014 },
      ];
      parts.push(lathe(vProf, 26, (c, th, p) => { c.set(m.stem.volva); c.multiplyScalar(0.85 + nz(th * 3, p.y * 40) * 0.12); },
        { disp: (i, j, th) => ({ dy: j === 0 ? Math.abs(nz(th * 5 + seedA, 3)) * 0.02 - 0.008 : 0 }) }));
    }
  } else {
    stemTopY = 0;
  }

  // ---------- CAPPELLO
  const shape = m.cap.shape;
  const eaten = flags.eaten;
  const biteFn = (th, u) => {
    if (!eaten) return 1;
    const d = Math.abs(Math.atan2(Math.sin(th - biteA), Math.cos(th - biteA)));
    return 1 - 0.35 * smoothstep(0.5, 0.0, d) * smoothstep(0.45, 1, u);
  };
  const capColorFn = (c, th, p) => {
    if (p.part === 'under') { underColor(c, th, p); return; }
    const u = p.u;
    c.copy(capCol2).lerp(capCol, smoothstep(0, 0.45, u));
    c.lerp(rimCol, smoothstep(0.82, 1, u) * 0.75);
    const n = nz(th * 3 + seedA, u * 5);
    switch (m.cap.texture) {
      case 'vellutato': c.multiplyScalar(0.92 + n * 0.08); break;
      case 'squame': {
        const sq = nz(th * 7 + seedA, u * 14);
        c.copy(capCol).lerp(capCol2, (sq > 0.15 && u < 0.92 ? 0.85 : 0) + (u < 0.14 ? 1 : 0));
        c.lerp(capCol2, u < 0.14 ? 1 : 0);
        break;
      }
      case 'zonato': c.copy(Math.sin(u * 26 + n) > 0 ? capCol : capCol2); if (old && n > 0.4) c.lerp(C('#5a7a4a'), 0.5); break;
      case 'pruinoso': c.lerp(C('#e8e6e0'), Math.max(0, nz(th * 12, u * 12)) * 0.4); break;
      case 'fibrillato': if (nz(th * 26 + seedA, u * 1.5) > 0.2) c.multiplyScalar(0.82); c.lerp(capCol2, u < 0.3 ? 0.6 : 0); break;
      case 'perle': if (nz(th * 18, u * 18) > 0.35) c.lerp(C('#fbf8ee'), 0.6); else c.multiplyScalar(0.92); break;
      case 'alveoli': break;
      default: c.multiplyScalar(0.95 + n * 0.05);
    }
    if (m.cap.striato && u > 0.86 && Math.sin(th * 70) > 0.3) c.multiplyScalar(0.8);
    if (sp.id === 'colombina') c.lerp(C('#6a8a5a'), Math.max(0, nz(th * 2 + 5, u * 2)) * 0.8);
    if (eaten && biteFn(th, u) < 0.97) c.lerp(C('#f2ead2'), 0.6);
    ageColor(c, stage);
  };
  const underColor = (c, th, p) => {
    c.copy(underCol);
    const v = p.v ?? 0;
    switch (m.under.type) {
      case 'pori': c.multiplyScalar(0.9 + Math.abs(nz(th * 40, v * 30)) * 0.15); break;
      case 'lamelle': c.multiplyScalar(p.gill ? 0.78 : 1.0); break;
      case 'pieghe': c.multiplyScalar(p.gill ? 0.8 : 1.0); break;
      case 'aculei': c.multiplyScalar(0.92); break;
      default: c.multiplyScalar(0.95);
    }
    ageColor(c, stage);
  };

  let capGeo;
  const GILLS = m.under.type === 'lamelle' ? 96 : m.under.type === 'pieghe' ? 48 : 64;
  if (shape === 'alveolato') {
    const H = R * m.cap.h * (young ? 0.8 : 1);
    const prof = [];
    const N = 20;
    for (let k = 0; k <= N; k++) {
      const u = k / N; // 0 = punta, 1 = base
      const r = R * Math.pow(Math.sin(Math.PI * (0.06 + u * 0.6)), 0.7) * (u > 0.95 ? 0.92 : 1);
      prof.push({ r: k === 0 ? 0 : r, y: stemTopY + H * (1 - u) - 0.005, u, part: 'top' });
    }
    capGeo = lathe(prof, 56, (c, th, p) => {
      const pit = pitMask(th, p.u, seedA);
      c.copy(capCol).lerp(capCol2, pit * 0.9);
      ageColor(c, stage);
    }, { disp: (i, j, th, p) => ({ dr: -pitMask(th, p.u, seedA) * R * 0.18 * (j === 0 ? 0 : 1) }) });
  } else if (shape === 'trombetta') {
    const H = R * m.cap.h * (young ? 0.75 : 1);
    const prof = [];
    const N = 12;
    for (let k = 0; k <= N; k++) { const u = k / N; prof.push({ r: R * 0.1 + R * 0.78 * u ** 2, y: H * (0.25 + 0.72 * u), u: 1 - u, part: 'inner' }); }
    for (let k = 0; k <= N; k++) { const u = 1 - k / N; prof.push({ r: R * 0.18 + R * 0.82 * u ** 1.8, y: H * u, u, part: 'outer' }); }
    capGeo = lathe(prof, 30, (c, th, p) => {
      c.copy(p.part === 'inner' ? capCol : underCol).multiplyScalar(0.85 + nz(th * 4, p.u * 6) * 0.2);
      ageColor(c, stage);
    }, { disp: (i, j, th, p) => { const w = (p.part === 'inner' ? 1 - p.u : p.u) ** 3; return { dy: Math.sin(th * 5 + seedA) * R * 0.25 * w, dr: nz(th * 3, seedA) * R * 0.12 * w }; } });
  } else if (shape === 'pera') {
    const H = R * m.cap.h;
    const prof = [];
    const N = 18;
    for (let k = 0; k <= N; k++) {
      const u = k / N; // dalla sommità alla base
      const r = R * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6 * (u > 0.55 ? 1 - (u - 0.55) * 1.2 : 1);
      prof.push({ r: k === 0 ? 0 : Math.max(R * 0.35, r) * (k === 0 ? 0 : 1), y: H * (1 - u), u, part: 'top' });
    }
    prof[0].r = 0;
    capGeo = lathe(prof, 44, capColorFn, { disp: (i, j, th, p) => ({ dr: Math.max(0, nz(th * 18, p.u * 18) - 0.35) * R * 0.12 }) });
  } else {
    // cappelli "a ombrello": profilo superiore + superficie inferiore
    let phiMax, Hr = m.cap.h;
    if (shape === 'convesso') phiMax = young ? 2.05 : old ? 1.35 : 1.6;
    else if (shape === 'piatto') phiMax = young ? 1.85 : old ? 1.2 : 1.42;
    else if (shape === 'imbuto') phiMax = 1.3;
    else if (shape === 'parasole') { phiMax = young ? 2.3 : 1.5; Hr = young ? 0.9 : m.cap.h; }
    else if (shape === 'mensola') phiMax = 1.4;
    else phiMax = 1.57;
    const H = R * Hr * (young ? 1.35 : old ? 0.8 : 1);
    const top = [];
    const N = 18;
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      const phi = u * phiMax;
      let r = R * Math.sin(Math.min(phi, Math.PI * 0.62)) / Math.sin(Math.min(phiMax, Math.PI * 0.62));
      let y = H * Math.cos(phi);
      if (phiMax > 1.6) r = R * Math.sin(phi) / Math.max(Math.sin(phi), 1) * (phi > 1.57 ? 1 - (phi - 1.57) * 0.45 : 1);
      if (shape === 'piatto') y -= H * 0.35 * Math.exp(-((u / 0.35) ** 2)) * (young ? 0.3 : 1);
      if (shape === 'imbuto') { r = R * u; y = H * (0.2 + 0.9 * u ** 1.6) - H * 0.25; }
      if (shape === 'parasole' && !young) { y = H * 0.35 * (1 - u ** 1.2) + H * 0.55 * Math.exp(-((u / 0.18) ** 2)); }
      if (old && shape !== 'imbuto') y += H * 0.25 * u ** 3; // bordi rialzati
      top.push({ r, y, u, part: 'top' });
    }
    const rimY = top[N].y;
    const under = [];
    const M = 10;
    const decurrent = m.under.type === 'pieghe' || shape === 'imbuto';
    const innerR = Math.max(stemR * (m.stem.shape === 'conico' ? 1.4 : 1.05), R * 0.06);
    for (let k = 1; k <= M; k++) {
      const v = k / M; // 0 = bordo, 1 = gambo
      const r = top[N].r * (1 - v) + innerR * v - R * 0.02 * (1 - v);
      let y = rimY - R * 0.03 + (decurrent ? -H * 0.55 * v ** 1.5 : (young ? -R * 0.05 * v : R * 0.04 * Math.sin(v * Math.PI)));
      if (shape === 'mensola') y = rimY - R * 0.05 - v * H * 0.4;
      under.push({ r, y, v, part: 'under' });
    }
    const prof = top.concat(under);
    const capBaseY = decurrent ? -under[M - 1].y : -Math.min(...under.map((p) => p.y)) + 0.0;
    const isGillType = m.under.type === 'lamelle' || m.under.type === 'pieghe';
    const segs = shape === 'mensola' ? 36 : GILLS;
    capGeo = lathe(prof, segs, (c, th, p, i) => { p.gill = isGillType && p.part === 'under' && i % 2 === 1; capColorFn(c, th, p); }, {
      theta0: shape === 'mensola' ? -Math.PI * 0.55 : 0,
      thetaLen: shape === 'mensola' ? Math.PI * 1.1 : Math.PI * 2,
      disp: (i, j, th, p) => {
        let dr = 0, dy = 0;
        const bite = biteFn(th, p.u ?? 1);
        if (p.part === 'top') {
          dr = p.r * (bite - 1);
          const wav = shape === 'imbuto' ? 0.12 : shape === 'mensola' ? 0.08 : m.cap.texture === 'vellutato' || shape === 'piatto' ? 0.05 : 0.025;
          dy += Math.sin(th * (3 + variant) + seedA) * R * wav * (p.u ** 2);
          dr += nz(th * 2 + seedA, 1) * R * 0.06 * p.u;
          if (shape === 'mensola') dr *= 1, dr += -p.r * (1 - Math.cos(th)) * 0.35;
        } else {
          dr = (p.r) * (bite - 1) * (1 - p.v);
          if (isGillType && i % 2 === 1 && p.v > 0.05 && p.v < 0.97) dy -= R * (m.under.type === 'pieghe' ? 0.05 : 0.07) * Math.sin(p.v * Math.PI) ** 0.5;
          dy += Math.sin(th * (3 + variant) + seedA) * R * (shape === 'imbuto' ? 0.12 : 0.025) * (1 - p.v) ** 2;
          dr += nz(th * 2 + seedA, 1) * R * 0.06 * (1 - p.v);
          if (shape === 'mensola') dr += -p.r * (1 - Math.cos(th)) * 0.35;
        }
        return { dr, dy };
      },
    });
    capGeo.translate(0, stemTopY + (decurrent ? capBaseY * 0.55 : capBaseY * 0.6), 0);
    if (shape === 'mensola') { capGeo.rotateZ(-0.12); capGeo.translate(-R * 0.08, -stemTopY * 0.5, 0); }
    // aculei sotto il cappello
    if (m.under.type === 'aculei') {
      const spikes = [];
      const yU = stemTopY + capBaseY * 0.6 + rimY - R * 0.02;
      for (let k = 0; k < 90; k++) {
        const a = rand() * Math.PI * 2, rr = innerR + (R * 0.92 - innerR) * Math.sqrt(rand());
        const len = R * (0.08 + rand() * 0.06);
        const sg = new THREE.ConeGeometry(R * 0.018, len, 4);
        sg.rotateX(Math.PI);
        sg.translate(Math.cos(a) * rr, yU - len / 2 + R * 0.04 * Math.sin((1 - (rr - innerR) / (R - innerR)) * Math.PI), Math.sin(a) * rr);
        spikes.push(colored(sg, m.under.color, 0.15, k));
      }
      parts.push(mergeGeometries(spikes));
    }
    // verruche (amanite)
    if (m.cap.spots) {
      const nSpots = flags.washed ? 6 : 30;
      const warts = [];
      for (let k = 0; k < nSpots; k++) {
        const u = Math.sqrt(rand()) * 0.88, th = rand() * Math.PI * 2;
        const idx = Math.min(N, Math.round(u * N));
        const p = top[idx];
        const s = R * (0.05 + rand() * 0.05) * (young ? 1.4 : 1);
        const wg = new THREE.IcosahedronGeometry(s, 0);
        wg.scale(1, 0.55, 1);
        const capY = stemTopY + capBaseY * 0.6;
        const rr = p.r * biteFn(th, u) + nz(th * 2 + seedA, 1) * R * 0.06 * u;
        wg.translate(Math.cos(th) * rr, capY + p.y + Math.sin(th * (3 + variant) + seedA) * R * 0.025 * u * u + s * 0.25, Math.sin(th) * rr);
        warts.push(colored(wg, m.cap.spots, 0.1, k));
      }
      parts.push(mergeGeometries(warts));
    }
  }
  if (capGeo) parts.push(capGeo);

  // lumache
  if (flags.slugs) {
    const s = new THREE.SphereGeometry(1, 8, 6);
    s.scale(R * 0.12, R * 0.08, R * 0.36);
    const bb = new THREE.Box3().setFromBufferAttribute(capGeo.attributes.position);
    s.rotateY(rand() * 6.28);
    s.translate(R * 0.25, bb.max.y + R * 0.02, 0);
    parts.push(colored(s, '#8a5a2a', 0.1, 3));
  }

  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (p.attributes.uv) p.deleteAttribute('uv');
    if (!p.attributes.normal) p.computeVertexNormals();
  }
  const merged = mergeGeometries(parts);
  return merged;
}

function pitMask(th, u, seedA) {
  const a = th * 7 / Math.PI + Math.floor(u * 9) * 0.5;
  const b = u * 9;
  const fa = a - Math.floor(a), fb = b - Math.floor(b);
  const edge = Math.min(Math.min(fa, 1 - fa) * 2.2, Math.min(fb, 1 - fb) * 2) + nz(th * 3 + seedA, u * 6) * 0.15;
  return smoothstep(0.12, 0.45, edge) * (u > 0.05 && u < 0.97 ? 1 : 0);
}

let sharedMat = null;
export function mushroomMaterial() {
  if (!sharedMat) {
    // velluto leggero (sheen) e superficie che diventa lucida con la pioggia
    sharedMat = patchMaterial(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.58, metalness: 0, side: THREE.DoubleSide,
      sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color('#fff4e0'),
    }), { wet: 0.7, snow: false });
  }
  return sharedMat;
}

export function clearMushroomCache() { cache.forEach((g) => g.dispose()); cache.clear(); }

// Altezza approssimativa del modello (per la telecamera di ispezione)
export function modelHeight(geo) { geo.computeBoundingBox(); return geo.boundingBox.max.y; }

export { clamp };
