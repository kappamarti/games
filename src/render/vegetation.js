// Alberi, legno morto, rocce, felci e cespugli istanziati a blocchi (per il frustum culling).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, createNoise2D, smoothstep } from '../core/rng.js';
import { HALF } from '../world/worldgen.js';
import { barkTexture, fernTexture, mossTexture, foliageAtlas, normalFromTexture } from './textures.js';
import { patchMaterial } from './envShader.js';
import { dayOfYear } from '../data/calendar.js';

const CHUNK = 50;
const LOD_NEAR = 80, SHADOW_NEAR = 65;
const noise3 = createNoise2D(777);

// --- utilità geometriche ---------------------------------------------------
function prep(geo, colorFn) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(p.getX(i), p.getY(i), p.getZ(i), col);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function displace(geo, amp, freq, seed) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = noise3(v.x * freq + seed, v.z * freq + v.y * freq * 0.7 - seed);
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amp) / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function blob(r, detail, amp, seed, sx = 1, sy = 1, sz = 1) {
  const g = displace(new THREE.IcosahedronGeometry(r, detail), amp * r, 1.3 / r, seed);
  g.scale(sx, sy, sz);
  return g;
}

function grey(v) { return (x, y, z, c) => c.setRGB(v, v, v); }

// colore AO verticale per chiome: più scuro in basso/all'interno
function aoFoliage(y0, y1, inner) {
  return (x, y, z, c) => {
    const t = smoothstep(y0, y1, y);
    const radial = inner ? Math.min(1, Math.hypot(x, z) / inner) : 1;
    const v = 0.68 + 0.32 * t + 0.1 * radial + noise3(x * 2.1, y * 2.3 + z) * 0.06;
    c.setRGB(v, v, v);
  };
}

function trunkGeo(h, r0, r1, bend = 0, seg = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 4, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 0.35) * bend * (y / h));
    // radici svasate alla base
    const flare = 1 + 0.6 * Math.exp(-y * 2.2);
    p.setX(i, p.getX(i) * flare); p.setZ(i, p.getZ(i) * flare);
  }
  g.computeVertexNormals();
  // uv verticali per la corteccia
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * h * 0.4);
  return g;
}

function coneTiers(tiers, yStart, yEnd, rMax, rMin, seg, seed, droop = 0.6) {
  const parts = [];
  const rand = mulberry32(seed);
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = yStart + (yEnd - yStart) * t;
    const r = rMax + (rMin - rMax) * t;
    const h = (yEnd - yStart) / tiers * 2.3;
    const g = new THREE.ConeGeometry(r, h, seg, 2, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      if (vy < -h / 2 + 0.01) { // anello inferiore frastagliato e cadente
        const s = 0.8 + rand() * 0.45;
        p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s); p.setY(i, vy - rand() * droop);
      }
    }
    g.rotateY(rand() * 6.28);
    g.translate(0, y + h / 2, 0);
    g.computeVertexNormals();
    parts.push(g);
  }
  return parts;
}

// --- definizione dei tipi di albero -----------------------------------------
const BARK = {
  abete: '#5a4535', pino: '#7a5236', larice: '#6a4a36', faggio: '#7e7b74', castagno: '#5c4632', quercia: '#5a4a3a', betulla: '#e4e0d6',
};

const SOLID_UV = [0.25, 0.05];

// volume interno morbido (normali levigate), mappato sulla fascia opaca dell'atlante
function smoothBlob(r, amp, seed, sx = 1, sy = 1, sz = 1) {
  let g = new THREE.IcosahedronGeometry(r, 1);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  displace(g, amp * r, 1.3 / r, seed);
  g.scale(sx, sy, sz);
  g.computeVertexNormals();
  g = g.toNonIndexed();
  const uv = new Float32Array(g.attributes.position.count * 2);
  for (let i = 0; i < uv.length; i += 2) { uv[i] = SOLID_UV[0]; uv[i + 1] = SOLID_UV[1]; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// carta di fogliame orientata, con normali "sferiche" rispetto al centro della chioma
function card(pos, normal, w, h, roll, region, center, aoFn) {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const uv = g.attributes.uv;
  const u0 = region === 'leaf' ? 0 : 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, 0.125 + uv.getY(i) * 0.875);
  g.rotateZ(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  g.applyQuaternion(q);
  g.translate(pos.x, pos.y, pos.z);
  const n = pos.clone().sub(center); n.y += 0.35 * n.length(); n.normalize();
  const nor = g.attributes.normal;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, n.x, n.y, n.z);
  return prep(g, aoFn);
}

function crownCards(blobs, cardsPer, cardSize, rand, aoFn, seed, region = 'leaf') {
  const parts = [];
  const center = new THREE.Vector3();
  blobs.forEach((b) => center.add(b.c)); center.multiplyScalar(1 / blobs.length);
  for (const b of blobs) {
    for (let k = 0; k < Math.round(cardsPer * 1.35); k++) {
      const n = new THREE.Vector3(rand() * 2 - 1, rand() * 1.6 - 0.5, rand() * 2 - 1).normalize();
      const p = new THREE.Vector3(n.x * b.r * b.sx, n.y * b.r * b.sy, n.z * b.r * b.sz).multiplyScalar(0.55 + rand() * 0.5).add(b.c);
      const tilt = new THREE.Vector3(n.x + (rand() - 0.5) * 0.9, n.y + (rand() - 0.5) * 0.9, n.z + (rand() - 0.5) * 0.9).normalize();
      const s = cardSize * (0.75 + rand() * 0.5);
      parts.push(card(p, tilt, s, s, rand() * 6.28, region, center, aoFn));
    }
  }
  return parts;
}

function coniferCrown(tiers, yStart, yEnd, rMax, rMin, branchesPer, seed, droop, aoFn) {
  const rand = mulberry32(seed);
  // nucleo sottile e scuro (si intravede solo tra i rami)
  const parts = coneTiers(Math.max(3, Math.round(tiers / 2)), yStart + 1, yEnd, rMax * 0.22, rMin * 0.3, 6, seed, 0).map((g) => {
    const p = prep(g, (x, y, z, c) => { aoFn(x, y, z, c); c.multiplyScalar(0.3); });
    const uv = p.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, SOLID_UV[0], SOLID_UV[1]);
    return p;
  });
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = yStart + (yEnd - yStart) * t;
    const r = rMax + (rMin - rMax) * t;
    const nb = Math.max(5, Math.round(branchesPer * 1.4 * (1 - t * 0.5)));
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rand() * 0.5 + k;
      const len = r * (1.05 + rand() * 0.3);
      const g = new THREE.PlaneGeometry(len, len * 0.62).toNonIndexed();
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getX(i) * 0.5, 0.125 + uv.getY(i) * 0.875);
      g.translate(len / 2, 0, 0);
      const layer = b % 2; // metà rami quasi orizzontali, metà più inclinati (visibili di lato)
      g.rotateX(-Math.PI / 2 + (rand() - 0.5) * 0.6 + (layer ? (rand() < 0.5 ? 0.9 : -0.9) : 0));
      g.rotateZ(-droop * 0.5 - rand() * 0.25);        // cadente verso l'esterno
      g.rotateY(-a);
      g.translate(0, y + 0.5, 0);
      const n = new THREE.Vector3(Math.cos(a), 0.9, Math.sin(a)).normalize();
      const nor = g.attributes.normal;
      for (let i = 0; i < nor.count; i++) nor.setXYZ(i, n.x, n.y, n.z);
      parts.push(prep(g, aoFn));
    }
  }
  return parts;
}

function buildTreeType(type, detail = 1) {
  const s = type.length * 13;
  const D = (n) => Math.max(3, Math.round(n * detail));
  const CS = detail < 1 ? 1.45 : 1;
  const rand = mulberry32(s);
  let trunk, parts;
  switch (type) {
    case 'abete':
      trunk = trunkGeo(19, 0.32, 0.05);
      parts = coniferCrown(detail < 1 ? 7 : 10, 2.2, 18.6, 3.4, 0.5, D(10), s, 0.7, aoFoliage(2, 20, 2.5));
      break;
    case 'larice':
      trunk = trunkGeo(18, 0.3, 0.05);
      parts = coniferCrown(detail < 1 ? 6 : 10, 3, 17.5, 2.8, 0.4, D(10), s, 0.9, aoFoliage(3, 18, 2));
      break;
    case 'pino': {
      trunk = trunkGeo(15, 0.28, 0.12, 0.6);
      const blobs = [];
      for (let k = 0; k < 5; k++) blobs.push({ c: new THREE.Vector3((rand() - 0.5) * 3, 11.5 + rand() * 4, (rand() - 0.5) * 3), r: 1.9 + rand() * 0.8, sx: 1.3, sy: 0.7, sz: 1.3 });
      parts = crownCards(blobs, D(10), 2.1 * CS, rand, aoFoliage(9, 17, 0), s, 'needle');
      break;
    }
    case 'faggio': case 'castagno': case 'quercia': {
      const cfg = {
        faggio: { h: 10, r0: 0.38, r1: 0.18, crownY: 12.5, spread: 3.6, n: 7, rb: 2.9, bend: 0.25 },
        castagno: { h: 6.5, r0: 0.5, r1: 0.25, crownY: 9.5, spread: 4.2, n: 7, rb: 3.1, bend: 0.5 },
        quercia: { h: 6, r0: 0.48, r1: 0.22, crownY: 9.2, spread: 4.4, n: 8, rb: 2.9, bend: 0.9 },
      }[type];
      const branches = [trunkGeo(cfg.h, cfg.r0, cfg.r1, cfg.bend)];
      for (let k = 0; k < 4; k++) { // rami principali
        const b = trunkGeo(4.5, cfg.r1, 0.06, 0.2, 5);
        b.rotateZ(0.6 + rand() * 0.3); b.rotateY(k * 1.57 + rand());
        b.translate(0, cfg.h - 0.5, 0);
        branches.push(b);
      }
      trunk = mergeGeometries(branches.map((g) => (g.index ? g.toNonIndexed() : g)));
      const blobs = [];
      for (let k = 0; k < cfg.n; k++) {
        const a = (k / cfg.n) * Math.PI * 2 + rand();
        const rr = k === 0 ? 0 : cfg.spread * (0.55 + rand() * 0.45);
        blobs.push({ c: new THREE.Vector3(Math.cos(a) * rr, cfg.crownY + (rand() - 0.3) * 2.6 - rr * 0.25, Math.sin(a) * rr), r: cfg.rb * (0.75 + rand() * 0.4), sx: 1, sy: 0.78, sz: 1 });
      }
      parts = crownCards(blobs, D(15), 3.0 * CS, rand, aoFoliage(cfg.crownY - 3.5, cfg.crownY + 3, 0), s);
      break;
    }
    case 'betulla': {
      trunk = trunkGeo(13, 0.17, 0.05, 0.4, 6);
      const blobs = [];
      for (let k = 0; k < 5; k++) blobs.push({ c: new THREE.Vector3((rand() - 0.5) * 2.2, 8 + k * 1.2 + rand(), (rand() - 0.5) * 2.2), r: 1.4 + rand() * 0.6, sx: 0.9, sy: 1.25, sz: 0.9 });
      parts = crownCards(blobs, D(13), 1.8 * CS, rand, aoFoliage(6, 14, 0), s);
      break;
    }
  }
  // colori corteccia (con macchie scure per la betulla)
  const bark = new THREE.Color(BARK[type]);
  trunk = prep(trunk.index ? trunk.toNonIndexed() : trunk, (x, y, z, c) => {
    c.copy(bark);
    if (type === 'betulla') {
      const n = noise3(y * 3.5, Math.atan2(z, x) * 2);
      if (n > 0.45 || y < 0.6) c.setRGB(0.12, 0.11, 0.1);
    } else {
      c.multiplyScalar(0.85 + noise3(y * 0.8, x * 3) * 0.15);
    }
    // muschio alla base
    if (y < 1.2 && type !== 'betulla') c.lerp(new THREE.Color('#4a5a24'), (1 - y / 1.2) * 0.6);
  });
  return { trunk, foliage: mergeGeometries(parts) };
}

export function foliageTint(type, doy) {
  const c = (h) => new THREE.Color(h);
  const lerpC = (a, b, t) => c(a).lerp(c(b), Math.min(1, Math.max(0, t)));
  const bare = (doy > 318 || doy < 108);
  switch (type) {
    case 'abete': return { color: c('#2a4626'), scale: 1 };
    case 'pino': return { color: c('#3a5628'), scale: 1 };
    case 'larice':
      if (bare) return { color: c('#6a5a48'), scale: 0.7 };
      if (doy > 278) return { color: lerpC('#c9a02e', '#c0702a', (doy - 290) / 25), scale: 1 };
      return { color: lerpC('#8aaa48', '#5d7d32', (doy - 110) / 60), scale: 1 };
    case 'faggio':
      if (bare) return { color: c('#6e5a48'), scale: 0.72 };
      if (doy > 272) return { color: lerpC('#8a8a30', '#b0601e', (doy - 272) / 30), scale: 1 - Math.max(0, doy - 305) / 40 };
      return { color: lerpC('#86b048', '#4c7629', (doy - 110) / 50), scale: 1 };
    case 'castagno':
      if (bare) return { color: c('#6a5844'), scale: 0.72 };
      if (doy > 280) return { color: lerpC('#8a8a2a', '#b08a2a', (doy - 280) / 25), scale: 1 };
      return { color: lerpC('#78a040', '#4a6c28', (doy - 110) / 50), scale: 1 };
    case 'quercia':
      if (bare) return { color: c('#7a5a3a'), scale: 0.8 };
      if (doy > 285) return { color: lerpC('#7a7a30', '#9a6a30', (doy - 285) / 25), scale: 1 };
      return { color: lerpC('#6e9a3c', '#44662a', (doy - 110) / 50), scale: 1 };
    case 'betulla':
      if (bare) return { color: c('#7a6a5a'), scale: 0.6 };
      if (doy > 268) return { color: lerpC('#b0b03a', '#e0b830', (doy - 268) / 20), scale: 1 - Math.max(0, doy - 300) / 30 };
      return { color: lerpC('#9ac050', '#6a9a38', (doy - 110) / 50), scale: 1 };
  }
  return { color: c('#4a6a2a'), scale: 1 };
}

// --- costruzione della vegetazione ------------------------------------------
export function buildVegetation(world, day) {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const doy = dayOfYear(day);
  const bark = barkTexture();
  bark.repeat.set(2, 1);
  const barkN = normalFromTexture(bark, 4);
  const trunkMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: bark, normalMap: barkN, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 }), { sway: 0.0 });
  const foliageMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: foliageAtlas(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 }), { sway: 0.012, swayStart: 3, wet: 0.5 });

  const typeGeo = {};
  const chunkMeshes = [];
  const byKey = new Map();
  for (const t of world.trees) {
    const ci = Math.floor((t.x + HALF) / CHUNK), cj = Math.floor((t.z + HALF) / CHUNK);
    const key = `${t.type}|${ci}|${cj}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const rand = mulberry32(world.region.seed + 5);
  for (const [key, list] of byKey) {
    const type = key.split('|')[0];
    if (!typeGeo[type]) typeGeo[type] = { ...buildTreeType(type, 1), low: buildTreeType(type, 0.3).foliage };
    const tint = foliageTint(type, doy);
    const tm = new THREE.InstancedMesh(typeGeo[type].trunk, trunkMat, list.length);
    const fm = new THREE.InstancedMesh(typeGeo[type].foliage, foliageMat, list.length);
    const col = new THREE.Color();
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      sc.setScalar(t.scale);
      ps.set(t.x, t.y - 0.15, t.z);
      m4.compose(ps, q, sc);
      tm.setMatrixAt(i, m4);
      const fs = tint.scale;
      const s2 = sc.clone().multiply(new THREE.Vector3(fs, 0.85 + 0.15 * fs, fs));
      m4.compose(ps, q, s2);
      fm.setMatrixAt(i, m4);
      const v = 0.85 + rand() * 0.3;
      col.copy(tint.color).multiplyScalar(v);
      col.offsetHSL((rand() - 0.5) * 0.03, 0, 0);
      fm.setColorAt(i, col);
    });
    for (const m of [tm, fm]) {
      m.castShadow = true; m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      m.userData.chunkCenter = new THREE.Vector3((parseInt(key.split('|')[1]) + 0.5) * CHUNK - HALF, 0, (parseInt(key.split('|')[2]) + 0.5) * CHUNK - HALF);
      if (m === fm) { m.userData.geoFull = typeGeo[type].foliage; m.userData.geoLow = typeGeo[type].low; }
      group.add(m);
      chunkMeshes.push(m);
    }
  }

  // --- legno morto
  const moss = mossTexture();
  const mossN = normalFromTexture(moss, 5);
  const woodMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: moss, normalMap: mossN, roughness: 0.95 }));
  const logGeo = prep(new THREE.CylinderGeometry(1, 1, 1, 9, 3, false).rotateZ(Math.PI / 2), (x, y, z, c) => {
    c.set('#5a4430');
    if (y > 0.3) c.lerp(new THREE.Color('#4f6a26'), 0.7); // muschio sopra
    c.multiplyScalar(0.85 + noise3(x * 4, z * 4) * 0.15);
  });
  const logs = new THREE.InstancedMesh(logGeo, woodMat, Math.max(1, world.logs.length));
  world.logs.forEach((l, i) => {
    q.setFromAxisAngle(up, -l.rot);
    m4.compose(ps.set(l.x, l.y + l.r * 0.6, l.z), q, sc.set(l.len, l.r, l.r));
    logs.setMatrixAt(i, m4);
  });
  logs.count = world.logs.length;
  const stumpGeo = prep(trunkGeo(1, 1, 0.92, 0, 9), (x, y, z, c) => {
    c.set(y > 0.97 ? '#a08060' : '#5a4430');
    if (y < 0.97) c.lerp(new THREE.Color('#4a6024'), (1 - y) * 0.55);
  });
  const stumps = new THREE.InstancedMesh(stumpGeo, woodMat, Math.max(1, world.stumps.length));
  world.stumps.forEach((s, i) => {
    m4.compose(ps.set(s.x, s.y - 0.05, s.z), q.identity(), sc.set(s.r, s.h, s.r));
    stumps.setMatrixAt(i, m4);
  });
  stumps.count = world.stumps.length;

  // --- rocce
  const rockGeo = prep(blob(1, 2, 0.35, 4.2), (x, y, z, c) => {
    const v = 0.42 + noise3(x * 3, z * 3 + y) * 0.06;
    c.setRGB(v, v * 0.98, v * 0.93);
    if (y > 0.4) c.lerp(new THREE.Color('#556a2e'), 0.35 * smoothstep(0.4, 0.9, y));
  });
  const rockMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: moss, normalMap: mossN, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.88 }));
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, world.rocks.length));
  world.rocks.forEach((r, i) => {
    q.setFromAxisAngle(up, r.rot);
    m4.compose(ps.set(r.x, r.y - r.s * 0.25, r.z), q, sc.set(r.s, r.s * r.sq, r.s * (0.8 + r.sq * 0.3)));
    rocks.setMatrixAt(i, m4);
  });
  rocks.count = world.rocks.length;

  // --- felci (piani incrociati con alfa)
  const fernTex = fernTexture();
  const fernParts = [];
  for (let k = 0; k < 6; k++) {
    const g = new THREE.PlaneGeometry(0.45, 1.1, 1, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.55; p.setZ(i, y * y * 0.35); p.setY(i, y * 0.75); }
    g.rotateX(-0.25);
    g.rotateY((k / 6) * Math.PI * 2);
    fernParts.push(prep(g, (x, y, z, c) => { const v = 0.55 + y * 0.6; c.setRGB(v, v, v); }));
  }
  const fernGeo = mergeGeometries(fernParts);
  const fernMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: fernTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }), { sway: 0.08, swayStart: 0.1 });
  const fernVisible = !(doy > 325 || doy < 115);
  const fernColor = doy > 290 ? new THREE.Color('#8a6a2c') : doy > 260 ? new THREE.Color('#6a7a2a') : new THREE.Color('#4f7a2a');
  const ferns = new THREE.InstancedMesh(fernGeo, fernMat, Math.max(1, world.ferns.length));
  const fcol = new THREE.Color();
  world.ferns.forEach((f, i) => {
    q.setFromAxisAngle(up, f.rot);
    m4.compose(ps.set(f.x, f.y - 0.02, f.z), q, sc.setScalar(fernVisible ? f.s : 0.0001));
    ferns.setMatrixAt(i, m4);
    fcol.copy(fernColor).multiplyScalar(0.8 + rand() * 0.4);
    ferns.setColorAt(i, fcol);
  });
  ferns.count = world.ferns.length;

  // --- cespugli
  const bushGeo = mergeGeometries(crownCards([{ c: new THREE.Vector3(0, 0, 0), r: 0.8, sx: 1.2, sy: 0.75, sz: 1.2 }], 12, 0.9, mulberry32(9), aoFoliage(-0.6, 0.7, 0), 9));
  const bushes = new THREE.InstancedMesh(bushGeo, foliageMat, Math.max(1, world.bushes.length));
  world.bushes.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m4.compose(ps.set(b.x, b.y + b.s * 0.25, b.z), q, sc.setScalar(b.s));
    bushes.setMatrixAt(i, m4);
    const base = b.biome === 'alta' ? '#4a5a30' : doy > 285 ? '#7a6a30' : '#3e6024';
    fcol.set(base).multiplyScalar(0.8 + rand() * 0.4);
    bushes.setColorAt(i, fcol);
  });
  bushes.count = world.bushes.length;

  for (const m of [logs, stumps, rocks, ferns, bushes]) {
    m.castShadow = m !== ferns; m.receiveShadow = true;
    m.computeBoundingSphere();
    group.add(m);
  }
  group.userData.chunkMeshes = chunkMeshes;
  return group;
}

// Ombre e dettaglio pieno solo per i blocchi vicini al giocatore
export function updateVegetationLOD(group, playerPos, lodNear = LOD_NEAR) {
  for (const m of group.userData.chunkMeshes) {
    const d = Math.hypot(m.userData.chunkCenter.x - playerPos.x, m.userData.chunkCenter.z - playerPos.z);
    m.castShadow = d < Math.max(SHADOW_NEAR, lodNear * 0.7);
    // livello di dettaglio: chiome ridotte per i blocchi lontani
    if (m.userData.geoFull) {
      const g = d < lodNear ? m.userData.geoFull : m.userData.geoLow;
      if (m.geometry !== g) m.geometry = g;
    }
  }
}

export function trunkRadius(t) {
  const base = { abete: 0.34, pino: 0.3, larice: 0.32, faggio: 0.42, castagno: 0.55, quercia: 0.52, betulla: 0.2 }[t.type] || 0.3;
  return base * t.scale;
}
