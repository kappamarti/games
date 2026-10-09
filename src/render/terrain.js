// Mesh del terreno, torrente, parcheggio con auto e bacheca.
import * as THREE from 'three';
import { RES, STEP, HALF, BIOMES } from '../world/worldgen.js';
import { createNoise2D, smoothstep, clamp } from '../core/rng.js';
import { groundDetailTexture, normalFromTexture } from './textures.js';
import { patchMaterial } from './envShader.js';
import { dayOfYear } from '../data/calendar.js';

const C = (h) => new THREE.Color(h);

function seasonalGrass(doy) {
  // verde primaverile -> verde estivo -> giallo/bruno autunnale -> spento invernale
  const spring = C('#6f9a3a'), summer = C('#62852f'), autumn = C('#8f8a45'), winter = C('#7a7350');
  if (doy < 80) return winter.clone().lerp(spring, smoothstep(50, 80, doy));
  if (doy < 172) return spring.clone().lerp(summer, smoothstep(120, 172, doy));
  if (doy < 280) return summer.clone().lerp(autumn, smoothstep(240, 280, doy));
  return autumn.clone().lerp(winter, smoothstep(300, 340, doy));
}

export function buildTerrain(world, day) {
  const V = RES + 1;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(V * V * 3);
  const col = new Float32Array(V * V * 3);
  const uv = new Float32Array(V * V * 2);
  const noise = createNoise2D(world.region.seed + 50);
  const doy = dayOfYear(day);
  const grass = seasonalGrass(doy);
  const base = {
    conifere: C('#5a4128'), faggeta: C('#7e4a22'), misto: C('#654a28'), antica: C('#4a3a22'), prati: grass, alta: C('#6f6a58'),
  };
  const moss = C('#4a5e26'), rock = C('#66645c'), trail = C('#8a7356'), bed = C('#4c4a3e'), gravel = C('#8d8678');
  const tmp = new THREE.Color();
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const idx = j * V + i;
    const x = -HALF + i * STEP, z = -HALF + j * STEP;
    pos[idx * 3] = x; pos[idx * 3 + 1] = world.heights[idx]; pos[idx * 3 + 2] = z;
    uv[idx * 2] = i / RES; uv[idx * 2 + 1] = j / RES;
    const b = BIOMES[world.biome[idx]];
    tmp.copy(base[b]);
    const n = noise(x / 9, z / 9), n2 = noise(x / 2.5 + 40, z / 2.5);
    if (b === 'conifere' || b === 'antica') tmp.lerp(moss, smoothstep(0.1, 0.6, n) * 0.75);
    if (b === 'misto') tmp.lerp(grass, smoothstep(0.2, 0.7, n) * 0.5);
    if (b === 'faggeta') tmp.lerp(C('#9a6230'), smoothstep(-0.2, 0.6, n2) * 0.4);
    if (b === 'alta') tmp.lerp(grass, smoothstep(-0.3, 0.4, n) * 0.6);
    if (b === 'prati') tmp.lerp(C('#8a9a48'), smoothstep(0.3, 0.8, n2) * 0.35);
    // pendenza -> roccia
    const sl = world.slopeAt(x, z);
    tmp.lerp(rock, smoothstep(0.55, 1.0, sl) * 0.8);
    // sentieri e torrente
    const td = world.trailDist[idx];
    tmp.lerp(trail, (1 - smoothstep(0.8, 2.4, td)) * 0.9);
    const sd = world.streamDist[idx];
    tmp.lerp(bed, 1 - smoothstep(1.5, 3.8, sd));
    const pd = Math.hypot(x - world.parking.x, z - world.parking.z);
    tmp.lerp(gravel, 1 - smoothstep(10, 14, pd));
    const v = 0.88 + n2 * 0.12;
    col[idx * 3] = tmp.r * v; col[idx * 3 + 1] = tmp.g * v; col[idx * 3 + 2] = tmp.b * v;
  }
  const index = [];
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const a = j * V + i, b = (j + 1) * V + i, c = (j + 1) * V + i + 1, d = j * V + i + 1;
    // triangoli (a,b,d) e (b,c,d): coerenti con heightAt()
    index.push(a, b, d, b, c, d);
  }
  geo.setIndex(index);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const detail = groundDetailTexture();
  detail.repeat.set(RES / 1.6, RES / 1.6);
  const detailN = normalFromTexture(detail, 3.5);
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, normalMap: detailN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, metalness: 0, envMapIntensity: 0.45 }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildStream(world) {
  const pts = world.stream;
  const positions = [], indices = [], uvs = [];
  const W = 1.5;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k], q = pts[Math.min(k + 1, pts.length - 1)], o = pts[Math.max(k - 1, 0)];
    let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const px = -dz, pz = dx;
    const y = world.heightAt(p.x, p.z) + 0.32;
    positions.push(p.x + px * W, y, p.z + pz * W, p.x - px * W, y, p.z - pz * W);
    uvs.push(0, k * 0.3, 1, k * 0.3);
    if (k < pts.length - 1) { const a = k * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#2a3c3a', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.78 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv2;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv2 = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vUv2;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rip = sin(vUv2.y * 18.0 - uTime * 4.0 + sin(vUv2.x * 9.0) * 1.5) * 0.5 + 0.5;
        diffuseColor.rgb += vec3(0.05, 0.07, 0.07) * rip * rip;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'stream';
  return mesh;
}

// Parcheggio: auto (punto di rientro) + bacheca in legno
export function buildParking(world) {
  const g = new THREE.Group();
  const { x, z } = world.parking;
  const y = world.heightAt(x, z);
  const body = new THREE.MeshStandardMaterial({ color: '#2f5a6e', roughness: 0.35, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#7f97a6', roughness: 0.05, metalness: 0.8 });
  const car = new THREE.Group();
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.2), body); b1.position.y = 0.65;
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.3), glass); b2.position.set(0, 1.25, -0.2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.06, 2.0), body); roof.position.set(0, 1.54, -0.25);
  car.add(b1, b2, roof);
  for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 16), dark);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.34, wz); car.add(w);
  }
  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  car.position.set(x + 3, y, z + 2); car.rotation.y = 0.4;
  car.name = 'car';
  g.add(car);
  // bacheca
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.9 });
  const board = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), wood); p1.position.set(-0.9, 1.1, 0);
  const p2 = p1.clone(); p2.position.x = 0.9;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 0.06), new THREE.MeshStandardMaterial({ color: '#d8c9a2', roughness: 0.95 }));
  panel.position.y = 1.55;
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.5), wood); top.position.y = 2.2; top.rotation.x = 0.15;
  board.add(p1, p2, panel, top);
  board.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  board.position.set(x - 4, world.heightAt(x - 4, z - 3), z - 3); board.rotation.y = 0.2;
  g.add(board);
  g.userData.carPos = new THREE.Vector3(x + 3, y, z + 2);
  return g;
}

export function terrainClamp(v) { return clamp(v, -HALF + 1, HALF - 1); }
