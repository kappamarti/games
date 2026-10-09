// La spedizione: il mondo 3D, il tempo che scorre, il meteo, la ricerca e la raccolta.
import * as THREE from 'three';
import { generateWorld, BIOME_LABEL, BIOME_COLOR } from '../world/worldgen.js';
import { buildTerrain, buildStream, buildParking } from '../render/terrain.js';
import { buildVegetation, updateVegetationLOD } from '../render/vegetation.js';
import { GroundCover } from '../render/groundcover.js';
import { Atmosphere } from '../render/atmosphere.js';
import { envUniforms } from '../render/envShader.js';
import { mushroomGeometry, mushroomMaterial } from '../render/mushroomMesh.js';
import { leafTexture } from '../render/textures.js';
import { Player } from './player.js';
import { regionalDay, hourly, freeDay, WEATHER_TYPES } from '../sim/weather.js';
import { prepareEco, simulateUntil, stageOf, growthScale, removeMushroom, cellReadings, boostedCopy } from '../sim/ecosystem.js';
import { SPECIES_BY_ID } from '../data/species.js';
import { EQUIP_BY_ID, REGION_BY_ID } from '../data/equipment.js';
import { formatTime, sunTimes, formatDate } from '../data/calendar.js';
import { ecoFor, hasItem, skillLevel, knownSpecies, LIMIT_KG, saveGame } from './state.js';
import { openInspect } from '../ui/inspect.js';
import { drawMap, mapLegend, markExplored } from '../ui/map.js';
import { el, clear, toast, bar, confirmDialog } from '../ui/dom.js';
import { audio } from '../core/audio.js';
import { configureShadows, applyQuality, detachShadows, updateShadows, QUALITY, RESOLUTIONS } from '../render/pipeline.js';
import { clamp, hash2, lerp } from '../core/rng.js';
import { assignZones, zoneUnlocked, licenseFor, pickIssues, pickingAllowedHere, rangerInspection, rulesSummary, ZONE_BY_ID } from './rules.js';
import { Rangers } from './rangers.js';
import { openRangerCheck } from '../ui/ranger.js';
import { dayOfWeek, ZONES as ZONES_ALL } from '../data/zones.js';

const worldCache = new Map();
export function getWorld(regionId) {
  if (!worldCache.has(regionId)) {
    const w = generateWorld(REGION_BY_ID[regionId]);
    prepareEco(w);
    assignZones(w, regionId);
    worldCache.set(regionId, w);
  }
  return worldCache.get(regionId);
}

const VIEW_R = 48;
const GROUND_COLOR = { conifere: '#5a4630', faggeta: '#7a4c26', misto: '#5e4c2e', antica: '#463a26', prati: '#5f7a32', alta: '#6f6a58' };

export class Expedition {
  constructor(app, state, { startHour, freeWeather, checkedForecast }) {
    this.app = app;
    this.state = state;
    this.region = REGION_BY_ID[state.regionId];
    this.world = getWorld(state.regionId);
    this.eco = ecoFor(state, state.regionId);
    simulateUntil(this.world, this.eco, state.weather, this.region, state.day);
    this.free = state.mode === 'libera';
    if (this.free) this.eco = boostedCopy(this.world, this.eco, state.weather, this.region, state.day);
    const real = regionalDay(state.weather, state.day, this.region);
    this.rec = this.free && freeWeather ? freeDay(state.day, freeWeather, real) : real;
    this.prevRec = regionalDay(state.weather, state.day - 1, this.region);
    this.hour = startHour;
    this.startHour = startHour;
    this.basket = [];
    this.photos = [];
    this.found = new Map();
    this.examined = new Set();
    this.habitatCells = new Set();
    this.stamina = 100; this.comfort = 100;
    this.paused = false; this.modal = null;
    this.fogMinutes = 0; this.usedGps = hasItem(state, 'gps');
    this.checkedForecast = checkedForecast;
    this.warned = {};
    this.torchOn = false;
    this.cap = this.capacity();
    this.zonesVisited = new Set();
    this.washed = this.rec.rain > 6 || this.prevRec.rain > 12;
    this.container = this.cap.container;
    this.thermosUses = hasItem(state, 'thermos') ? 2 : 0;
    this.umbrellaOpen = false;
    this.rangerLog = { checks: 0, fines: 0, confiscated: 0 };
    this.currentZone = null;
    this.build();
  }

  capacity() {
    if (hasItem(this.state, 'cestino_grande')) return { kg: EQUIP_BY_ID.cestino_grande.capacity, name: 'Cestino grande', container: 'cestino' };
    if (hasItem(this.state, 'cestino_piccolo')) return { kg: EQUIP_BY_ID.cestino_piccolo.capacity, name: 'Cestino piccolo', container: 'cestino' };
    return { kg: 1.5, name: 'Sacchetto di plastica (vietato!)', container: 'sacchetto' };
  }

  basketKg() { return this.basket.reduce((a, b) => a + b.weight, 0) / 1000; }

  // --------------------------------------------------------------------------
  build() {
    const app = this.app;
    const renderer = app.renderer;
    // tutti gli oggetti della spedizione vivono in un gruppo dentro la scena di threepipe
    const scene = new THREE.Group();
    scene.name = 'spedizione';
    this.scene = scene;
    this.camera = app.camera;
    this.camera.position.set(0, 0, 0);
    this.atmo = new Atmosphere(scene, app.viewer.scene);
    renderer.shadowMap.enabled = this.state.settings.shadows !== false;
    const w = this.world;
    this.terrain = buildTerrain(w, this.state.day);
    scene.add(this.terrain);
    this.stream = buildStream(w); scene.add(this.stream);
    this.parking = buildParking(w); scene.add(this.parking);
    this.carPos = this.parking.userData.carPos;
    this.veg = buildVegetation(w, this.state.day); scene.add(this.veg);
    this.cover = new GroundCover(w, this.state.day, this.eco.snow);
    scene.add(this.cover.group);

    // funghi visibili
    this.mushGroup = new THREE.Group(); scene.add(this.mushGroup);
    this.mushMeshes = new Map();
    this.leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    this.coverLeaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.13).rotateX(-Math.PI / 2), this.leafMat, 4000);
    this.coverLeaves.count = 0; this.coverLeaves.frustumCulled = false; this.coverLeaves.receiveShadow = true;
    scene.add(this.coverLeaves);

    // torcia frontale
    this.torch = new THREE.SpotLight('#fff2d0', 0, 28, 0.5, 0.45, 1.4);
    this.torch.castShadow = false;
    scene.add(this.torch, this.torch.target);

    this.buildBarriers(scene);
    this.buildHandProps(scene);
    const nR = (this.state.regionId === 'larici' ? 3 : 2) + (dayOfWeek(this.state.day) >= 5 ? 1 : 0);
    this.rangers = this.free ? null : new Rangers(w, scene, nR, this.state.seed + this.state.day * 31);

    app.viewer.scene.addObject(scene, { addToRoot: true });
    configureShadows(app.viewer, this.atmo.sun, this.state.settings.quality);
    applyQuality(app.viewer, this.state.settings);
    this.player = new Player(this.camera, renderer.domElement, w);
    this.player.sensitivity = this.state.settings.sensitivity;
    this.player.onStep = (surf, run) => audio.step(this.eco.snow > 3 ? 'neve' : surf, run);
    this.player.canEnter = (x, z) => zoneUnlocked(this.state, this.world.zoneAt(x, z));
    this.player.onBlocked = (x, z) => {
      const now = performance.now();
      if (now - (this._blockT || 0) < 4000) return;
      this._blockT = now;
      const zz = ZONE_BY_ID[this.world.zoneAt(x, z)];
      toast(`🚧 ${zz.name}: zona chiusa al pubblico. Si apre al livello ${zz.level}.`, 'warn', 3500);
    };
    this.raycaster = new THREE.Raycaster();

    this.buildHUD();
    this.onKey = (e) => this.handleKey(e);
    window.addEventListener('keydown', this.onKey);
    this.onResize = () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); };
    window.addEventListener('resize', this.onResize);
    this.onClickCanvas = () => { if (!this.paused && !this.modal) this.player.lock(); };
    renderer.domElement.addEventListener('click', this.onClickCanvas);
    this.onLock = () => {
      if (!document.pointerLockElement && !this.modal && !this.paused && !this.ending && this.wasLocked) this.openPause();
      this.wasLocked = !!document.pointerLockElement;
    };
    document.addEventListener('pointerlockchange', this.onLock);

    this.refreshMushrooms(true);
    this.cover.update(this.player.pos, true);
    const wt = WEATHER_TYPES[this.rec.type];
    toast(`${formatDate(this.state.day)} — ${wt.icon} ${wt.label}, ${this.rec.tMin.toFixed(0)}/${this.rec.tMax.toFixed(0)} °C. Clicca per guardarti intorno.`, 'info', 6000);
    if (this.free) toast('Modalità libera: il bosco è generoso, nessuna sanzione.', 'info', 5000);
  }

  // --------------------------------------------------------------------------
  buildHUD() {
    this.hud = el('div', { class: 'hud' });
    this.compass = el('div', { class: 'compass' }, el('div', { class: 'compass-strip' }));
    this.crosshair = el('div', { class: 'crosshair' });
    this.prompt = el('div', { class: 'prompt' });
    this.hudBL = el('div', { class: 'hud-bl' });
    this.hudBR = el('div', { class: 'hud-br' });
    this.hudTL = el('div', { class: 'hud-tl' });
    this.readings = el('div', { class: 'readings hidden' });
    this.vignette = el('div', { class: 'vignette' });
    this.hud.append(this.vignette, this.compass, this.crosshair, this.prompt, this.hudBL, this.hudBR, this.hudTL, this.readings);
    if (!hasItem(this.state, 'bussola')) this.compass.classList.add('hidden');
    document.body.append(this.hud);
    const strip = this.compass.firstChild;
    const marks = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SO', '·', 'O', '·', 'NO', '·'];
    for (let r = 0; r < 3; r++) for (const m of marks) strip.append(el('span', { class: m.length > 1 || m === 'N' || m === 'E' || m === 'S' || m === 'O' ? 'major' : '' }, m));
    this.hudTL.append(el('div', { class: 'keys' }, 'WASD muovi • Shift corri • C accovacciati • E esamina • M mappa • Tab cestino • H habitat' + (hasItem(this.state, 'gps') ? ' • G salva punto' : '') + (hasItem(this.state, 'torcia') ? ' • T torcia' : '') + (hasItem(this.state, 'ombrello') ? ' • U ombrello' : '') + (hasItem(this.state, 'thermos') ? ' • R thermos' : '') + ' • Esc pausa'));
    this.zoneEl = el('div', { class: 'zone-tag' });
    this.hudTL.append(this.zoneEl);
    this.hudTick = 0;
  }

  updateHUD(cond) {
    this.hudTick -= 1;
    if (this.hudTick > 0) return;
    this.hudTick = 6;
    const kg = this.basketKg();
    clear(this.hudBL);
    this.hudBL.append(
      el('div', { class: 'hud-row' }, el('span', { class: 'ico' }, '🧺'), el('span', {}, `${kg.toFixed(2)} / ${this.cap.kg} kg`), bar(kg, this.cap.kg, kg / this.cap.kg > 0.85 ? 'warn' : '')),
      el('div', { class: 'hud-row' }, el('span', { class: 'ico' }, '⚡'), el('span', {}, 'Energia'), bar(this.stamina, 100, this.stamina < 25 ? 'warn' : 'stamina')),
      el('div', { class: 'hud-row' }, el('span', { class: 'ico' }, '🧥'), el('span', {}, 'Comfort'), bar(this.comfort, 100, this.comfort < 30 ? 'warn' : 'comfort')),
    );
    clear(this.hudBR);
    const st = sunTimes(this.state.day);
    const wt = WEATHER_TYPES[this.rec.type];
    this.hudBR.append(
      el('div', { class: 'clock' }, formatTime(this.hour)),
      el('div', {}, `${cond.temp.toFixed(0)} °C • ${wt.icon}`),
      el('div', { class: 'muted' }, `Tramonto ${formatTime(st.sunset)}`),
      el('div', { class: 'tools' }, this.state.loadout.filter((id) => EQUIP_BY_ID[id]?.slot === 'tool').map((id) => el('span', { title: EQUIP_BY_ID[id].name }, toolIcon(id)))),
    );
    if (this.player.crouch) this.crosshair.classList.add('crouch'); else this.crosshair.classList.remove('crouch');
  }

  // --------------------------------------------------------------------------
  refreshMushrooms(force = false) {
    const p = this.player.pos;
    if (!force && this._lastRefresh && Math.hypot(p.x - this._lastRefresh.x, p.z - this._lastRefresh.z) < 4) return;
    this._lastRefresh = p.clone();
    const day = this.state.day;
    const keep = new Set();
    for (const m of this.eco.mushrooms) {
      const dx = m.x - p.x, dz = m.z - p.z;
      if (dx * dx + dz * dz > VIEW_R * VIEW_R) continue;
      keep.add(m.id);
      if (this.mushMeshes.has(m.id)) continue;
      const sp = SPECIES_BY_ID[m.sp];
      const stage = stageOf(m, day);
      const geo = mushroomGeometry(sp, stage, m.seed % 4, { eaten: !!m.eaten, slugs: !!m.slugs, washed: this.washed });
      const mesh = new THREE.Mesh(geo, mushroomMaterial());
      const gs = growthScale(m, day);
      mesh.scale.setScalar(gs);
      const ground = this.world.heightAt(m.x, m.z);
      if (sp.morph.growth === 'mensola') {
        mesh.position.set(m.x, ground + m.ay, m.z);
        mesh.rotation.set(0, -m.face, 0);
      } else {
        mesh.position.set(m.x, ground - 0.006 - m.cover * 0.012, m.z);
        mesh.rotation.set(m.tilt, (m.seed % 628) / 100, m.tilt * 0.6);
      }
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.m = m;
      this.mushGroup.add(mesh);
      this.mushMeshes.set(m.id, mesh);
    }
    for (const [id, mesh] of this.mushMeshes) {
      if (!keep.has(id)) { this.mushGroup.remove(mesh); this.mushMeshes.delete(id); }
    }
    this.rebuildCoverLeaves();
  }

  rebuildCoverLeaves() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    const pal = { faggeta: ['#8a4a1e', '#a0602a', '#6e3e1c'], misto: ['#7a5a2a', '#8a7a30', '#5a4a2a'], conifere: ['#5a3e26', '#6a4a2c'], antica: ['#5a4426', '#4a3a22'], prati: ['#7a8a3a', '#6a7a32'], alta: ['#6a5a40'] };
    for (const mesh of this.mushMeshes.values()) {
      const m = mesh.userData.m;
      if (SPECIES_BY_ID[m.sp].morph.growth === 'mensola') continue;
      const biome = this.world.biomeAt(m.x, m.z);
      const p = pal[biome];
      const gs = mesh.scale.x;
      const R = SPECIES_BY_ID[m.sp].morph.cap.r * gs;
      const cnt = Math.round(m.cover * 9);
      for (let k = 0; k < cnt && n < 4000; k++) {
        const a = hash2(m.id, k, 3) * Math.PI * 2;
        const onCap = k < Math.round(m.cover * 3);
        const r = onCap ? R * hash2(m.id, k, 9) * 0.6 : R * (0.6 + hash2(m.id, k, 5) * 1.3);
        const y = onCap ? mesh.position.y + (mesh.geometry.boundingBox?.max.y || 0.05) * gs * 0.95 : this.world.heightAt(m.x, m.z) + 0.02 + k * 0.004;
        e.set((hash2(m.id, k, 11) - 0.5) * (onCap ? 0.9 : 0.6), hash2(m.id, k, 13) * 6.28, (hash2(m.id, k, 17) - 0.5) * (onCap ? 0.9 : 0.6));
        q.setFromEuler(e);
        const sc = 0.8 + hash2(m.id, k, 19) * 0.8;
        m4.compose(v.set(m.x + Math.cos(a) * r, y, m.z + Math.sin(a) * r), q, s.set(sc, 1, sc));
        this.coverLeaves.setMatrixAt(n, m4);
        col.set(p[Math.floor(hash2(m.id, k, 23) * p.length)]).multiplyScalar(0.8 + hash2(m.id, k, 29) * 0.4);
        this.coverLeaves.setColorAt(n, col);
        n++;
      }
    }
    this.coverLeaves.count = n;
    this.coverLeaves.instanceMatrix.needsUpdate = true;
    if (this.coverLeaves.instanceColor) this.coverLeaves.instanceColor.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  update(dt) {
    if (this.ending) return;
    const st = this.state.settings;
    const frozen = this.paused || this.modal === 'map' || this.modal === 'basket';
    if (!frozen) this.hour += (dt * st.timeScale) / 3600;
    const cond = hourly(this.rec, this.hour);
    this.cond = cond;
    envUniforms.uTime.value += dt;
    envUniforms.uWind.value = lerp(envUniforms.uWind.value, 0.15 + cond.wind * 1.1, dt * 0.5);
    const morningDew = this.hour < 9.5 ? clamp((9.5 - this.hour) / 3, 0, 1) * 0.35 : 0;
    const recentRain = clamp(this.prevRec.rain / 25, 0, 0.6) * clamp(1 - (this.hour - 7) / 8, 0.3, 1);
    const wetTarget = clamp(Math.max(cond.rain * 1.3, recentRain, morningDew, this.rec.type === 'nebbia' ? 0.4 : 0), 0, 1);
    envUniforms.uWet.value = lerp(envUniforms.uWet.value, wetTarget, dt * 0.3);
    const snowCover = clamp(this.eco.snow / 6, 0, 1);
    envUniforms.uSnow.value = Math.max(snowCover, cond.snow > 0 ? clamp(envUniforms.uSnow.value + dt * 0.002 * st.timeScale / 12, 0, 0.85) : 0);
    envUniforms.uFrost.value = this.rec.tMin < 0 ? clamp(1 - (this.hour - 7) / 3.5, 0, 1) : 0;
    if (this.stream.material.userData.shader) this.stream.material.userData.shader.uniforms.uTime.value += dt;

    const inputBlocked = this.paused || !!this.modal;
    this.player.enabled = !inputBlocked;
    const res = this.player.update(inputBlocked ? 0 : dt, { stamina: this.stamina, snowDepth: this.eco.snow });
    const pos = this.player.pos;

    // energia e comfort
    if (!inputBlocked) this.updateBody(dt, cond, res);
    const a = this.atmo.update(dt, { hour: this.hour, day: this.state.day, cond, camPos: this.camera.position, region: this.region });
    if (a.bolt) this.onLightning();
    this.envTimer = (this.envTimer ?? 0) - dt;
    updateShadows(this.app.viewer, this.envTimer <= 0);
    if (this.envTimer <= 0) {
      this.envTimer = 2.5;
      this.atmo.updateEnvironment(this.app.renderer, this.app.viewer.scene, this.atmo.day01, cond);
      this.app.viewer.scene.environmentIntensity = lerp(0.04, 1.5, this.atmo.day01);
    }
    this.torch.intensity = this.torchOn ? 26 : 0;
    if (this.torchOn) {
      this.torch.position.copy(this.camera.position).add(new THREE.Vector3(0, -0.15, 0));
      this.torch.target.position.copy(this.camera.position).add(this.player.forward(new THREE.Vector3()).multiplyScalar(5));
    }
    updateVegetationLOD(this.veg, pos, (QUALITY[this.state.settings.quality] || QUALITY.alta).lod);
    this.cover.update(pos);
    this.refreshMushrooms();
    if (cond.fog > 0.5 && !frozen) this.fogMinutes += (dt * st.timeScale) / 60;

    // esplorazione
    const cell = this.world.cellAt(pos.x, pos.z);
    if (markExplored(this.state, this.region.id, cell.idx)) { /* nuova zona */ }
    if (!this.zonesVisited.has(cell.biome)) { this.zonesVisited.add(cell.biome); if (this.zonesVisited.size > 1) toast(`Entri in: ${BIOME_LABEL[cell.biome]}`, 'info', 2500); }

    // zone di raccolta
    const zid = this.world.zoneAt(pos.x, pos.z);
    if (zid !== this.currentZone) { this.currentZone = zid; this.onZoneChange(zid); }
    // guardie forestali
    if (this.rangers && !this.modal && !this.paused) {
      const ev = this.rangers.update(dt, pos, this.hour, { suspicious: this.basket.some((b) => b.issues?.length) || hasItem(this.state, 'rastrello') || this.container === 'sacchetto' });
      if (ev?.type === 'notice') toast('👮 Una guardia forestale ti ha notato e si avvicina…', 'warn', 3500);
      if (ev?.type === 'check') this.runRangerCheck(ev.ranger, 'sentiero');
    }
    this.updateHandProps(cond, dt);

    // bussola
    if (!this.compass.classList.contains('hidden')) {
      const deg = ((-this.player.yaw * 180) / Math.PI + 360) % 360;
      this.compass.firstChild.style.transform = `translateX(${-(deg / 360) * 16 * 28 - 16 * 28 + 140}px)`;
    }

    this.updateInteraction();
    this.updateTimeEvents();
    this.updateHUD(cond);
    // vignetta: buio senza torcia, fatica
    const dark = clamp(1 - this.atmo.info.daylight * 1.6, 0, 1) * (this.torchOn ? 0.3 : 1);
    this.vignette.style.opacity = String(clamp(dark * 0.55 + (this.stamina < 15 ? 0.25 : 0) + (this.comfort < 20 ? 0.15 : 0), 0, 0.8));

    audio.update(dt, { rain: cond.rain, wind: cond.wind, streamDist: this.world.streamAt(pos.x, pos.z), daylight: this.atmo.info.daylight, snow: cond.snow, indoor: false });
  }

  updateBody(dt, cond, res) {
    const p = this.player;
    const has = (id) => hasItem(this.state, id);
    const kg = this.basketKg() + (has('cestino_grande') ? 0.5 : 0);
    let ds = 0;
    if (p.running) ds -= 8.5;
    else if (p.moving) {
      const g = Math.max(0, p.grade || 0);
      ds -= g * 9 * (has('scarponi') ? 0.65 : 1) * (has('bastone') ? 0.75 : 1);
      ds += g < 0.08 ? 1.4 : 0;
      ds -= kg > 2.5 ? 0.6 : 0;
    } else ds += 4.5;
    const maxSt = this.comfort < 25 ? 60 : 100;
    this.stamina = clamp(this.stamina + ds * dt, 0, maxSt);
    // comfort
    let dc = 0.35;
    const raining = cond.rain > 0.1 || cond.snow > 0.1;
    if (raining) {
      dc = has('impermeabile') ? -0.03 : -0.45 * Math.max(cond.rain, cond.snow) - 0.1;
      if (this.umbrellaOpen) dc = has('impermeabile') ? 0.05 : Math.max(dc * 0.15, -0.08);
    }
    if (cond.temp < 4) dc -= has('pile') ? 0.02 : (cond.temp < 0 ? 0.35 : 0.15);
    if (res.surface === 'acqua') dc -= has('scarponi') ? 0.1 : 0.6;
    this.comfort = clamp(this.comfort + dc * dt, 0, 100);
    // scivolate sul bagnato in discesa
    if (p.running && (p.grade || 0) < -0.35 && envUniforms.uWet.value > 0.5 && !has('scarponi') && !has('bastone') && Math.random() < dt * 0.25) {
      this.stamina = Math.max(0, this.stamina - 15);
      toast('Scivoli sul terreno bagnato! Con gli scarponi andrebbe meglio.', 'warn');
    }
  }

  onLightning() {
    const pos = this.player.pos;
    const cell = this.world.cellAt(pos.x, pos.z);
    const exposed = cell.exposure || cell.biome === 'prati' || cell.biome === 'alta';
    const close = exposed && Math.random() < (this.umbrellaOpen ? 0.6 : 0.3);
    audio.thunder(close ? 0.05 : 0.4 + Math.random() * 0.6);
    if (close) {
      this.stamina = Math.max(0, this.stamina - 30); this.comfort = Math.max(0, this.comfort - 20);
      toast(this.umbrellaOpen ? '⚡ Un fulmine vicinissimo! Mai l\'ombrello aperto allo scoperto durante un temporale.' : '⚡ Un fulmine è caduto vicinissimo! Allontanati dalle zone aperte.', 'danger', 5000);
    }
  }

  updateTimeEvents() {
    const st = sunTimes(this.state.day);
    const h = this.hour;
    const once = (k, fn) => { if (!this.warned[k]) { this.warned[k] = true; fn(); } };
    if (h > st.sunset - 1) once('sunset1', () => toast('🌇 Il sole tramonterà tra circa un\'ora: pensa al rientro.', 'warn', 6000));
    if (h > st.sunset + 0.3) once('dark', () => toast(hasItem(this.state, 'torcia') ? '🌙 È buio. Accendi la torcia frontale [T].' : '🌙 È buio e non hai una torcia: torna all\'auto con prudenza!', 'warn', 6000));
    if (this.rec.type === 'temporale' && h > this.rec.stormHour - 1.3) once('storm', () => toast('⛈ Il cielo si oscura e il vento aumenta: sta arrivando un temporale.', 'warn', 6000));
    if (h >= 22.5) once('rescue', () => this.finish({ rescued: true }));
    if (this.stamina <= 0 && this.comfort <= 5) once('exhaust', () => { toast('Sei esausto e infreddolito…', 'danger'); setTimeout(() => this.finish({ rescued: true }), 1500); });
  }

  // --------------------------------------------------------------------------
  updateInteraction() {
    if (this.modal || this.paused) { this.prompt.textContent = ''; return; }
    const p = this.player;
    const reach = 2.2 + skillLevel(this.state.skills.osservazione) * 0.12 + (p.crouch ? 0.5 : 0);
    const coverMax = hasItem(this.state, 'rastrello') ? 0.95 : 0.55; // il rastrello scopre la lettiera (ma è vietato)
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.raycaster.far = reach + p.eye;
    let target = null;
    const hits = this.raycaster.intersectObjects(this.mushGroup.children, false);
    if (hits.length) {
      const m = hits[0].object.userData.m;
      // gli esemplari molto coperti si notano solo abbassandosi
      if ((m.cover < coverMax || p.crouch) && this.lineOfSight(hits[0].object)) target = hits[0].object;
    }
    // tolleranza: se il raggio sfiora un fungo molto piccolo
    if (!target) {
      const fw = p.forward(new THREE.Vector3());
      let best = null, bd = Infinity;
      for (const mesh of this.mushGroup.children) {
        const m = mesh.userData.m;
        const v = mesh.position.clone().add(new THREE.Vector3(0, 0.05 * mesh.scale.x, 0)).sub(this.camera.position);
        const d = v.length();
        if (d > reach + p.eye * 0.7) continue;
        const ang = Math.acos(Math.min(1, v.normalize().dot(fw)));
        const tol = Math.atan2(0.12 + 0.1 * mesh.scale.x, d); // tolleranza angolare in base alla distanza
        if (ang < tol && ang < bd && (m.cover < coverMax || p.crouch) && this.lineOfSight(mesh)) { bd = ang; best = mesh; }
      }
      target = best;
    }
    this.target = target;
    const nearCar = Math.hypot(p.pos.x - this.carPos.x, p.pos.z - this.carPos.z) < 5;
    this.nearCar = nearCar;
    if (target) {
      this.prompt.textContent = this.examined.has(target.userData.m.id) ? '[E] Esamina di nuovo' : '[E] Esamina';
      this.crosshair.classList.add('active');
    } else {
      this.crosshair.classList.remove('active');
      this.talkRanger = this.rangers?.nearest(p.pos, 3.2);
      this.prompt.textContent = this.talkRanger && this.talkRanger.state === 'patrol' ? '[E] Parla con la guardia forestale' : nearCar ? '[E] Termina la spedizione e rientra' : '';
    }
    // intuizione (competenza Osservazione)
    this.hintTimer = (this.hintTimer ?? 3) - 1 / 60;
    if (this.hintTimer <= 0) {
      this.hintTimer = 3;
      const lvl = skillLevel(this.state.skills.osservazione);
      if (lvl >= 1 && !target) {
        const fw = p.forward(new THREE.Vector3()); fw.y = 0; fw.normalize();
        for (const mesh of this.mushGroup.children) {
          const m = mesh.userData.m;
          if (this.examined.has(m.id)) continue;
          const dx = m.x - p.pos.x, dz = m.z - p.pos.z, d = Math.hypot(dx, dz);
          if (d < 3 || d > 4 + lvl * 0.6) continue;
          if ((dx * fw.x + dz * fw.z) / d < 0.7) continue;
          if (Math.random() < lvl * 0.07) { toast('👀 Noti qualcosa tra le foglie, poco più avanti…', 'hint', 2500); break; }
        }
      }
    }
  }

  // il terreno non deve frapporsi tra gli occhi e il fungo
  lineOfSight(mesh) {
    const a = this.camera.position;
    const b = mesh.position.clone(); b.y += 0.06 * mesh.scale.x;
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      if (this.world.heightAt(x, z) > y + 0.015) return false;
    }
    return true;
  }

  async examine(mesh) {
    const m = mesh.userData.m;
    const sp = SPECIES_BY_ID[m.sp];
    this.modal = 'inspect';
    this.player.unlock();
    this.examined.add(m.id);
    if (!this.found.has(m.id)) this.found.set(m.id, { sp: m.sp, cover: m.cover });
    const stage = stageOf(m, this.state.day);
    const gs = growthScale(m, this.state.day);
    const capCm = sp.morph.cap.r * 2 * gs * 100 * (stage === 'giovane' ? 0.78 : stage === 'vecchio' ? 1.1 : 1);
    const nearTrees = this.world.treesNear(m.x, m.z, 8);
    const cell = this.world.cellAt(m.x, m.z);
    const ctx = {
      sp, stage, capCm, geo: mesh.geometry, scale: gs,
      flags: { eaten: !!m.eaten, slugs: !!m.slugs, washed: this.washed },
      hasLens: hasItem(this.state, 'lente'), hasKnife: hasItem(this.state, 'coltello'), hasGuide: hasItem(this.state, 'guida'),
      baseHidden: hash2(m.id, 7, 1) < 0.6, nearTrees, substrate: sp.traits.substrate, biome: this.world.biomeAt(m.x, m.z),
      habitatLevel: skillLevel(this.state.skills.habitat), skills: Object.fromEntries(Object.entries(this.state.skills).map(([k, v]) => [k, skillLevel(v)])),
      knownIds: knownSpecies(this.state).map((s) => s.id), biomeColor: GROUND_COLOR[this.world.biomeAt(m.x, m.z)],
      canPick: this.basketKg() + (sp.weight * gs ** 2.5) / 1000 <= this.cap.kg + 0.01,
      photoTaken: this.photos.some((p) => p.mid === m.id), prevGuess: m._guess,
      onHabitat: () => this.habitatCells.add(cell.idx),
    };
    const res = await openInspect(ctx);
    m._guess = res.guess;
    if (res.photo) {
      this.photos.push({ sp: m.sp, guess: res.guess, img: res.photo.img, mid: m.id });
      toast('📷 Foto salvata nel taccuino.', 'info', 2000);
    }
    let issues = [];
    if (res.picked && !this.free) {
      issues = pickIssues(this.state, { zoneId: cell.zone, day: this.state.day, hour: this.hour, sp: m.sp, stage, capCm, basket: this.basket, container: this.container });
      if (issues.length) {
        const ok = await confirmDialog(`⚠ Raccolta non consentita:\n• ${issues.join('\n• ')}\n\nSe le guardie forestali ti controllano rischi multa e sequestro. Raccogliere comunque?`, 'Raccogli comunque', 'Lascia stare');
        if (!ok) res.picked = false;
      }
    }
    if (res.picked && this.umbrellaOpen) { this.umbrellaOpen = false; toast('Chiudi l\'ombrello per avere le mani libere.', 'info', 2000); }
    if (res.picked) {
      const hasKnife = hasItem(this.state, 'coltello');
      let quality = stage === 'giovane' ? 0.95 : stage === 'maturo' ? 1 : 0.5;
      if (m.eaten) quality -= 0.3;
      if (m.slugs) quality -= 0.2;
      if (!hasKnife) quality -= 0.1;
      if (this.container === 'sacchetto') quality -= 0.15; // nel sacchetto i funghi sudano e si rovinano
      if (sp.delicate && this.basketKg() / this.cap.kg > 0.7) { quality -= 0.15; toast('Il cestino è pieno: gli esemplari delicati si schiacciano.', 'warn'); }
      const weight = Math.round(sp.weight * gs ** 2.5 * (stage === 'vecchio' ? 0.85 : 1));
      this.basket.push({ sp: m.sp, guess: res.guess, weight, quality: clamp(quality, 0.1, 1), stage, capCm, mid: m.id, hour: this.hour, biome: cell.biome, zone: cell.zone, issues });
      removeMushroom(this.eco, m.id);
      this.mushGroup.remove(mesh); this.mushMeshes.delete(m.id);
      this.rebuildCoverLeaves();
      audio.pick();
      toast(`🧺 Raccolto: ${res.guess ? SPECIES_BY_ID[res.guess].name + '?' : 'esemplare non identificato'} (${weight} g)`, 'info', 2500);
    }
    this.modal = null;
    this.player.keys.clear();
    setTimeout(() => this.player.lock(), 50);
  }

  // --------------------------------------------------------------------------
  handleKey(e) {
    if (this.ending) return;
    if (this.modal === 'inspect') return;
    if (e.code === 'Escape') {
      if (this.modal) { this.closeModal(); return; }
      if (this.paused) { this.resume(); return; }
      return; // la pausa si apre al rilascio del puntatore
    }
    if (this.paused) return;
    if (e.code === 'KeyM') { e.preventDefault(); this.modal === 'map' ? this.closeModal() : this.openMap(); return; }
    if (e.code === 'Tab') { e.preventDefault(); this.modal === 'basket' ? this.closeModal() : this.openBasket(); return; }
    if (this.modal) return;
    if (e.code === 'KeyE') {
      if (this.target) this.examine(this.target);
      else if (this.talkRanger && this.talkRanger.state === 'patrol') this.talkToRanger(this.talkRanger);
      else if (this.nearCar) this.endAtCar();
    }
    if (e.code === 'KeyU') {
      if (!hasItem(this.state, 'ombrello')) toast('Non hai un ombrello nello zaino.', 'warn', 2000);
      else { this.umbrellaOpen = !this.umbrellaOpen; audio.click(); }
    }
    if (e.code === 'KeyR') {
      if (this.thermosUses > 0) {
        this.thermosUses--;
        this.stamina = Math.min(100, this.stamina + 40); this.comfort = Math.min(100, this.comfort + 30);
        toast(`☕ Un sorso di tè caldo: ti senti meglio. (rimasti ${this.thermosUses})`, 'info', 2500);
      } else toast(hasItem(this.state, 'thermos') ? 'Il thermos è vuoto.' : 'Non hai un thermos.', 'warn', 2000);
    }
    if (e.code === 'KeyT') {
      if (hasItem(this.state, 'torcia')) { this.torchOn = !this.torchOn; audio.click(); } else toast('Non hai una torcia frontale nello zaino.', 'warn', 2000);
    }
    if (e.code === 'KeyG') {
      if (!hasItem(this.state, 'gps')) { toast('Serve un GPS portatile per salvare i punti.', 'warn', 2000); return; }
      const list = (this.state.poi[this.region.id] ||= []);
      const p = this.player.pos;
      list.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), day: this.state.day, label: `Punto ${list.length + 1}` });
      if (list.length > 30) list.shift();
      toast(`📍 Punto salvato (Punto ${list.length}).`, 'info', 2000);
    }
    if (e.code === 'KeyH') this.toggleReadings();
  }

  toggleReadings() {
    const r = this.readings;
    if (!r.classList.contains('hidden')) { r.classList.add('hidden'); return; }
    const p = this.player.pos;
    const cell = this.world.cellAt(p.x, p.z);
    const rd = cellReadings(this.world, this.eco, this.state.weather, cell, this.state.day, this.region);
    this.habitatCells.add(cell.idx);
    const lvl = skillLevel(this.state.skills.habitat);
    const fmt = (v) => (lvl >= 2 ? `${Math.round(v)}%` : v > 70 ? 'alta' : v > 40 ? 'media' : 'bassa');
    clear(r);
    r.append(el('h4', {}, `Lettura del bosco — ${BIOME_LABEL[cell.biome]}`),
      ...[['Umidità del terreno', rd.moisture], ['Temperatura favorevole', rd.tempFav], ['Idoneità dell\'habitat', rd.habitat], ['Visibilità del sottobosco', rd.visibility]]
        .map(([k, v]) => el('div', { class: 'rd' }, el('span', {}, k), lvl >= 1 ? bar(v, 100) : null, el('b', {}, fmt(v)))),
      el('p', { class: 'muted' }, lvl >= 1 ? 'Indizi ambientali, non una garanzia di raccolta.' : 'Con più esperienza degli habitat le letture diventano precise.'));
    r.classList.remove('hidden');
    setTimeout(() => r.classList.add('hidden'), 9000);
  }

  closeModal() {
    if (this.modalEl) this.modalEl.remove();
    this.modalEl = null; this.modal = null;
    setTimeout(() => this.player.lock(), 30);
  }

  openMap() {
    this.modal = 'map'; this.player.unlock();
    const cv = el('canvas', { width: 640, height: 640, class: 'mapcanvas' });
    const p = this.player.pos;
    const gps = hasItem(this.state, 'gps');
    const orient = skillLevel(this.state.skills.orientamento);
    let player = null;
    if (gps) player = { x: p.x, z: p.z, yaw: this.player.yaw, exact: true };
    else if (orient >= 1) {
      const radius = Math.max(18, 90 - orient * 9);
      player = { x: p.x, z: p.z, radius, ox: (hash2(Math.floor(p.x / 30), Math.floor(p.z / 30), 5) - 0.5) * radius, oz: (hash2(Math.floor(p.x / 30), Math.floor(p.z / 30), 6) - 0.5) * radius };
    }
    drawMap(cv, this.world, { player, poi: this.state.poi[this.region.id] || [], explored: this.state.explored[this.region.id], zones: zoneInfo(this.state, this.region.id) });
    this.modalEl = el('div', { class: 'overlay center' },
      el('div', { class: 'panel map-panel' },
        el('div', { class: 'row between' }, el('h2', {}, `Mappa — ${this.region.name}`), el('button', { class: 'btn ghost', onclick: () => this.closeModal() }, 'Chiudi [M]')),
        cv, mapLegend(),
        el('p', { class: 'muted' }, gps ? 'Il GPS mostra la tua posizione esatta.' : orient >= 1 ? 'Senza GPS: l\'area tratteggiata è la tua stima di posizione (migliora con l\'Orientamento).' : 'Senza GPS non sai dove ti trovi esattamente: orientati con sentieri, torrente e rilievi.')));
    document.body.append(this.modalEl);
  }

  openBasket() {
    this.modal = 'basket'; this.player.unlock();
    const kg = this.basketKg();
    const list = el('div', { class: 'basket-list' });
    if (!this.basket.length) list.append(el('p', { class: 'muted' }, 'Il cestino è vuoto.'));
    for (const b of this.basket) {
      list.append(el('div', { class: 'basket-item' },
        el('b', {}, (b.issues?.length ? '⚠ ' : '') + (b.guess ? `${SPECIES_BY_ID[b.guess].name}?` : 'Non identificato')),
        el('span', {}, `${b.weight} g`), el('span', {}, `Stadio: ${b.stage}`), el('span', {}, `Qualità ${Math.round(b.quality * 100)}%`)));
    }
    this.modalEl = el('div', { class: 'overlay center' },
      el('div', { class: 'panel' },
        el('div', { class: 'row between' }, el('h2', {}, `🧺 ${this.cap.name} — ${kg.toFixed(2)} / ${this.cap.kg} kg`), el('button', { class: 'btn ghost', onclick: () => this.closeModal() }, 'Chiudi [Tab]')),
        list,
        el('p', { class: 'muted' }, `Foto scattate: ${this.photos.length}. Limite di raccolta: ${LIMIT_KG} kg di commestibili al giorno.`)));
    document.body.append(this.modalEl);
  }

  openPause() {
    if (this.paused) return;
    this.paused = true;
    const p = this.player.pos;
    const dist = Math.hypot(p.x - this.carPos.x, p.z - this.carPos.z);
    this.pauseEl = el('div', { class: 'overlay center' },
      el('div', { class: 'panel pause' },
        el('h2', {}, 'Pausa'),
        el('p', {}, `${formatDate(this.state.day)} • ${formatTime(this.hour)} • ${this.region.name}`),
        el('p', { class: 'muted' }, `Distanza dall'auto: circa ${Math.round(dist)} m`),
        el('button', { class: 'btn primary', onclick: () => this.resume() }, 'Riprendi'),
        el('button', { class: 'btn', onclick: () => { this.resume(); setTimeout(() => this.openMap(), 60); } }, 'Mappa'),
        el('button', { class: 'btn', onclick: () => { this.resume(); setTimeout(() => this.openBasket(), 60); } }, 'Cestino'),
        el('button', { class: 'btn', onclick: () => this.walkBack(dist) }, 'Torna all\'auto e termina'),
        el('div', { class: 'settings-mini' },
          el('label', {}, 'Sensibilità mouse ', el('input', { type: 'range', min: 0.3, max: 2.5, step: 0.1, value: this.state.settings.sensitivity, oninput: (e) => { this.state.settings.sensitivity = +e.target.value; this.player.sensitivity = +e.target.value; } })),
          el('label', {}, 'Volume ', el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: this.state.settings.volume, oninput: (e) => { this.state.settings.volume = +e.target.value; audio.setVolume(+e.target.value); } })),
          el('label', {}, 'Velocità del tempo ', el('select', { onchange: (e) => { this.state.settings.timeScale = +e.target.value; } },
            [6, 12, 24, 48].map((v) => el('option', { value: v, selected: this.state.settings.timeScale === v ? '' : null }, `x${v}`)))),
          el('label', {}, 'Ombre ', el('input', { type: 'checkbox', checked: this.state.settings.shadows !== false ? '' : null, onchange: (e) => {
            this.state.settings.shadows = e.target.checked;
            applyQuality(this.app.viewer, this.state.settings);
            this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
          } })),
          el('label', {}, 'Qualità grafica ', el('select', { onchange: (e) => {
            this.state.settings.quality = e.target.value;
            applyQuality(this.app.viewer, this.state.settings);
            configureShadows(this.app.viewer, this.atmo.sun, e.target.value);
          } }, [['bassa', 'Bassa'], ['media', 'Media'], ['alta', 'Alta'], ['ultra', 'Ultra']].map(([v, l]) => el('option', { value: v, selected: (this.state.settings.quality || 'alta') === v ? '' : null }, l)))),
          el('label', {}, 'Risoluzione ', el('select', { onchange: (e) => { this.state.settings.resolution = e.target.value; this.app.applyPixelRatio(); } },
            RESOLUTIONS.map(([v, l]) => el('option', { value: v, selected: (this.state.settings.resolution || 'auto') === v ? '' : null }, l)))),
          )));
    document.body.append(this.pauseEl);
  }

  resume() {
    if (this.pauseEl) this.pauseEl.remove();
    this.pauseEl = null; this.paused = false;
    setTimeout(() => this.player.lock(), 30);
  }

  async walkBack(dist) {
    const minutes = Math.round(dist / 1.4 / 60 * 1.3);
    const ok = await confirmDialog(`Il rientro a piedi richiederà circa ${minutes} minuti. Terminare la spedizione?`, 'Rientra');
    if (!ok) return;
    if (this.pauseEl) this.pauseEl.remove();
    this.paused = false;
    this.hour += minutes / 60;
    this.player.distance += dist;
    this.finish({ walked: true });
  }

  finish({ rescued = false } = {}) {
    if (this.ending) return;
    this.ending = true;
    this.player.unlock();
    const st = sunTimes(this.state.day);
    const result = {
      basket: this.basket.slice(), photos: this.photos.slice(), found: [...this.found.values()],
      distance: this.player.distance, duration: this.hour - this.startHour, startHour: this.startHour, endHour: this.hour,
      weatherType: this.rec.type, rec: this.rec, prevRain: [1, 2, 3, 4, 5].reduce((a, k) => a + regionalDay(this.state.weather, this.state.day - k, this.region).rain, 0),
      soil: this.eco.soil[this.state.day], returnedBeforeDark: this.hour < st.sunset + 0.25 && !rescued, rescued,
      habitatChecks: this.habitatCells.size, fogMinutes: this.fogMinutes, usedGps: this.usedGps, checkedForecast: this.checkedForecast,
      zones: [...this.zonesVisited], regionId: this.region.id, ranger: this.rangerLog,
    };
    if (rescued) {
      result.basket = result.basket.filter((_, i) => i % 2 === 0);
      toast('🚑 Il soccorso alpino ti ha trovato e riportato all\'auto. Hai perso parte del raccolto.', 'danger', 6000);
    }
    saveGame(this.state);
    setTimeout(() => this.app.finishExpedition(result), rescued ? 1200 : 200);
  }

  render() { /* il rendering è gestito dalla pipeline di threepipe */ }

  // --------------------------------------------------------------------------
  onZoneChange(zid) {
    const z = ZONE_BY_ID[zid];
    const lic = licenseFor(this.state, zid, this.state.day);
    const canPick = this.free || pickingAllowedHere(this.state, zid);
    clear(this.zoneEl);
    this.zoneEl.append(el('b', {}, z.name), el('span', { class: canPick ? 'ok' : 'ko' }, canPick ? ` • ${lic ? lic.name : 'modalità libera'}` : lic ? ' • solo fotografie' : ' • senza permesso: raccolta vietata'));
    if (this._zoneToasted) toast(`📍 Entri in: ${z.name}${canPick ? '' : ' — non puoi raccogliere qui'}`, canPick ? 'info' : 'warn', 3500);
    this._zoneToasted = true;
  }

  async runRangerCheck(ranger, where) {
    this.modal = 'ranger';
    this.player.unlock();
    const res = rangerInspection(this.state, this);
    if (res.confiscate.size) this.basket = this.basket.filter((b) => !res.confiscate.has(b.mid));
    this.rangerLog.checks++; this.rangerLog.fines += res.fine; this.rangerLog.confiscated += res.confiscate.size;
    this.state.reputation = clamp(this.state.reputation + (res.passed ? 2 : -6), 0, 100);
    this.state.rangerStats ||= { checks: 0, fines: 0 };
    this.state.rangerStats.checks++; this.state.rangerStats.fines += res.fine;
    audio.click();
    await openRangerCheck(res, ranger?.name || 'Agente del Corpo Forestale', where);
    if (ranger) this.rangers.release(ranger, this.hour);
    this.modal = null;
    this.player.keys.clear();
    setTimeout(() => this.player.lock(), 50);
  }

  talkToRanger(r) {
    const z = ZONE_BY_ID[this.currentZone];
    const lic = licenseFor(this.state, z.id, this.state.day);
    const tips = [
      'I funghi si puliscono sul posto e si portano in un cestino: le spore devono poter cadere.',
      'Non usate mai rastrelli: rovinano il micelio e la lettiera.',
      'Con il temporale state lontani dalle radure e dagli alberi isolati.',
      'Le zone più alte si aprono a chi ha esperienza: continuate a esplorare.',
      'Se non siete sicuri di un fungo, fotografatelo e lasciatelo dov\'è.',
    ];
    toast(`👮 ${r.name}: «Qui siamo in ${z.name}. ${rulesSummary(z).join(', ')}. ${lic ? 'Il suo permesso è valido.' : 'Senza permesso può solo passeggiare e fotografare.'} ${tips[Math.floor(Math.random() * tips.length)]}»`, 'info', 9000);
    this.rangers.release(r, this.hour - 1.5); // una chiacchierata non vale come controllo
  }

  async endAtCar() {
    // controllo a campione al parcheggio
    const weekend = dayOfWeek(this.state.day) >= 5;
    if (!this.free && !this.parkingChecked && Math.random() < (weekend ? 0.4 : 0.25)) {
      this.parkingChecked = true;
      toast('👮 Al parcheggio c\'è una pattuglia del Corpo Forestale…', 'warn', 3000);
      await this.runRangerCheck(null, 'parcheggio');
    }
    this.finish({});
  }

  buildBarriers(scene) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#d42a1e'; g.fillRect(0, i * 16, 16, 16); }
    const stripes = new THREE.CanvasTexture(c); stripes.colorSpace = THREE.SRGBColorSpace;
    const barMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5 });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#5a3e26', roughness: 0.9 });
    const signMat = new THREE.MeshStandardMaterial({ color: '#e8d48a', roughness: 0.8 });
    this.barriers = new THREE.Group();
    for (const cr of this.world.zoneCrossings) {
      const locked = !zoneUnlocked(this.state, cr.a) || !zoneUnlocked(this.state, cr.b);
      if (!locked) continue;
      const g2 = new THREE.Group();
      const y = this.world.heightAt(cr.x, cr.z);
      for (const s of [-1.7, 1.7]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 8), woodMat);
        post.position.set(0, 0.55, s); g2.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.6, 8), barMat);
      bar.rotation.x = Math.PI / 2; bar.position.y = 0.95; g2.add(bar);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.7), signMat); sign.position.set(0, 1.35, 1.7); g2.add(sign);
      g2.position.set(cr.x, y, cr.z);
      g2.rotation.y = -cr.dir;
      g2.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.barriers.add(g2);
    }
    scene.add(this.barriers);
  }

  buildHandProps(scene) {
    // ombrello
    const u = new THREE.Group();
    const fabric = new THREE.MeshStandardMaterial({ color: '#1f3d5c', roughness: 0.6, side: THREE.DoubleSide });
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.24, 8, 1, true), fabric);
    canopy.position.y = 1.02;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.22, 6), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.4 }));
    shaft.position.y = 0.61;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: '#4a2e1a' }));
    handle.rotation.z = Math.PI; handle.position.set(0.04, 0.02, 0);
    u.add(canopy, shaft, handle);
    u.visible = false;
    this.umbrellaMesh = u;
    // torcia in mano
    const t = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 10), new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.5, roughness: 0.4 }));
    body.rotation.x = Math.PI / 2;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 12), new THREE.MeshBasicMaterial({ color: '#fff8e0' }));
    lens.position.z = -0.081; lens.rotation.y = Math.PI;
    t.add(body, lens);
    t.visible = false;
    this.torchMesh = t;
    scene.add(u, t);
  }

  updateHandProps(cond, dt) {
    const cam = this.camera;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
    this.player.noRun = this.umbrellaOpen;
    this.umbrellaMesh.visible = this.umbrellaOpen;
    if (this.umbrellaOpen) {
      const off = new THREE.Vector3(0.18, -0.55, -0.34).applyQuaternion(yawQ);
      this.umbrellaMesh.position.copy(cam.position).add(off);
      this.umbrellaMesh.quaternion.copy(yawQ);
      const sway = Math.sin(envUniforms.uTime.value * 3) * cond.wind * 0.12;
      this.umbrellaMesh.rotateZ(-0.12 + sway); this.umbrellaMesh.rotateX(0.1);
      // il vento forte può rompere l'ombrello
      if (cond.wind > 0.85 && Math.random() < dt * 0.04) {
        this.umbrellaOpen = false;
        this.state.owned = this.state.owned.filter((i) => i !== 'ombrello');
        this.state.loadout = this.state.loadout.filter((i) => i !== 'ombrello');
        toast('💨 Una raffica ha rovesciato e rotto l\'ombrello!', 'danger', 4000);
      }
    }
    this.torchMesh.visible = this.torchOn;
    if (this.torchOn) {
      const off = new THREE.Vector3(0.2, -0.2, -0.42).applyQuaternion(cam.quaternion);
      this.torchMesh.position.copy(cam.position).add(off);
      this.torchMesh.quaternion.copy(cam.quaternion);
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.app.renderer.domElement.removeEventListener('click', this.onClickCanvas);
    this.player.dispose();
    this.hud.remove();
    if (this.modalEl) this.modalEl.remove();
    if (this.pauseEl) this.pauseEl.remove();
    this.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isLineSegments || o.isPoints) {
        if (o.geometry && !o.geometry.userData?.shared && o.parent !== this.mushGroup) o.geometry.dispose();
      }
    });
    this.atmo.dispose();
    const vs = this.app.viewer.scene;
    vs.environment = null;
    this.scene.removeFromParent();
    vs.fog = null;
    detachShadows(this.app.viewer);
    vs.setDirty({ refreshScene: true });
    audio.update(0.1, { rain: 0, wind: 0, streamDist: 999, daylight: 0, snow: 0, indoor: true });
  }
}

function zoneInfo(state, regionId) {
  const zs = ZONES_ALL[regionId];
  return { unlocked: new Set(zs.filter((z) => zoneUnlocked(state, z.id)).map((z) => z.id)), licensed: new Set(zs.filter((z) => licenseFor(state, z.id, state.day)).map((z) => z.id)) };
}

function toolIcon(id) {
  return { coltello: '🔪', guida: '📖', lente: '🔎', bussola: '🧭', gps: '📡', torcia: '🔦', macchina_foto: '📷', ombrello: '☂', bastone: '🦯', thermos: '☕', rastrello: '🧹' }[id] || '•';
}
