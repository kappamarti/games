// Copertura del suolo dinamica attorno al giocatore: foglie secche, aghi, erba.
// Le posizioni sono deterministiche per cella di 1 m, quindi non "saltano" quando si aggiornano.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash3 } from '../core/rng.js';
import { leafTexture, grassTexture, flowerTexture } from './textures.js';
import { patchMaterial } from './envShader.js';
import { dayOfYear } from '../data/calendar.js';

const LEAF_R = 16, GRASS_R = 18;
const LEAF_CAP = 9000, GRASS_CAP = 6000;

const LEAF_PALETTE = {
  faggeta: ['#8a4a1e', '#a0602a', '#6e3e1c', '#b07a3a', '#7a4a24'],
  misto: ['#7a5a2a', '#8a7a30', '#5a4a2a', '#a0802e', '#6a5a30'],
  antica: ['#5a4426', '#6a5030', '#4a3a22', '#5a5a2a'],
  conifere: ['#5a3e26', '#6a4a2c', '#4e3622'],
  prati: ['#7a6a3a', '#8a7a40'],
  alta: ['#6a5a40', '#7a6a4a'],
};
const LEAF_DENSITY = { faggeta: 9, misto: 7, antica: 6, conifere: 3, prati: 0.6, alta: 0.6 };
const GRASS_DENSITY = { faggeta: 0.05, misto: 0.6, antica: 0.15, conifere: 0.25, prati: 3.2, alta: 1.6 };

export class GroundCover {
  constructor(world, day, snowDepth) {
    this.world = world;
    this.group = new THREE.Group();
    this.last = new THREE.Vector2(1e9, 1e9);
    const doy = dayOfYear(day);
    this.autumnBoost = doy > 275 && doy < 320 ? 1.4 : doy > 150 && doy < 240 ? 0.7 : 1;
    this.snowHide = snowDepth > 6;
    this.grassColor = new THREE.Color(doy > 290 || doy < 80 ? '#8a8656' : doy > 250 ? '#6b7f3c' : '#5a7a34');

    const leafGeo = new THREE.PlaneGeometry(0.14, 0.14);
    leafGeo.rotateX(-Math.PI / 2);
    const leafMat = patchMaterial(new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), { wet: 0.8 });
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAF_CAP);
    this.leaves.receiveShadow = true;
    this.leaves.frustumCulled = false;
    this.leaves.count = 0;

    const g1 = new THREE.PlaneGeometry(0.45, 0.3); g1.translate(0, 0.15, 0);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const g3 = g1.clone().rotateY(Math.PI / 4);
    const grassGeo = mergeGeometries([g1, g2, g3]);
    const grassMat = patchMaterial(new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }), { sway: 0.25, swayStart: 0.05, wet: 0.6 });
    this.grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_CAP);
    this.grass.receiveShadow = true;
    this.grass.frustumCulled = false;
    this.grass.count = 0;
    this.group.add(this.leaves, this.grass);

    // dettagli: rametti, sassolini, cuscinetti di muschio, fiori di prato
    const mk = (geo, mat, cap) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false; this.group.add(m); return m; };
    const twigGeo = new THREE.CylinderGeometry(0.006, 0.012, 1, 4).rotateZ(Math.PI / 2);
    this.twigs = mk(twigGeo, patchMaterial(new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 0.95 }), { wet: 0.9 }), 3000);
    const pebGeo = new THREE.IcosahedronGeometry(1, 0);
    this.pebbles = mk(pebGeo, patchMaterial(new THREE.MeshStandardMaterial({ color: '#8a867c', roughness: 0.8, flatShading: true })), 2500);
    this.pebbles.castShadow = true;
    const mossGeo = new THREE.IcosahedronGeometry(1, 1).scale(1, 0.32, 1);
    this.moss = mk(mossGeo, patchMaterial(new THREE.MeshStandardMaterial({ color: '#4c6a26', roughness: 1 })), 1500);
    const fl = new THREE.PlaneGeometry(0.09, 0.09).rotateX(-Math.PI / 2).translate(0, 0.16, 0);
    const stem = new THREE.PlaneGeometry(0.008, 0.16).translate(0, 0.08, 0);
    { const uv = stem.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5); }
    this.flowers = mk(fl, patchMaterial(new THREE.MeshStandardMaterial({ map: flowerTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 }), { sway: 0.5, swayStart: 0.02 }), 2000);
    this.flowerStems = mk(mergeGeometries([stem, stem.clone().rotateY(Math.PI / 2)]), patchMaterial(new THREE.MeshStandardMaterial({ color: '#4f7a2a', side: THREE.DoubleSide, roughness: 0.8 }), { sway: 0.5, swayStart: 0.02 }), 2000);
    this.flowerSeason = doy > 95 && doy < 275;
  }

  update(pos, force = false) {
    if (!force && Math.hypot(pos.x - this.last.x, pos.z - this.last.y) < 3) return;
    this.last.set(pos.x, pos.z);
    const w = this.world;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    let nl = 0, ng = 0, nt = 0, np = 0, nm = 0, nf = 0;
    const cx = Math.floor(pos.x), cz = Math.floor(pos.z);
    const R = Math.max(LEAF_R, GRASS_R);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const gx = cx + dx, gz = cz + dz;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      if (!w.inBounds(gx, gz)) continue;
      const biome = w.biomeAt(gx, gz);
      const trail = w.trailAt(gx, gz), stream = w.streamAt(gx, gz);
      if (stream < 1.6) continue;
      const trailF = trail < 1.2 ? 0.15 : trail < 2.2 ? 0.5 : 1;
      // foglie
      if (!this.snowHide && d2 <= LEAF_R * LEAF_R) {
        const dens = LEAF_DENSITY[biome] * this.autumnBoost * trailF * (d2 > 14 * 14 ? 0.6 : 1);
        const n = Math.floor(dens + hash3(gx, gz, 1, 7));
        const pal = LEAF_PALETTE[biome];
        for (let k = 0; k < n && nl < LEAF_CAP; k++) {
          const x = gx + hash3(gx, gz, k, 11), z = gz + hash3(gx, gz, k, 13);
          const y = w.heightAt(x, z) + 0.012 + k * 0.002;
          e.set((hash3(gx, gz, k, 17) - 0.5) * 0.5, hash3(gx, gz, k, 19) * 6.28, (hash3(gx, gz, k, 23) - 0.5) * 0.5);
          q.setFromEuler(e);
          const sc = biome === 'conifere' ? 0.5 + hash3(gx, gz, k, 29) * 0.4 : 0.7 + hash3(gx, gz, k, 29) * 0.7;
          s.set(sc * (biome === 'conifere' ? 0.5 : 1), 1, sc);
          m4.compose(p.set(x, y, z), q, s);
          this.leaves.setMatrixAt(nl, m4);
          col.set(pal[Math.floor(hash3(gx, gz, k, 31) * pal.length)]).multiplyScalar(0.75 + hash3(gx, gz, k, 37) * 0.45);
          this.leaves.setColorAt(nl, col);
          nl++;
        }
      }
      // dettagli minori (raggio ridotto)
      if (d2 <= 16 * 16 && !this.snowHide) {
        const forest = biome !== 'prati' && biome !== 'alta';
        if (forest && nt < 3000 && hash3(gx, gz, 3, 71) < 0.45 * trailF) {
          const x = gx + hash3(gx, gz, 1, 73), z = gz + hash3(gx, gz, 1, 79);
          q.setFromEuler(e.set((hash3(gx, gz, 1, 83) - 0.5) * 0.2, hash3(gx, gz, 1, 89) * 6.28, 0));
          m4.compose(p.set(x, w.heightAt(x, z) + 0.01, z), q, s.set(0.12 + hash3(gx, gz, 1, 97) * 0.4, 1, 1));
          this.twigs.setMatrixAt(nt++, m4);
        }
        const pebP = trail < 1.6 ? 0.5 : biome === 'alta' ? 0.6 : 0.12;
        if (np < 2500 && hash3(gx, gz, 4, 101) < pebP) {
          const x = gx + hash3(gx, gz, 2, 103), z = gz + hash3(gx, gz, 2, 107);
          const sc = 0.015 + hash3(gx, gz, 2, 109) ** 2 * 0.07;
          q.setFromEuler(e.set(hash3(gx, gz, 2, 113) * 6, hash3(gx, gz, 2, 127) * 6, 0));
          m4.compose(p.set(x, w.heightAt(x, z) + sc * 0.2, z), q, s.set(sc, sc * 0.6, sc * 0.9));
          this.pebbles.setMatrixAt(np++, m4);
          col.setRGB(0.55, 0.53, 0.5).multiplyScalar(0.7 + hash3(gx, gz, 2, 131) * 0.5);
          this.pebbles.setColorAt(np - 1, col);
        }
        if ((biome === 'conifere' || biome === 'antica') && nm < 1500 && hash3(gx, gz, 5, 137) < 0.16 && trail > 2) {
          const x = gx + hash3(gx, gz, 3, 139), z = gz + hash3(gx, gz, 3, 149);
          const sc = 0.12 + hash3(gx, gz, 3, 151) * 0.35;
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash3(gx, gz, 3, 157) * 6.28);
          m4.compose(p.set(x, w.heightAt(x, z) - 0.01, z), q, s.set(sc, sc, sc * 0.8));
          this.moss.setMatrixAt(nm++, m4);
          col.set('#4c6a26').multiplyScalar(0.75 + hash3(gx, gz, 3, 163) * 0.5);
          this.moss.setColorAt(nm - 1, col);
        }
        if (this.flowerSeason && (biome === 'prati' || biome === 'alta' || (trail > 1.2 && trail < 3)) && nf < 2000) {
          const nfl = biome === 'prati' || biome === 'alta' ? Math.floor(hash3(gx, gz, 6, 167) * 2.4) : hash3(gx, gz, 6, 167) < 0.25 ? 1 : 0;
          for (let k = 0; k < nfl && nf < 2000; k++) {
            const x = gx + hash3(gx, gz, k, 173), z = gz + hash3(gx, gz, k, 179);
            q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash3(gx, gz, k, 181) * 6.28);
            const sc = 0.7 + hash3(gx, gz, k, 191) * 0.7;
            m4.compose(p.set(x, w.heightAt(x, z) - 0.01, z), q, s.set(sc, sc, sc));
            this.flowerStems.setMatrixAt(nf, m4);
            this.flowers.setMatrixAt(nf++, m4);
            const pal = ['#f4f1e6', '#f2d23a', '#a07ad8', '#e8e8f0', '#d8506a', '#6a8ae0'];
            col.set(pal[Math.floor(hash3(gx, gz, k, 193) * pal.length)]);
            this.flowers.setColorAt(nf - 1, col);
          }
        }
      }
      // erba
      if (d2 <= GRASS_R * GRASS_R) {
        const dens = GRASS_DENSITY[biome] * (trail < 1.0 ? 0.1 : trail < 2.5 ? 1.6 : 1) * (this.snowHide ? 0.2 : 1);
        const n = Math.floor(dens + hash3(gx, gz, 2, 41));
        for (let k = 0; k < n && ng < GRASS_CAP; k++) {
          const x = gx + hash3(gx, gz, k, 43), z = gz + hash3(gx, gz, k, 47);
          const y = w.heightAt(x, z) - 0.02;
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash3(gx, gz, k, 53) * 6.28);
          const sc = 0.6 + hash3(gx, gz, k, 59) * 0.8;
          m4.compose(p.set(x, y, z), q, s.set(sc, sc * (biome === 'prati' ? 1.2 : 0.8), sc));
          this.grass.setMatrixAt(ng, m4);
          col.copy(this.grassColor).multiplyScalar(0.8 + hash3(gx, gz, k, 61) * 0.4);
          this.grass.setColorAt(ng, col);
          ng++;
        }
      }
    }
    this.leaves.count = nl; this.grass.count = ng;
    for (const [m, n] of [[this.twigs, nt], [this.pebbles, np], [this.moss, nm], [this.flowers, nf], [this.flowerStems, nf]]) {
      m.count = n; m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.leaves.instanceMatrix.needsUpdate = true; this.grass.instanceMatrix.needsUpdate = true;
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
  }
}
