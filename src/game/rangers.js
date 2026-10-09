// Guardie forestali: pattugliano i sentieri, notano il giocatore e lo controllano.
import * as THREE from 'three';
import { mulberry32, clamp } from '../core/rng.js';

const PATROL_SPEED = 1.15, APPROACH_SPEED = 1.7;
const NOTICE_DIST = 26, GIVE_UP_DIST = 55, CHECK_DIST = 2.6;

function mat(color, rough = 0.8) { return new THREE.MeshStandardMaterial({ color, roughness: rough }); }

// Modello procedurale: uniforme verde, gilet ad alta visibilità, cappello, zaino
function buildRangerMesh(seed) {
  const r = mulberry32(seed);
  const g = new THREE.Group();
  const uniform = mat('#3d4a2c'), dark = mat('#26301c'), skin = mat(['#e2b48c', '#c9956c', '#a8724e'][Math.floor(r() * 3)], 0.6);
  const vest = mat('#c8d63a', 0.5), boots = mat('#2a2018', 0.9), pack = mat('#5a4a32');
  const legGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.85, 8); legGeo.translate(0, -0.425, 0);
  const armGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.62, 8); armGeo.translate(0, -0.31, 0);
  const legL = new THREE.Mesh(legGeo, dark), legR = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.11, 0.9, 0); legR.position.set(0.11, 0.9, 0);
  const bootGeo = new THREE.BoxGeometry(0.13, 0.1, 0.26); bootGeo.translate(0, -0.85, 0.05);
  legL.add(new THREE.Mesh(bootGeo, boots)); legR.add(new THREE.Mesh(bootGeo, boots));
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.62, 10), uniform); torso.position.y = 1.22;
  const vestM = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.195, 0.42, 10, 1, true), vest); vestM.position.y = 1.26;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.2, 0.05, 10, 1, true), mat('#e8e8e8', 0.3)); stripe.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin); head.position.y = 1.66;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16), dark); brim.position.y = 1.75;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.12, 14), uniform); crown.position.y = 1.81;
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), mat('#d8b040', 0.3)); badge.position.set(0.09, 1.36, 0.215);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.16), pack); bag.position.set(0, 1.25, -0.21);
  const armL = new THREE.Mesh(armGeo, uniform), armR = new THREE.Mesh(armGeo, uniform);
  armL.position.set(-0.26, 1.48, 0); armR.position.set(0.26, 1.48, 0);
  const hand = new THREE.SphereGeometry(0.05, 8, 6); hand.translate(0, -0.64, 0);
  armL.add(new THREE.Mesh(hand, skin)); armR.add(new THREE.Mesh(hand, skin));
  g.add(legL, legR, torso, vestM, stripe, head, brim, crown, badge, bag, armL, armR);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { legL, legR, armL, armR };
  return g;
}

export class Rangers {
  constructor(world, parent, count, seed) {
    this.world = world;
    this.list = [];
    const rand = mulberry32(seed);
    const trails = world.trails.filter((t) => t.length > 20);
    for (let i = 0; i < count && trails.length; i++) {
      const path = trails[Math.floor(rand() * trails.length)];
      let idx = Math.floor(path.length * (0.35 + rand() * 0.6));
      idx = clamp(idx, 1, path.length - 2);
      const mesh = buildRangerMesh(Math.floor(rand() * 1e6));
      const p = path[idx];
      mesh.position.set(p.x, world.heightAt(p.x, p.z), p.z);
      parent.add(mesh);
      this.list.push({ mesh, path, idx, dir: rand() < 0.5 ? 1 : -1, state: 'patrol', cooldownUntil: -1, phase: rand() * 6, pause: 0, noticed: false, name: ['Ispettore Bianchi', 'Agente Rossi', 'Guardia Ferrari', 'Agente Colombo', 'Ispettrice Greco'][i % 5] });
    }
  }

  lineOfSight(a, b) {
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      if (this.world.heightAt(x, z) > y) return false;
    }
    return true;
  }

  /**
   * @returns {{type:'notice'|'check'|null, ranger?}}
   */
  update(dt, playerPos, hour, { suspicious }) {
    let event = null;
    const w = this.world;
    for (const g of this.list) {
      const m = g.mesh;
      const pos = m.position;
      const dPlayer = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);
      let speed = 0, tx = pos.x, tz = pos.z;
      if (g.state === 'patrol') {
        if (g.pause > 0) { g.pause -= dt; }
        else {
          const target = g.path[g.idx];
          tx = target.x; tz = target.z;
          if (Math.hypot(tx - pos.x, tz - pos.z) < 0.6) {
            g.idx += g.dir;
            if (g.idx <= 0 || g.idx >= g.path.length - 1) { g.dir *= -1; g.idx = clamp(g.idx, 0, g.path.length - 1); g.pause = 4; }
            else if (Math.random() < 0.01) g.pause = 2 + Math.random() * 4; // si ferma a osservare
          }
          speed = PATROL_SPEED;
        }
        const eyeR = new THREE.Vector3(pos.x, pos.y + 1.6, pos.z), eyeP = new THREE.Vector3(playerPos.x, w.heightAt(playerPos.x, playerPos.z) + 1.2, playerPos.z);
        if (hour > g.cooldownUntil && dPlayer < NOTICE_DIST * (suspicious ? 1.25 : 1) && this.lineOfSight(eyeR, eyeP)) {
          g.state = 'approach';
          if (!event) event = { type: 'notice', ranger: g };
        }
      } else if (g.state === 'approach') {
        tx = playerPos.x; tz = playerPos.z; speed = APPROACH_SPEED;
        if (dPlayer > GIVE_UP_DIST) { g.state = 'patrol'; g.cooldownUntil = hour + 0.5; }
        else if (dPlayer < CHECK_DIST) { g.state = 'checking'; speed = 0; event = { type: 'check', ranger: g }; }
      } else if (g.state === 'checking') {
        tx = playerPos.x; tz = playerPos.z;
      }
      // movimento e orientamento
      const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        const yaw = Math.atan2(dx, dz);
        let diff = yaw - m.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        m.rotation.y += diff * Math.min(1, dt * 5);
        if (speed > 0) {
          const step = Math.min(d, speed * dt);
          pos.x += (dx / d) * step; pos.z += (dz / d) * step;
        }
      }
      pos.y = w.heightAt(pos.x, pos.z);
      // camminata
      const u = m.userData;
      if (speed > 0) g.phase += dt * speed * 4.2;
      const sw = speed > 0 ? Math.sin(g.phase) * 0.55 : 0;
      u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw * 0.7; u.armR.rotation.x = sw * 0.7;
      if (g.state === 'checking') u.armR.rotation.x = -0.9; // mostra il tesserino
    }
    return event;
  }

  release(g, hour) {
    g.state = 'patrol';
    g.cooldownUntil = hour + 2.5; // non ricontrolla per un paio d'ore
  }

  nearest(pos, maxD = 3) {
    let best = null, bd = maxD;
    for (const g of this.list) {
      const d = Math.hypot(g.mesh.position.x - pos.x, g.mesh.position.z - pos.z);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
}
