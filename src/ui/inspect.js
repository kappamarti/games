// Modalità di osservazione: modello 3D ruotabile, osservazioni per parte, ipotesi di identificazione,
// fotografia e raccolta.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { el, clear, confirmDialog } from './dom.js';
import { mushroomMaterial } from '../render/mushroomMesh.js';
import { groundDetailTexture } from '../render/textures.js';
import { observe, candidates } from '../game/describe.js';
import { EDIBILITY, RARITY, STAGE_LABEL, SPECIES } from '../data/species.js';
import { stars } from './dom.js';
import { audio } from '../core/audio.js';

const ASPECTS = [
  ['cappello', 'Cappello', '🍄'], ['sotto', 'Parte inferiore', '🔍'], ['gambo', 'Gambo', '│'], ['base', 'Base', '⛏'], ['habitat', 'Habitat', '🌲'],
];

let viewer = null;
function getViewer() {
  if (viewer) return viewer;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const cam = new THREE.PerspectiveCamera(35, 1, 0.005, 20);
  const key = new THREE.DirectionalLight('#fff3e0', 2.2); key.position.set(0.4, 0.8, 0.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.1, far: 3 });
  scene.add(key, new THREE.HemisphereLight('#cfe0ff', '#5a4630', 0.7));
  const detail = groundDetailTexture(); detail.repeat.set(3, 3);
  const groundMat = new THREE.MeshStandardMaterial({ color: '#5a4026', roughness: 1, map: detail });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(0.45, 48), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const holder = new THREE.Group(); scene.add(holder);
  viewer = { renderer, scene, cam, ground, holder, groundMat };
  return viewer;
}

/**
 * Apre l'ispezione. Ritorna una Promise con { picked, photo, guess }.
 */
export function openInspect(ctx) {
  return new Promise((resolve) => {
    const v = getViewer();
    const { sp, geo, scale, hasGuide, knownIds, skills, biomeColor } = ctx;
    const observed = {};
    let guess = ctx.prevGuess || null;
    let photo = null;
    let target = new THREE.Vector3(0, 0.05, 0);
    let az = 0.6, el2 = 0.35, dist = 0.45;
    let goal = null;

    v.holder.clear();
    const mesh = new THREE.Mesh(geo, mushroomMaterial());
    mesh.castShadow = true;
    mesh.scale.setScalar(scale);
    v.holder.add(mesh);
    v.groundMat.color.set(biomeColor || '#5a4026');
    const bb = new THREE.Box3().setFromObject(mesh);
    const h = bb.max.y, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    target.set(0, h * 0.5, 0);
    v.ground.scale.setScalar(Math.min(1, Math.max(h, w) * 3.5 / 0.45));
    dist = Math.max(0.12, Math.max(h, w) * 2.4);
    const sink = ctx.baseHidden && !ctx.hasKnife ? Math.min(0.02, h * 0.15) : 0;
    mesh.position.y = -sink;
    v.ground.visible = true;

    const canvasWrap = el('div', { class: 'insp-view' });
    canvasWrap.append(v.renderer.domElement);
    const obsList = el('div', { class: 'obs-list' });
    const candBox = el('div', { class: 'cand-box' });
    const confBox = el('div', { class: 'conf' });
    const photoBtn = el('button', { class: 'btn', onclick: takePhoto }, '📷 Fotografa');
    const pickBtn = el('button', { class: 'btn primary', onclick: pick }, ctx.canPick ? '🧺 Raccogli' : '🧺 Raccogli (cestino pieno)');
    if (!ctx.canPick) pickBtn.disabled = true;
    const leaveBtn = el('button', { class: 'btn ghost', onclick: () => close(false) }, 'Lascia nel bosco [Esc]');

    const viewsRow = el('div', { class: 'views' },
      el('button', { class: 'chip', onclick: () => setView('top') }, 'Dall\'alto'),
      el('button', { class: 'chip', onclick: () => setView('side') }, 'Di lato'),
      el('button', { class: 'chip', onclick: () => setView('under') }, 'Da sotto'),
      el('button', { class: 'chip', onclick: () => setView('base') }, 'Base'));

    const stageTag = el('span', { class: 'tag' }, `Stadio: ${STAGE_LABEL[ctx.stage]}`);
    const root = el('div', { class: 'overlay inspect' },
      el('div', { class: 'insp-left' },
        el('div', { class: 'insp-title' }, el('h2', {}, 'Esemplare sconosciuto'), stageTag, ctx.photoTaken ? el('span', { class: 'tag' }, 'già fotografato') : null),
        canvasWrap, viewsRow,
        el('p', { class: 'hint' }, 'Trascina per ruotare • rotella per avvicinarti • osserva ogni parte prima di decidere')),
      el('div', { class: 'insp-right' },
        el('h3', {}, 'Osservazioni'), obsList,
        el('h3', {}, 'Ipotesi di identificazione'), confBox, candBox,
        el('div', { class: 'row actions' }, photoBtn, pickBtn, leaveBtn)));
    document.body.append(root);

    function renderObs() {
      clear(obsList);
      for (const [k, label, icon] of ASPECTS) {
        const done = observed[k];
        const item = el('div', { class: `obs ${done ? 'done' : ''}` },
          el('button', { class: 'obs-btn', onclick: () => doObserve(k) }, `${icon} ${label}`),
          done ? el('p', {}, observed[k]) : el('p', { class: 'muted' }, 'Non ancora osservato'));
        obsList.append(item);
      }
    }
    function doObserve(k) {
      audio.click();
      observed[k] = observe(k, ctx);
      if (k === 'base') { ctx.baseRevealed = !(ctx.baseHidden && !ctx.hasKnife); if (ctx.baseRevealed) mesh.position.y = 0.004; }
      if (k === 'habitat') ctx.onHabitat?.();
      setView({ cappello: 'top', sotto: 'under', gambo: 'side', base: 'base', habitat: 'far' }[k]);
      renderObs(); renderCands();
    }
    function renderCands() {
      clear(candBox);
      const pool = hasGuide ? SPECIES : SPECIES.filter((s) => knownIds.includes(s.id));
      if (!pool.length) {
        candBox.append(el('p', { class: 'muted' }, 'Senza la guida micologica puoi scegliere solo tra specie già verificate dal centro micologico. Fotografa o raccogli: il micologo ti dirà di cosa si tratta.'));
        confBox.textContent = '';
        return;
      }
      const list = candidates(pool, sp, observed, ctx.baseRevealed);
      const nObs = Object.keys(observed).length;
      const certainty = Math.min(1, (nObs / 5) * 0.65 + (list.length ? 1 / list.length : 0) * 0.3 + (skills.micologia || 0) * 0.01);
      const lbl = certainty > 0.8 ? 'alta' : certainty > 0.5 ? 'media' : 'bassa';
      confBox.innerHTML = '';
      confBox.append(el('span', {}, `Specie compatibili con le osservazioni: ${list.length}${!hasGuide ? ' (tra quelle conosciute)' : ''} — certezza ${lbl}`),
        el('div', { class: `bar conf-${lbl}` }, el('div', { class: 'bar-fill', style: { width: `${certainty * 100}%` } })));
      if (!list.length) { candBox.append(el('p', { class: 'muted' }, 'Nessuna specie conosciuta corrisponde. Potrebbe essere una specie nuova per te.')); }
      const micLvl = skills.micologia || 0;
      for (const c of list.slice(0, 12)) {
        const ed = EDIBILITY[c.edibility];
        const sel = guess === c.id;
        const card = el('div', { class: `cand ${sel ? 'sel' : ''}`, onclick: () => { guess = sel ? null : c.id; audio.click(); renderCands(); } },
          el('div', { class: 'cand-head' }, el('b', {}, c.name), el('i', {}, ` ${c.latin}`), el('span', { class: 'ed', style: { color: ed.color } }, ed.label)),
          sel ? el('div', { class: 'cand-body' },
            el('p', {}, el('b', {}, 'Cappello: '), c.look.cappello),
            el('p', {}, el('b', {}, 'Sotto: '), c.look.sotto),
            el('p', {}, el('b', {}, 'Gambo: '), c.look.gambo),
            el('p', {}, el('b', {}, 'Base: '), c.look.base),
            el('p', {}, el('b', {}, 'Habitat: '), c.look.habitat),
            micLvl >= 3 && c.lookalike.length ? el('p', { class: 'muted' }, `Attenzione a confonderlo con: ${c.lookalike.map((id) => SPECIES.find((s) => s.id === id).name).join(', ')}`) : null,
            el('p', { class: 'muted' }, `Rarità ${stars(RARITY[c.rarity].stars)}`)) : null);
        candBox.append(card);
      }
      if (list.length > 12) candBox.append(el('p', { class: 'muted' }, `…e altre ${list.length - 12}. Osserva altre parti per restringere.`));
    }

    function setView(name) {
      const map = { top: [az, 1.25, 1], side: [az, 0.15, 1], under: [az, -0.55, 0.8], base: [az, 0.05, 0.6], far: [az, 0.5, 2.2] };
      const p = map[name] || map.side;
      goal = { az: p[0], el: p[1], dist: Math.max(0.12, Math.max(h, w) * 2.4) * p[2], ty: name === 'base' ? h * 0.12 : name === 'under' ? h * 0.65 : h * 0.5 };
    }

    // interazione col mouse
    let dragging = false, lx = 0, ly = 0;
    const cnv = v.renderer.domElement;
    const onDown = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; goal = null; };
    const onMove = (e) => { if (!dragging) return; az -= (e.clientX - lx) * 0.01; el2 = Math.max(-1.2, Math.min(1.45, el2 + (e.clientY - ly) * 0.01)); lx = e.clientX; ly = e.clientY; };
    const onUp = () => { dragging = false; };
    const onWheel = (e) => { e.preventDefault(); dist = Math.max(0.06, Math.min(2, dist * (1 + Math.sign(e.deltaY) * 0.1))); goal = null; };
    cnv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cnv.addEventListener('wheel', onWheel, { passive: false });
    const onKey = (e) => { if (e.code === 'Escape') { e.preventDefault(); close(false); } };
    window.addEventListener('keydown', onKey);

    let running = true;
    function resize() {
      const r = canvasWrap.getBoundingClientRect();
      v.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      v.renderer.setSize(Math.max(10, r.width), Math.max(10, r.height), false);
      v.cam.aspect = r.width / Math.max(1, r.height); v.cam.updateProjectionMatrix();
    }
    function placeCam() {
      v.cam.position.set(target.x + Math.cos(az) * Math.cos(el2) * dist, target.y + Math.sin(el2) * dist, target.z + Math.sin(az) * Math.cos(el2) * dist);
      v.cam.lookAt(target);
    }
    let tPrev = performance.now();
    function frame() {
      if (!running) return;
      const now = performance.now(); const dt = Math.min(0.05, (now - tPrev) / 1000); tPrev = now;
      if (goal) {
        const k = 1 - Math.exp(-dt * 6);
        az += (goal.az - az) * k; el2 += (goal.el - el2) * k; dist += (goal.dist - dist) * k; target.y += (goal.ty - target.y) * k;
      } else if (!dragging) az += dt * 0.15;
      placeCam();
      v.renderer.render(v.scene, v.cam);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(() => { resize(); frame(); });
    window.addEventListener('resize', resize);

    function takePhoto() {
      resize(); placeCam();
      v.scene.background = new THREE.Color(ctx.biomeColor || '#3a3428').multiplyScalar(0.55);
      v.renderer.render(v.scene, v.cam);
      v.scene.background = null;
      const src = v.renderer.domElement;
      const c = document.createElement('canvas'); c.width = 220; c.height = 165;
      const g = c.getContext('2d');
      const ar = src.width / src.height, tar = 220 / 165;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (ar > tar) { sw = sh * tar; sx = (src.width - sw) / 2; } else { sh = sw / tar; sy = (src.height - sh) / 2; }
      g.drawImage(src, sx, sy, sw, sh, 0, 0, 220, 165);
      photo = { img: c.toDataURL('image/jpeg', 0.72) };
      audio.shutter();
      canvasWrap.classList.add('flash'); setTimeout(() => canvasWrap.classList.remove('flash'), 180);
      photoBtn.textContent = '📷 Fotografato ✓';
    }
    async function pick() {
      if (guess) {
        const g = SPECIES.find((s) => s.id === guess);
        if (!EDIBILITY[g.edibility].value) {
          const ok = await confirmDialog(`Hai identificato questo esemplare come ${g.name} (${EDIBILITY[g.edibility].label.toLowerCase()}). Raccoglierlo può contaminare il cestino. Vuoi davvero raccoglierlo?`, 'Raccogli comunque', 'No, lascialo');
          if (!ok) return;
        }
      }
      close(true);
    }
    function close(picked) {
      running = false;
      cnv.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cnv.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', resize);
      root.remove();
      resolve({ picked, photo: photo ? { ...photo, guess } : null, guess, observedCount: Object.keys(observed).length });
    }
    renderObs(); renderCands();
  });
}
