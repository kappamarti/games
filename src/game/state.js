// Stato di gioco persistente, competenze, missioni e verifica del raccolto al centro micologico.
import { SPECIES, SPECIES_BY_ID, EDIBILITY } from '../data/species.js';
import { STARTING_OWNED, REGIONS, REGION_BY_ID, EQUIP_BY_ID } from '../data/equipment.js';
import { createWeatherState } from '../sim/weather.js';
import { createEcoState } from '../sim/ecosystem.js';
import { dayOfYear, seasonFactor, seasonOf } from '../data/calendar.js';
import { mulberry32 } from '../core/rng.js';
import { ZONES } from '../data/zones.js';

const SAVE_KEY = 'mushroom-hunter-save-v1';

export const SKILLS = {
  osservazione: { label: 'Osservazione', desc: 'Individui meglio i funghi nascosti: raggio d\'interazione più ampio e intuizioni ("noti qualcosa tra le foglie").' },
  micologia: { label: 'Micologia', desc: 'Riconosci caratteristiche e specie: la guida mostra indizi di compatibilità più precisi.' },
  habitat: { label: 'Conoscenza degli habitat', desc: 'Interpreti terreno, alberi e umidità: sblocca le letture ambientali della zona [H].' },
  orientamento: { label: 'Orientamento', desc: 'Usi mappe e punti di riferimento: stima della posizione sulla mappa anche senza GPS.' },
  pianificazione: { label: 'Pianificazione', desc: 'Scegli regione e momento giusti: previsioni più affidabili e su più giorni.' },
};

export const LIMIT_KG = 3; // limite giornaliero di raccolta per persona (commestibili)

export function skillLevel(xp) { return Math.min(10, Math.floor(Math.sqrt((xp || 0) / 25))); }
export function skillProgress(xp) {
  const l = skillLevel(xp);
  const a = l * l * 25, b = (l + 1) * (l + 1) * 25;
  return l >= 10 ? 1 : ((xp || 0) - a) / (b - a);
}
export function totalXP(state) { return Object.values(state.skills).reduce((a, b) => a + b, 0); }
export function playerLevel(state) { return Math.floor(Math.sqrt(totalXP(state) / 40)); }
export function xpForLevel(l) { return l * l * 40; }

export function newGame(name = 'Cercatore') {
  const seed = Math.floor(Math.random() * 1e9);
  const state = {
    version: 1, name, seed, day: 0, money: 120, reputation: 50,
    mode: 'simulazione', regionId: 'valfonda', unlockedRegions: ['valfonda'],
    owned: [...STARTING_OWNED], loadout: [...STARTING_OWNED],
    skills: { osservazione: 0, micologia: 0, habitat: 0, orientamento: 0, pianificazione: 0 },
    weather: createWeatherState(seed),
    eco: {},
    encyclopedia: {},
    photos: [],
    diary: [],
    missions: [],
    completedMissions: 0,
    poi: {},
    explored: {},
    stats: { expeditions: 0, kgTotal: 0, distance: 0, earned: 0 },
    settings: { timeScale: 12, sensitivity: 1, volume: 0.7, shadows: true },
    lastReport: null,
    licenses: { v_comunale: { id: 'giornaliero', name: 'Tesserino giornaliero (omaggio di benvenuto)', until: 0, allowsPicking: false } },
    rangerStats: { checks: 0, fines: 0 },
  };
  refreshMissions(state);
  return state;
}

export function ecoFor(state, regionId) {
  if (!state.eco[regionId]) state.eco[regionId] = createEcoState(regionId);
  return state.eco[regionId];
}

export function saveGame(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch (e) {
    // spazio esaurito: riduci le foto
    try { state.photos = state.photos.slice(-12); localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch { return false; }
  }
}
export function loadGame() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
export function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

export function entry(state, spId) {
  if (!state.encyclopedia[spId]) state.encyclopedia[spId] = { known: false, collected: 0, photographed: 0, identified: 0, bestWeight: 0, firstDay: null, regions: [] };
  return state.encyclopedia[spId];
}

export function knownSpecies(state) { return SPECIES.filter((s) => state.encyclopedia[s.id]?.known); }

// --- missioni ---------------------------------------------------------------
const MISSION_TEMPLATES = ['specie_diverse', 'consegna', 'foto', 'meteo', 'tossici_foto', 'identificazioni', 'peso'];

export function refreshMissions(state) {
  const rand = mulberry32(state.seed + state.day * 17 + state.completedMissions * 31);
  const doy = dayOfYear(state.day);
  const region = REGION_BY_ID[state.regionId];
  const inSeason = SPECIES.filter((s) => seasonFactor((doy + 4) % 365, s.season) > 0.3 && Object.keys(s.biomes).some((b) => region.biomeWeights[b] || b === 'alta'));
  const edible = inSeason.filter((s) => EDIBILITY[s.edibility].value);
  const toxic = inSeason.filter((s) => !EDIBILITY[s.edibility].value);
  const rare = inSeason.filter((s) => s.rarity === 'rara' || s.rarity === 'moltorara');
  while (state.missions.length < 3) {
    const t = MISSION_TEMPLATES[Math.floor(rand() * MISSION_TEMPLATES.length)];
    if (state.missions.some((m) => m.type === t)) continue;
    let m = null;
    const lvl = playerLevel(state);
    switch (t) {
      case 'specie_diverse': { const n = 3 + Math.min(4, lvl); m = { type: t, n, title: `Biodiversità: registra ${n} specie diverse in una sola uscita`, reward: 25 + n * 8 }; break; }
      case 'consegna': {
        if (!edible.length) continue;
        const sp = edible[Math.floor(rand() * edible.length)];
        const kg = +(Math.max(0.2, Math.min(1.5, (sp.weight * sp.cluster[1]) / 1000 * (0.6 + rand())))).toFixed(1);
        m = { type: t, sp: sp.id, kg, title: `Campione per il centro: consegna ${kg} kg di ${sp.name} in buone condizioni`, reward: Math.round(sp.price * kg * 1.6 + 15) };
        break;
      }
      case 'foto': {
        const pool = rare.length ? rare : inSeason;
        if (!pool.length) continue;
        const sp = pool[Math.floor(rand() * pool.length)];
        m = { type: t, sp: sp.id, title: `Archivio fotografico: fotografa un esemplare di ${sp.name}`, reward: 40 + (sp.rarity === 'moltorara' ? 60 : sp.rarity === 'rara' ? 30 : 0) };
        break;
      }
      case 'meteo': {
        const w = ['nebbia', 'pioggia', 'temporale', 'neve'][Math.floor(rand() * 4)];
        if (w === 'neve' && seasonOf(state.day) !== 'inverno') continue;
        if (w === 'temporale' && seasonOf(state.day) === 'inverno') continue;
        const lbl = { nebbia: 'nella nebbia', pioggia: 'sotto la pioggia', temporale: 'in un giorno di temporale', neve: 'con la neve' }[w];
        m = { type: t, weather: w, title: `Spedizione difficile: completa un'uscita ${lbl} e rientra prima del buio`, reward: 45 };
        break;
      }
      case 'tossici_foto': { if (toxic.length < 2) continue; m = { type: t, n: 2, title: 'Educazione micologica: fotografa 2 specie tossiche senza raccoglierle', reward: 45 }; break; }
      case 'identificazioni': { const n = 3 + Math.min(5, lvl); m = { type: t, n, title: `Occhio esperto: identifica correttamente ${n} esemplari in un'uscita`, reward: 20 + n * 7 }; break; }
      case 'peso': { const kg = 1 + Math.min(1.5, lvl * 0.3); m = { type: t, kg: +kg.toFixed(1), title: `Buona raccolta: rientra con almeno ${kg.toFixed(1)} kg di commestibili in buono stato`, reward: 30 + Math.round(kg * 12) }; break; }
    }
    if (m) { m.id = `${state.day}-${t}-${Math.floor(rand() * 1e5)}`; m.day = state.day; state.missions.push(m); }
  }
}

function checkMission(m, res) {
  switch (m.type) {
    case 'specie_diverse': return res.speciesSeen.size >= m.n;
    case 'consegna': {
      const kg = res.basket.filter((b) => b.sp === m.sp && b.quality >= 0.6).reduce((a, b) => a + b.weight, 0) / 1000;
      return kg >= m.kg;
    }
    case 'foto': return res.photos.some((p) => p.sp === m.sp);
    case 'meteo': {
      const t = res.weatherType;
      const ok = m.weather === 'pioggia' ? (t === 'pioggia' || t === 'pioggia_intensa') : t === m.weather;
      return ok && res.returnedBeforeDark && !res.rescued;
    }
    case 'tossici_foto': {
      const tox = new Set(res.photos.filter((p) => !EDIBILITY[SPECIES_BY_ID[p.sp].edibility].value).map((p) => p.sp));
      const pickedTox = res.basket.some((b) => !EDIBILITY[SPECIES_BY_ID[b.sp].edibility].value);
      return tox.size >= m.n && !pickedTox;
    }
    case 'identificazioni': return res.correctIds >= m.n;
    case 'peso': return res.edibleKgGood >= m.kg;
  }
  return false;
}

// --- verifica al centro micologico -----------------------------------------
/**
 * res: {basket:[{sp, guess, weight, quality, stage, ...}], photos:[{sp, guess, img}], distance, duration, ...}
 */
export function processExpedition(state, res) {
  const report = { lines: [], warnings: [], money: 0, xp: {}, newSpecies: [], missionsDone: [], confiscated: false, fines: 0 };
  const addXP = (k, v) => { if (v <= 0) return; state.skills[k] = (state.skills[k] || 0) + v; report.xp[k] = (report.xp[k] || 0) + v; };
  const lvlBefore = playerLevel(state);
  res.speciesSeen = new Set([...res.basket.map((b) => b.sp), ...res.photos.map((p) => p.sp)]);

  // identificazioni
  let correct = 0, wrong = 0;
  for (const b of res.basket) {
    if (!b.guess) continue;
    if (b.guess === b.sp) { correct++; addXP('micologia', 6 + (SPECIES_BY_ID[b.sp].rarity === 'rara' ? 4 : 0)); }
    else { wrong++; report.lines.push(`✗ Avevi identificato come ${SPECIES_BY_ID[b.guess].name} un esemplare di ${SPECIES_BY_ID[b.sp].name}.`); }
  }
  for (const p of res.photos) {
    if (p.guess && p.guess === p.sp) { correct++; addXP('micologia', 3); }
  }
  res.correctIds = correct;
  if (correct) report.lines.push(`✓ ${correct} identificazioni corrette${wrong ? `, ${wrong} errate` : ''}.`);

  // aggiornamento enciclopedia
  const touch = (spId) => {
    const e = entry(state, spId);
    if (!e.known) { e.known = true; e.firstDay = state.day; report.newSpecies.push(spId); }
    if (!e.regions.includes(state.regionId)) e.regions.push(state.regionId);
    return e;
  };
  for (const b of res.basket) { const e = touch(b.sp); e.collected++; e.bestWeight = Math.max(e.bestWeight, Math.round(b.weight)); if (b.guess === b.sp) e.identified++; }
  for (const p of res.photos) { const e = touch(p.sp); e.photographed++; if (p.guess === p.sp) e.identified++; }
  for (const p of res.photos) {
    if (p.img) state.photos.push({ sp: p.sp, day: state.day, img: p.img, region: state.regionId });
  }
  if (state.photos.length > 48) state.photos.splice(0, state.photos.length - 48);

  // controllo di sicurezza
  const deadly = res.basket.filter((b) => SPECIES_BY_ID[b.sp].edibility === 'mortale');
  const toxic = res.basket.filter((b) => SPECIES_BY_ID[b.sp].edibility === 'tossico');
  let edibles = res.basket.filter((b) => EDIBILITY[SPECIES_BY_ID[b.sp].edibility].value);
  if (deadly.length) {
    report.confiscated = true;
    report.warnings.push(`☠ Nel cestino c'era ${deadly.length > 1 ? 'più di un esemplare' : 'un esemplare'} di ${SPECIES_BY_ID[deadly[0].sp].name} (mortale). L'intero raccolto è stato considerato contaminato e distrutto.`);
    state.reputation = Math.max(0, state.reputation - 12);
    edibles = [];
  } else if (toxic.length) {
    report.warnings.push(`⚠ ${toxic.length} esemplari tossici scartati dal micologo. Meglio fotografarli e lasciarli nel bosco.`);
    state.reputation = Math.max(0, state.reputation - 3);
  }
  // multe e sequestri delle guardie forestali durante l'uscita
  if (res.ranger && res.ranger.checks) {
    if (res.ranger.fines) {
      report.fines += res.ranger.fines;
      report.warnings.push(`👮 Controlli del Corpo Forestale: ${res.ranger.checks} (multe per ${res.ranger.fines} €, ${res.ranger.confiscated} esemplari sequestrati).`);
    } else report.lines.push(`👮 Superati ${res.ranger.checks} controlli del Corpo Forestale: tutto in regola.`);
  }
  const kg = edibles.reduce((a, b) => a + b.weight, 0) / 1000;
  // vendita/conferimento
  let money = 0;
  for (const b of edibles) money += (b.weight / 1000) * SPECIES_BY_ID[b.sp].price * b.quality;
  money = Math.round(money);
  res.edibleKgGood = edibles.filter((b) => b.quality >= 0.6).reduce((a, b) => a + b.weight, 0) / 1000;
  if (edibles.length) report.lines.push(`€ Raccolto commestibile conferito: ${kg.toFixed(2)} kg → ${money} €.`);
  report.money = money - report.fines;

  // XP altre competenze
  addXP('osservazione', Math.round(res.found.reduce((a, f) => a + 2 + f.cover * 6, 0)));
  addXP('habitat', Math.round(res.habitatChecks * 2 + res.speciesSeen.size * 2));
  addXP('orientamento', Math.round(res.distance / 120 + (res.fogMinutes || 0) / 6 + (res.returnedBeforeDark && !res.usedGps ? 4 : 0)));
  addXP('pianificazione', Math.round((res.checkedForecast ? 4 : 0) + Math.min(12, res.speciesSeen.size * 1.5) + (res.returnedBeforeDark ? 3 : 0) - (res.rescued ? 6 : 0)));

  // missioni
  for (const m of [...state.missions]) {
    if (state.mode === 'libera') break;
    if (checkMission(m, res)) {
      report.missionsDone.push(m);
      report.money += m.reward;
      state.missions = state.missions.filter((x) => x !== m);
      state.completedMissions++;
      state.reputation = Math.min(100, state.reputation + 4);
    }
  }
  if (res.rescued) {
    report.warnings.push('🚑 Il soccorso alpino ti ha riportato all\'auto. Spese di intervento: 40 €.');
    report.money -= 40;
  }
  if (state.mode === 'libera') { report.money = Math.max(0, report.money); }
  state.money += report.money;
  state.stats.expeditions++;
  state.stats.kgTotal += kg;
  state.stats.distance += res.distance;
  state.stats.earned += Math.max(0, report.money);
  const lvlAfter = playerLevel(state);
  if (lvlAfter > lvlBefore) {
    report.levelUp = lvlAfter;
    report.unlockedZones = Object.values(ZONES).flat().filter((z) => z.level > lvlBefore && z.level <= lvlAfter).map((z) => z.name);
  }
  for (const r of REGIONS) if (lvlAfter >= r.unlockLevel && !state.unlockedRegions.includes(r.id) && r.price === 0) state.unlockedRegions.push(r.id);
  return report;
}

export function loadoutWeight(state) {
  return state.loadout.reduce((a, id) => a + (EQUIP_BY_ID[id]?.weight || 0), 0);
}
export function hasItem(state, id) { return state.loadout.includes(id); }
