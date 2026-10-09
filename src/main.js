import * as THREE from 'three';
import { runGallery } from './dev/mushroomGallery.js';
import { newGame, loadGame, saveGame, hasSave, deleteSave, processExpedition, refreshMissions } from './game/state.js';
import { Expedition } from './game/expedition.js';
import { Baita, reportView } from './ui/baita.js';
import { el, clear, toast, confirmDialog } from './ui/dom.js';
import { SPECIES_BY_ID, EDIBILITY } from './data/species.js';
import { formatTime, seasonOf, formatDate } from './data/calendar.js';
import { WEATHER_TYPES } from './sim/weather.js';
import { audio } from './core/audio.js';
import { createViewer, applyQuality, defaultQuality } from './render/pipeline.js';

class App {
  constructor() {
    const canvas = document.createElement('canvas');
    canvas.classList.add('game-canvas');
    document.getElementById('app').append(canvas);
    this.viewer = createViewer(canvas);
    this.renderer = this.viewer.renderManager.renderer;
    this.camera = this.viewer.scene.mainCamera;
    this.state = null; this.exp = null; this.baita = null; this.screen = null;
    this.clock = new THREE.Clock();
    // il ciclo di gioco gira dentro il ciclo di rendering di threepipe
    this.viewer.addEventListener('preFrame', () => this.loop());
    this.viewer.renderEnabled = false;
    addEventListener('resize', () => { if (this.state) applyQuality(this.viewer, this.state.settings); });
    this.toTitle();
  }

  applyPixelRatio() {
    if (this.state) applyQuality(this.viewer, this.state.settings);
  }

  loop() {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.exp) {
      this.exp.update(dt);
      this.viewer.setDirty();
    }
  }

  clearScreens() {
    if (this.baita) { this.baita.dispose(); this.baita = null; }
    if (this.screen) { this.screen.remove(); this.screen = null; }
  }

  toTitle() {
    if (this.state) saveGame(this.state);
    this.clearScreens();
    if (this.exp) { this.exp.dispose(); this.exp = null; }
    const save = hasSave() ? loadGame() : null;
    const nameIn = el('input', { type: 'text', value: 'Cercatore', maxlength: 20, class: 'name-in' });
    this.screen = el('div', { class: 'title-screen' },
      el('div', { class: 'title-card' },
        el('div', { class: 'title-logo' }, '🍄'),
        el('h1', {}, 'Mushroom Hunter'),
        el('p', { class: 'subtitle' }, 'Il simulatore di raccolta funghi'),
        el('p', {}, 'Leggi il bosco, interpreta il meteo, studia alberi e terreno. Trova, osserva e identifica decine di specie — e torna a casa prima del buio.'),
        save ? el('button', { class: 'btn primary big', onclick: () => this.continueGame(save) }, `▶ Continua — ${save.name}, ${formatDate(save.day)}`) : null,
        el('div', { class: 'row center gap' }, nameIn, el('button', { class: `btn ${save ? '' : 'primary'} big`, onclick: async () => {
          if (save && !(await confirmDialog('Iniziare una nuova partita? Il salvataggio attuale verrà sovrascritto.', 'Nuova partita'))) return;
          deleteSave(); this.state = newGame(nameIn.value.trim() || 'Cercatore'); saveGame(this.state); audio.init(); this.toBaita();
        } }, '✦ Nuova partita')),
        el('details', { class: 'howto' }, el('summary', {}, 'Come si gioca'),
          el('ul', {},
            el('li', {}, 'Dalla baita pianifichi: consulta il bollettino, scegli regione, orario e attrezzatura.'),
            el('li', {}, 'Nel bosco: WASD per muoverti, mouse per guardare (clic per catturare il puntatore, oppure tasto destro trascinato), Shift per correre, C per accovacciarti.'),
            el('li', {}, 'Nessun fungo è evidenziato: cerca davvero. Quando il mirino si illumina su un esemplare premi E per esaminarlo.'),
            el('li', {}, 'Osserva cappello, parte inferiore, gambo, base e habitat, poi formula un\'ipotesi. Fotografa o raccogli.'),
            el('li', {}, 'Torna all\'auto (P sulla mappa) e premi E: il centro micologico verifica il raccolto.'),
            el('li', {}, 'Il meteo ha memoria: i funghi crescono giorni dopo le piogge giuste, con temperature e alberi adatti.'))),
        el('p', { class: 'disclaimer' }, '⚠ È una simulazione. Non usarla mai per identificare funghi reali.')));
    document.body.append(this.screen);
  }

  continueGame(save) {
    this.state = save;
    const def = newGame(save.name);
    this.state.settings = { ...def.settings, ...(save.settings || {}) };
    this.state.licenses ||= {};
    this.state.rangerStats ||= { checks: 0, fines: 0 };
    audio.init();
    audio.setVolume(this.state.settings.volume);
    this.toBaita();
  }

  toBaita() {
    if (!this.state.settings.quality) this.state.settings.quality = defaultQuality(this.viewer);
    this.applyPixelRatio();
    this.viewer.renderEnabled = false;
    this.clearScreens();
    this.baita = new Baita(this, this.state);
  }

  startExpedition(opts) {
    this.clearScreens();
    this.screen = el('div', { class: 'loading' }, el('div', { class: 'spinner' }), el('p', {}, 'Ti incammini verso il bosco…'), el('small', {}, 'Generazione della foresta e simulazione dell\'ecosistema'));
    document.body.append(this.screen);
    setTimeout(() => {
      try {
        this.exp = new Expedition(this, this.state, opts);
        this.viewer.renderEnabled = true;
      } catch (e) {
        console.error(e);
        toast('Errore nella generazione della spedizione: ' + e.message, 'danger', 8000);
        this.toBaita();
        return;
      }
      this.screen.remove(); this.screen = null;
    }, 60);
  }

  finishExpedition(result) {
    const s = this.state;
    const report = processExpedition(s, result);
    // diario
    const counts = {};
    for (const b of result.basket) counts[b.sp] = (counts[b.sp] || 0) + 1;
    for (const p of result.photos) if (!counts[p.sp]) counts[p.sp] = 0;
    s.diary.push({
      n: s.diary.length + 1, day: s.day, season: seasonOf(s.day), regionId: result.regionId, duration: Math.max(0, result.duration),
      weatherType: result.weatherType, tMin: result.rec.tMin, tMax: result.rec.tMax, prevRain: result.prevRain, soil: result.soil ?? 50,
      counts, speciesCount: new Set([...result.basket.map((b) => b.sp), ...result.photos.map((p) => p.sp)]).size,
      newSpecies: report.newSpecies, kg: result.basket.reduce((a, b) => a + b.weight, 0) / 1000, distance: result.distance, zones: result.zones,
    });
    if (s.diary.length > 120) s.diary.shift();
    s.lastReport = report;
    if (this.exp) { this.exp.dispose(); this.exp = null; }
    const day = s.day;
    this.nextDay();
    this.showResults(result, report, day);
  }

  showResults(result, report, day) {
    this.clearScreens();
    const s = this.state;
    const rows = result.basket.map((b) => {
      const sp = SPECIES_BY_ID[b.sp];
      const ed = EDIBILITY[sp.edibility];
      const ok = b.guess === b.sp;
      return el('tr', {},
        el('td', {}, sp.name), el('td', {}, b.guess ? (ok ? '✓' : `✗ (${SPECIES_BY_ID[b.guess].name})`) : '—'),
        el('td', { style: { color: ed.color } }, ed.label), el('td', {}, `${b.weight} g`), el('td', {}, `${Math.round(b.quality * 100)}%`));
    });
    const wt = WEATHER_TYPES[result.weatherType];
    this.screen = el('div', { class: 'results' },
      el('div', { class: 'panel results-panel' },
        el('h2', {}, `Rientro e analisi — ${formatDate(day)}`),
        el('p', { class: 'muted' }, `${wt.icon} ${wt.label} • ${formatTime(result.startHour)} → ${formatTime(result.endHour)} • ${(result.distance / 1000).toFixed(2)} km percorsi • ${result.photos.length} foto`),
        result.basket.length ? el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ['Specie (verificata)', 'Tua identificazione', 'Commestibilità', 'Peso', 'Qualità'].map((h) => el('th', {}, h)))), el('tbody', {}, rows))
          : el('p', { class: 'muted' }, 'Cestino vuoto.'),
        result.photos.length ? el('div', { class: 'photo-row' }, result.photos.map((p) => el('figure', {}, el('img', { src: p.img }), el('figcaption', {}, SPECIES_BY_ID[p.sp].name)))) : null,
        el('h3', {}, 'Referto del centro micologico'),
        reportView(report),
        el('div', { class: 'row end' }, el('button', { class: 'btn primary big', onclick: () => this.toBaita() }, 'Torna alla baita →'))));
    document.body.append(this.screen);
    saveGame(s);
  }

  nextDay() {
    const s = this.state;
    s.day += 1;
    s.missions = s.missions.filter((m) => s.day - m.day < 7);
    refreshMissions(s);
    saveGame(s);
  }

  advanceDay() {
    this.nextDay();
    this.state.lastReport = null;
    this.toBaita();
  }
}

const params = new URLSearchParams(location.search);
if (params.get('test') === 'funghi') runGallery();
else window.app = new App();
