// Controller in prima persona: sguardo col mouse, camminata su terreno, corsa, accovacciarsi, collisioni.
import * as THREE from 'three';
import { clamp, lerp } from '../core/rng.js';
import { trunkRadius } from '../render/vegetation.js';

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.pos = new THREE.Vector3(world.parking.x - 2, 0, world.parking.z - 6);
    this.yaw = 0; // guarda verso nord (-z)
    this.pitch = -0.05;
    this.eye = 1.65;
    this.crouch = false;
    this.keys = new Set();
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.bob = 0;
    this.stepAcc = 0;
    this.moving = false;
    this.running = false;
    this.distance = 0;
    this.onStep = null;
    this.speedMul = 1;
    this.dragLook = false;

    this._onMouse = (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.dragLook) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch = clamp(this.pitch - e.movementY * s, -1.45, 1.35);
    };
    this._onKeyDown = (e) => { if (!this.enabled) return; this.keys.add(e.code); if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch; };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onLockChange = () => { this.locked = document.pointerLockElement === this.dom; };
    this._onDown = (e) => { if (!this.locked && e.button === 2) this.dragLook = true; };
    this._onUp = (e) => { if (e.button === 2) this.dragLook = false; };
    this._ctx = (e) => e.preventDefault();
    document.addEventListener('mousemove', this._onMouse);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    dom.addEventListener('mousedown', this._onDown);
    document.addEventListener('mouseup', this._onUp);
    dom.addEventListener('contextmenu', this._ctx);
    this.pos.y = world.heightAt(this.pos.x, this.pos.z);
  }

  lock() {
    try {
      const p = this.dom.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch { /* il browser può rifiutare: si usa il trascinamento col tasto destro */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  dispose() {
    document.removeEventListener('mousemove', this._onMouse);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.dom.removeEventListener('mousedown', this._onDown);
    document.removeEventListener('mouseup', this._onUp);
    this.dom.removeEventListener('contextmenu', this._ctx);
  }

  surface() {
    const w = this.world;
    const x = this.pos.x, z = this.pos.z;
    if (w.streamAt(x, z) < 1.4) return 'acqua';
    if (w.trailAt(x, z) < 1.3) return 'sentiero';
    const b = w.biomeAt(x, z);
    if (b === 'prati') return 'erba';
    if (b === 'alta') return w.slopeAt(x, z) > 0.6 ? 'roccia' : 'erba';
    if (b === 'conifere') return 'aghi';
    return 'foglie';
  }

  update(dt, { stamina, snowDepth }) {
    const w = this.world;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    this.moving = len > 0;
    const wantRun = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.running = this.moving && wantRun && !this.crouch && stamina > 3 && !this.noRun;
    let speed = this.crouch ? 0.85 : this.running ? 3.7 : 1.75;
    const surf = this.surface();
    if (surf === 'acqua') speed *= 0.5;
    if (snowDepth > 3) speed *= clamp(1 - snowDepth / 60, 0.55, 1);
    speed *= this.speedMul;
    if (stamina <= 3) speed = Math.min(speed, 1.1);
    let moved = 0;
    if (len > 0) {
      fx /= len; fz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // avanti = (-sin, -cos) nello spazio del mondo (camera guarda -z con yaw 0)
      let dx = (-sin * fz + cos * fx) * speed * dt;
      let dz = (-cos * fz - sin * fx) * speed * dt;
      // pendenza: in salita si rallenta
      const h0 = w.heightAt(this.pos.x, this.pos.z);
      const h1 = w.heightAt(this.pos.x + dx, this.pos.z + dz);
      const grade = (h1 - h0) / Math.max(1e-4, Math.hypot(dx, dz));
      this.grade = grade;
      if (grade > 1.25) { dx *= 0.1; dz *= 0.1; } else if (grade > 0) { const k = clamp(1 - grade * 0.55, 0.4, 1); dx *= k; dz *= k; }
      const nx = clamp(this.pos.x + dx, -199, 199), nz = clamp(this.pos.z + dz, -199, 199);
      let res = this.collide(nx, nz);
      // zone chiuse: non si può entrare
      if (this.canEnter && !this.canEnter(res.x, res.z)) {
        if (this.canEnter(res.x, this.pos.z)) res = { x: res.x, z: this.pos.z };
        else if (this.canEnter(this.pos.x, res.z)) res = { x: this.pos.x, z: res.z };
        else res = { x: this.pos.x, z: this.pos.z };
        this.onBlocked?.(nx, nz);
      }
      moved = Math.hypot(res.x - this.pos.x, res.z - this.pos.z);
      this.pos.x = res.x; this.pos.z = res.z;
      this.distance += moved;
    } else this.grade = 0;
    const ground = w.heightAt(this.pos.x, this.pos.z);
    const targetEye = this.crouch ? 0.85 : 1.65;
    this.eye = lerp(this.eye, targetEye, 1 - Math.exp(-dt * 10));
    // oscillazione della testa e passi
    if (moved > 0) {
      this.bob += moved * (this.running ? 2.6 : 3.4);
      this.stepAcc += moved;
      const stride = this.running ? 1.3 : this.crouch ? 0.55 : 0.8;
      if (this.stepAcc > stride) { this.stepAcc = 0; this.onStep?.(surf, this.running); }
    }
    const bobY = Math.sin(this.bob) * (this.running ? 0.05 : 0.025) * (this.moving ? 1 : 0);
    this.pos.y = ground;
    this.camera.position.set(this.pos.x, ground + this.eye + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * 0.5) * 0.004, 'YXZ');
    return { moved, surface: surf };
  }

  collide(x, z) {
    const w = this.world;
    const PR = 0.3;
    for (const t of w.treesNear(x, z, 2.5)) {
      const r = trunkRadius(t) + PR;
      const dx = x - t.x, dz = z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { x = t.x + (dx / d) * r; z = t.z + (dz / d) * r; }
    }
    for (const rk of this.nearRocks(x, z)) {
      const r = rk.s * 0.85 + PR;
      const dx = x - rk.x, dz = z - rk.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { x = rk.x + (dx / d) * r; z = rk.z + (dz / d) * r; }
    }
    for (const l of this.nearLogs(x, z)) {
      if (l.r < 0.3) continue; // si scavalca
      const ax = Math.cos(l.rot), az = Math.sin(l.rot);
      const px = x - l.x, pz = z - l.z;
      const t = clamp(px * ax + pz * az, -l.len / 2, l.len / 2);
      const cx = l.x + ax * t, cz = l.z + az * t;
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      const r = l.r + PR;
      if (d < r && d > 1e-4) { x = cx + (dx / d) * r; z = cz + (dz / d) * r; }
    }
    return { x, z };
  }

  nearRocks(x, z) {
    if (!this._rockGrid) this._rockGrid = buildGrid(this.world.rocks.filter((r) => r.s > 0.6));
    return queryGrid(this._rockGrid, x, z);
  }
  nearLogs(x, z) {
    if (!this._logGrid) this._logGrid = buildGrid(this.world.logs);
    return queryGrid(this._logGrid, x, z);
  }

  forward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }
}

function buildGrid(items) {
  const g = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / 10)},${Math.floor(it.z / 10)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(it);
  }
  return g;
}
function queryGrid(g, x, z) {
  const out = [];
  const gx = Math.floor(x / 10), gz = Math.floor(z / 10);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = g.get(`${gx + a},${gz + b}`); if (l) out.push(...l); }
  return out;
}
