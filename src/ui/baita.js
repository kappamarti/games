// La baita: pianificazione, meteo, centro micologico, negozio, diario, enciclopedia, mappa, competenze, foto.
import { el, clear, bar, stars, toast, confirmDialog } from './dom.js';
import { SPECIES, SPECIES_BY_ID, EDIBILITY, RARITY, CAP_COLORS, UNDER_TYPES } from '../data/species.js';
import { EQUIPMENT, EQUIP_BY_ID, REGIONS, REGION_BY_ID } from '../data/equipment.js';
import { formatDate, formatTime, seasonOf, SEASON_LABEL, sunTimes, dayOfYear, seasonFactor, MONTHS } from '../data/calendar.js';
import { forecast, regionalDay, WEATHER_TYPES } from '../sim/weather.js';
import { SKILLS, skillLevel, skillProgress, playerLevel, totalXP, xpForLevel, loadoutWeight, saveGame, refreshMissions, ecoFor, LIMIT_KG } from '../game/state.js';
import { ZONES, DAY_NAMES, dayOfWeek } from '../data/zones.js';
import { buyLicense, licenseFor, zoneUnlocked, dayAllowed, rulesSummary } from '../game/rules.js';
import { QUALITY, RESOLUTIONS, applyQuality } from '../render/pipeline.js';
import { getWorld } from '../game/expedition.js';
import { simulateUntil } from '../sim/ecosystem.js';
import { drawMap, mapLegend } from './map.js';
import { speciesThumb } from './thumbs.js';
import { BIOME_LABEL, TREE_LABEL } from '../world/worldgen.js';
import { audio } from '../core/audio.js';

const TABS = [
  ['pianifica', '🎒 Pianifica'], ['meteo', '🌦 Meteo'], ['permessi', '📜 Permessi e zone'], ['centro', '🔬 Centro micologico'], ['negozio', '🛒 Negozio'],
  ['diario', '📔 Diario'], ['enciclopedia', '📚 Enciclopedia'], ['mappa', '🗺 Mappe'], ['competenze', '⭐ Competenze'], ['foto', '🖼 Parete foto'],
];

export class Baita {
  constructor(app, state) {
    this.app = app; this.state = state;
    this.tab = state.lastReport ? 'centro' : 'pianifica';
    this.checkedForecast = false;
    this.startHour = 7;
    this.freeWeather = 'sereno';
    this.root = el('div', { class: 'baita' });
    document.body.append(this.root);
    this.render();
  }

  dispose() { this.root.remove(); }

  render() {
    const s = this.state;
    clear(this.root);
    const lvl = playerLevel(s);
    const header = el('header', { class: 'baita-head' },
      el('div', { class: 'brand' }, el('span', { class: 'logo' }, '🍄'), el('div', {}, el('h1', {}, 'Mushroom Hunter'), el('small', {}, `La baita di ${s.name}`))),
      el('div', { class: 'stat-row' },
        el('div', { class: 'stat' }, el('small', {}, 'Data'), el('b', {}, `${DAY_NAMES[dayOfWeek(s.day)]} ${formatDate(s.day)}`)),
        el('div', { class: 'stat' }, el('small', {}, 'Stagione'), el('b', {}, SEASON_LABEL[seasonOf(s.day)])),
        el('div', { class: 'stat' }, el('small', {}, 'Livello'), el('b', {}, `${lvl}`), el('div', { class: 'mini-bar' }, el('i', { style: { width: `${Math.min(100, ((totalXP(s) - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100)}%` } }))),
        el('div', { class: 'stat' }, el('small', {}, 'Portafoglio'), el('b', {}, `${s.money} €`)),
        el('div', { class: 'stat' }, el('small', {}, 'Reputazione'), el('b', {}, `${s.reputation}/100`))),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn ghost small', onclick: () => openSettings(this.app, s) }, '⚙ Impostazioni'),
        el('button', { class: 'btn ghost small', onclick: () => { saveGame(s); toast('Partita salvata.'); } }, '💾 Salva'),
        el('button', { class: 'btn ghost small', onclick: () => this.app.toTitle() }, '⏏ Menu')));
    const nav = el('nav', { class: 'tabs' }, TABS.map(([id, label]) => el('button', { class: `tab ${this.tab === id ? 'active' : ''}`, onclick: () => { this.tab = id; audio.click(); this.render(); } }, label)));
    const body = el('main', { class: 'baita-body' });
    this.root.append(header, nav, body);
    const fn = { pianifica: this.tabPlan, meteo: this.tabWeather, permessi: this.tabPermits, centro: this.tabCenter, negozio: this.tabShop, diario: this.tabDiary, enciclopedia: this.tabEncyclopedia, mappa: this.tabMap, competenze: this.tabSkills, foto: this.tabPhotos }[this.tab];
    fn.call(this, body);
  }

  // ------------------------------------------------------------------ PIANIFICA
  tabPlan(body) {
    const s = this.state;
    const region = REGION_BY_ID[s.regionId];
    const today = regionalDay(s.weather, s.day, region);
    const wt = WEATHER_TYPES[today.type];
    const st = sunTimes(s.day);
    const regionCards = el('div', { class: 'cards' }, REGIONS.map((r) => {
      const unlocked = s.unlockedRegions.includes(r.id);
      const sel = s.regionId === r.id;
      return el('div', { class: `card region ${sel ? 'sel' : ''} ${unlocked ? '' : 'locked'}`, onclick: () => { if (unlocked) { s.regionId = r.id; this.render(); } } },
        el('h4', {}, r.name), el('p', {}, r.desc), el('small', {}, `Quota ~${r.altitude} m`),
        unlocked ? null : el('p', { class: 'lock' }, `🔒 Livello ${r.unlockLevel}${r.price ? ` + permesso ${r.price} €` : ''} (Negozio)`));
    }));
    const mode = el('div', { class: 'row wrap' },
      ['simulazione', 'libera'].map((m) => el('button', { class: `chip ${s.mode === m ? 'on' : ''}`, onclick: () => { s.mode = m; this.render(); } }, m === 'simulazione' ? 'Modalità simulazione' : 'Modalità libera')));
    const freeBox = s.mode === 'libera' ? el('div', { class: 'row wrap' }, el('span', {}, 'Meteo a scelta: '),
      Object.entries(WEATHER_TYPES).map(([k, v]) => el('button', { class: `chip ${this.freeWeather === k ? 'on' : ''}`, onclick: () => { this.freeWeather = k; this.render(); } }, `${v.icon} ${v.label}`))) : null;

    const hourInput = el('input', { type: 'range', min: Math.max(4.5, Math.floor(st.sunrise * 2) / 2 - 1), max: 16, step: 0.25, value: this.startHour, oninput: (e) => { this.startHour = +e.target.value; hourLbl.textContent = formatTime(this.startHour); } });
    const hourLbl = el('b', {}, formatTime(this.startHour));

    const owned = EQUIPMENT.filter((e) => s.owned.includes(e.id));
    const loadout = el('div', { class: 'loadout' }, owned.map((e) => {
      const on = s.loadout.includes(e.id);
      return el('label', { class: `equip ${on ? 'on' : ''}` },
        el('input', { type: 'checkbox', checked: on ? '' : null, onchange: (ev) => {
          if (ev.target.checked) {
            if (e.slot === 'cestino') s.loadout = s.loadout.filter((id) => EQUIP_BY_ID[id].slot !== 'cestino');
            s.loadout.push(e.id);
          } else s.loadout = s.loadout.filter((id) => id !== e.id);
          this.render();
        } }),
        el('span', {}, el('b', {}, e.name), el('small', {}, `${e.desc} (${e.weight} kg)`)));
    }));
    const lw = loadoutWeight(s);
    body.append(
      el('section', { class: 'grid2' },
        el('div', { class: 'panel' },
          el('h3', {}, 'Oggi'),
          el('div', { class: 'today' }, el('span', { class: 'big-ico' }, wt.icon), el('div', {},
            el('b', {}, wt.label), el('div', {}, `${today.tMin.toFixed(0)}° / ${today.tMax.toFixed(0)} °C • pioggia ${today.rain} mm`),
            el('div', { class: 'muted' }, `Alba ${formatTime(st.sunrise)} • Tramonto ${formatTime(st.sunset)}`))),
          el('p', { class: 'muted' }, this.checkedForecast ? 'Hai consultato il bollettino.' : 'Consiglio: consulta il bollettino meteo (scheda Meteo) prima di partire.'),
          el('h3', {}, 'Dove andare'), regionCards,
          el('h3', {}, 'Modalità'), mode, freeBox,
          el('h3', {}, 'Ora di partenza'), el('div', { class: 'row' }, hourInput, hourLbl),
          el('div', { class: 'row gap' },
            el('button', { class: 'btn primary big', onclick: () => this.start() }, '🥾 Parti per la spedizione'),
            el('button', { class: 'btn', onclick: () => this.rest() }, '🛏 Riposa fino a domani'))),
        el('div', { class: 'panel' },
          el('h3', {}, `Zaino (${lw.toFixed(1)} kg)`),
          el('p', { class: 'muted' }, 'Scegli l\'attrezzatura: ogni oggetto ha una funzione concreta. Un cestino è necessario per raccogliere.'),
          loadout,
          el('h3', {}, 'Permessi validi oggi'),
          (() => {
            const valid = ZONES[s.regionId].filter((z) => licenseFor(s, z.id, s.day));
            return valid.length ? el('ul', { class: 'missions' }, valid.map((z) => el('li', {}, el('span', {}, `${z.name}: ${licenseFor(s, z.id, s.day).name}`), el('b', { class: dayAllowed(z.rules, s.day) ? 'okc' : 'koc' }, dayAllowed(z.rules, s.day) ? 'raccolta oggi ✓' : 'oggi chiusa'))))
              : el('p', { class: 'warnc' }, 'Nessun permesso valido per questa regione: potrai solo esplorare e fotografare. Acquistalo nella scheda "Permessi e zone".');
          })(),
          el('h3', {}, 'Incarichi attivi'),
          el('ul', { class: 'missions' }, s.mode === 'libera' ? el('li', { class: 'muted' }, 'In modalità libera gli incarichi non avanzano.') : s.missions.map((m) => el('li', {}, el('span', {}, m.title), el('b', {}, `+${m.reward} €`)))))));
  }

  start() {
    const s = this.state;
    if (!s.loadout.some((id) => EQUIP_BY_ID[id].slot === 'cestino')) toast('Parti senza cestino: potrai solo fotografare (o portare pochissimo in mano).', 'warn');
    audio.init(); audio.resume();
    this.app.startExpedition({ startHour: this.startHour, freeWeather: s.mode === 'libera' ? this.freeWeather : null, checkedForecast: this.checkedForecast });
  }

  async rest() {
    const ok = await confirmDialog('Passare la giornata in baita? Il bosco continuerà a evolvere.', 'Riposa');
    if (!ok) return;
    this.app.advanceDay();
  }

  // ------------------------------------------------------------------ METEO
  tabWeather(body) {
    this.checkedForecast = true;
    const s = this.state;
    const region = REGION_BY_ID[s.regionId];
    const plan = skillLevel(s.skills.pianificazione);
    const ahead = 3 + Math.min(3, Math.floor(plan / 2));
    const fc = forecast(s.weather, s.day, ahead, region, plan);
    const cards = el('div', { class: 'forecast' }, fc.map((d, i) => {
      const w = WEATHER_TYPES[d.type];
      return el('div', { class: 'fc' },
        el('small', {}, i === 0 ? 'Oggi' : i === 1 ? 'Domani' : formatDate(d.day, true)),
        el('div', { class: 'fc-ico' }, w.icon), el('b', {}, w.label),
        el('div', {}, `${Math.round(d.tMin)}° / ${Math.round(d.tMax)}°`),
        el('div', { class: 'muted' }, `${d.rain} mm • umidità ${d.humidity}%`),
        i > 0 ? el('div', { class: 'muted' }, `affidabilità ${Math.round(d.certainty * 100)}%`) : null);
    }));
    // storico (memoria del meteo)
    const eco = ecoFor(s, s.regionId);
    const world = getWorld(s.regionId);
    simulateUntil(world, eco, s.weather, region, s.day);
    const hist = [];
    for (let k = 13; k >= 0; k--) hist.push({ d: s.day - k, r: regionalDay(s.weather, s.day - k, region), m: eco.soil[s.day - k] });
    const maxR = Math.max(10, ...hist.map((h) => h.r.rain));
    const chart = el('div', { class: 'histchart' }, hist.map((h) => el('div', { class: 'hc' },
      el('div', { class: 'hc-bar', style: { height: `${(h.r.rain / maxR) * 100}%` }, title: `${h.r.rain} mm` }),
      el('div', { class: 'hc-dot', style: { bottom: `${h.m ?? 0}%` }, title: `Umidità suolo ${h.m}%` }),
      el('small', {}, formatDate(h.d, true).split(' ')[0]))));
    const rain7 = hist.slice(-7).reduce((a, h) => a + h.r.rain, 0);
    const tAvg = hist.slice(-5).reduce((a, h) => a + (h.r.tMin + h.r.tMax) / 2, 0) / 5;
    const soil = eco.soil[s.day] ?? 50;
    const advice = soil > 65 ? 'Il terreno è ben umido: molte specie potrebbero fruttificare nei prossimi giorni, soprattutto dove ha piovuto 5–8 giorni fa.' :
      soil > 45 ? 'Umidità discreta: cerca nei versanti ombrosi, vicino al torrente e nelle zone di muschio.' :
        'Il bosco è asciutto: la crescita rallenta. Cerca vicino all\'acqua o aspetta le prossime piogge.';
    body.append(
      el('section', { class: 'panel' }, el('h3', {}, `Bollettino — ${region.name}`), cards,
        el('p', { class: 'muted' }, `La competenza Pianificazione (liv. ${plan}) migliora affidabilità e numero di giorni previsti.`)),
      el('section', { class: 'grid2' },
        el('div', { class: 'panel' }, el('h3', {}, 'Memoria del meteo: ultimi 14 giorni'), chart,
          el('p', { class: 'muted' }, 'Barre: pioggia giornaliera. Punti: umidità del suolo.')),
        el('div', { class: 'panel' }, el('h3', {}, 'Condizioni del bosco'),
          el('div', { class: 'rd' }, el('span', {}, 'Pioggia ultimi 7 giorni'), el('b', {}, `${rain7.toFixed(0)} mm`)),
          el('div', { class: 'rd' }, el('span', {}, 'Temperatura media (5 gg)'), el('b', {}, `${tAvg.toFixed(1)} °C`)),
          el('div', { class: 'rd' }, el('span', {}, 'Umidità del suolo'), bar(soil, 100), el('b', {}, `${Math.round(soil)}%`)),
          eco.snow > 0.5 ? el('div', { class: 'rd' }, el('span', {}, 'Neve al suolo'), el('b', {}, `${eco.snow.toFixed(0)} cm`)) : null,
          el('p', {}, advice),
          el('p', { class: 'muted' }, 'Non esiste una regola fissa: la crescita dipende da umidità accumulata, temperatura, stagione e alberi presenti.'))));
  }

  // ------------------------------------------------------------------ PERMESSI
  tabPermits(body) {
    const s = this.state;
    const lvl = playerLevel(s);
    for (const r of REGIONS) {
      const regionOpen = s.unlockedRegions.includes(r.id);
      const sec = el('section', { class: 'panel' },
        el('div', { class: 'row between' }, el('h3', {}, r.name), regionOpen ? el('span', { class: 'tag' }, 'Regione accessibile') : el('span', { class: 'tag lockt' }, `🔒 Livello ${r.unlockLevel} + permesso regionale (Negozio)`)),
        el('div', { class: 'zones' }, ZONES[r.id].map((z) => {
          const open = zoneUnlocked(s, z.id) && regionOpen;
          const lic = licenseFor(s, z.id, s.day);
          const today = dayAllowed(z.rules, s.day);
          return el('div', { class: `card zone ${open ? '' : 'locked'}` },
            el('div', { class: 'row between' }, el('h4', {}, el('i', { class: 'zdot', style: { background: z.color } }), z.name), el('span', { class: 'tag' }, open ? `Liv. ${z.level}` : `🔒 Liv. ${z.level}`)),
            el('p', {}, z.desc),
            el('ul', { class: 'rules' }, rulesSummary(z).map((t) => el('li', {}, t))),
            el('p', { class: today ? 'okc' : 'koc' }, `Oggi (${DAY_NAMES[dayOfWeek(s.day)]}): ${today ? 'raccolta consentita' : 'raccolta non consentita'}`),
            lic ? el('p', { class: 'okc' }, `✓ ${lic.name} — valido fino al ${formatDate(lic.until, true)}`) : el('p', { class: 'muted' }, 'Nessun permesso valido.'),
            open ? el('div', { class: 'lic-buttons' }, z.licenses.map((l) => el('button', {
              class: 'btn small', disabled: s.money < l.price || (l.reputation && s.reputation < l.reputation) ? '' : null,
              onclick: () => { const res = buyLicense(s, z.id, l.id); toast(res.msg, res.ok ? 'info' : 'warn'); saveGame(s); this.render(); },
            }, `${l.name} — ${l.price} €${l.days === 'stagione' ? ' (fino a fine stagione)' : l.days > 1 ? ` (${l.days} giorni)` : ' (oggi)'}`)))
              : el('p', { class: 'lock' }, `Accumula esperienza: la zona si apre al livello ${z.level} (sei al livello ${lvl}).`));
        })));
      body.append(sec);
    }
    body.append(el('section', { class: 'panel' }, el('h3', {}, 'Come funzionano i controlli'),
      el('p', {}, 'Le guardie del Corpo Forestale pattugliano i sentieri e a volte aspettano al parcheggio. Controllano permesso, giorni e orari consentiti, limiti di peso per zona, specie protette, taglia minima dei porcini, contenitore (vietati i sacchetti di plastica) e attrezzi vietati come il rastrello.'),
      el('p', { class: 'muted' }, `Controlli subiti: ${s.rangerStats?.checks || 0} • Multe pagate: ${s.rangerStats?.fines || 0} € • Reputazione: ${s.reputation}/100`)));
  }

  // ------------------------------------------------------------------ CENTRO
  tabCenter(body) {
    const s = this.state;
    const rep = s.lastReport;
    body.append(el('section', { class: 'grid2' },
      el('div', { class: 'panel' },
        el('h3', {}, 'Centro micologico di valle'),
        el('p', {}, 'Il micologo verifica ogni raccolto al rientro, conferma le identificazioni e ritira i commestibili. Qui ricevi anche gli incarichi.'),
        el('p', { class: 'muted' }, `Regole di raccolta: max ${LIMIT_KG} kg di commestibili al giorno; vietato raccogliere porcini con cappello sotto i 4 cm; gli esemplari mortali contaminano l'intero cestino.`),
        el('h3', {}, 'Incarichi'),
        el('ul', { class: 'missions' }, s.missions.map((m) => el('li', {}, el('span', {}, m.title), el('b', {}, `+${m.reward} €`)))),
        el('p', { class: 'muted' }, `Incarichi completati: ${s.completedMissions}`)),
      el('div', { class: 'panel' },
        el('h3', {}, 'Ultimo referto'),
        rep ? reportView(rep) : el('p', { class: 'muted' }, 'Nessuna spedizione recente.'))));
  }

  // ------------------------------------------------------------------ NEGOZIO
  tabShop(body) {
    const s = this.state;
    const items = el('div', { class: 'shop' }, EQUIPMENT.map((e) => {
      const own = s.owned.includes(e.id);
      return el('div', { class: `card shop-item ${own ? 'owned' : ''}` },
        el('h4', {}, e.name), el('p', {}, e.desc),
        el('div', { class: 'row between' }, el('b', {}, own ? 'Posseduto' : `${e.price} €`),
          own ? null : el('button', { class: 'btn small', disabled: s.money < e.price ? '' : null, onclick: () => {
            s.money -= e.price; s.owned.push(e.id);
            if (e.slot === 'cestino') s.loadout = s.loadout.filter((id) => EQUIP_BY_ID[id].slot !== 'cestino');
            s.loadout.push(e.id);
            toast(`Acquistato: ${e.name}`); saveGame(s); this.render();
          } }, 'Acquista')));
    }));
    const lvl = playerLevel(s);
    const permits = el('div', { class: 'cards' }, REGIONS.filter((r) => r.price > 0).map((r) => {
      const has = s.unlockedRegions.includes(r.id);
      const can = lvl >= r.unlockLevel && s.money >= r.price;
      return el('div', { class: 'card' }, el('h4', {}, `Permesso: ${r.name}`), el('p', {}, r.desc),
        el('div', { class: 'row between' }, el('b', {}, has ? 'Ottenuto' : `${r.price} € • livello ${r.unlockLevel}`),
          has ? null : el('button', { class: 'btn small', disabled: can ? null : '', onclick: () => { s.money -= r.price; s.unlockedRegions.push(r.id); toast(`Nuova regione: ${r.name}`); saveGame(s); this.render(); } }, 'Acquista')));
    }));
    body.append(el('section', { class: 'panel' }, el('h3', {}, `Negozio dell'attrezzatura — hai ${s.money} €`), items),
      el('section', { class: 'panel' }, el('h3', {}, 'Permessi regionali'), permits));
  }

  // ------------------------------------------------------------------ DIARIO
  tabDiary(body) {
    const s = this.state;
    if (!s.diary.length) { body.append(el('section', { class: 'panel' }, el('h3', {}, 'Diario delle spedizioni'), el('p', { class: 'muted' }, 'Ancora nessuna spedizione. Ogni uscita verrà registrata qui con meteo, pioggia precedente, specie e zone.'))); return; }
    const rows = s.diary.slice().reverse().map((d) => el('div', { class: 'diary-entry' },
      el('div', { class: 'de-head' }, el('b', {}, `Diario di spedizione #${String(d.n).padStart(3, '0')}`), el('span', {}, `${formatDate(d.day)} • ${SEASON_LABEL[d.season]} • ${REGION_BY_ID[d.regionId]?.name}`)),
      el('div', { class: 'de-grid' },
        kv('Durata', `${Math.floor(d.duration)} h ${Math.round((d.duration % 1) * 60)} min`), kv('Meteo', `${WEATHER_TYPES[d.weatherType]?.icon} ${WEATHER_TYPES[d.weatherType]?.label}`),
        kv('Temperatura', `${d.tMin.toFixed(0)}–${d.tMax.toFixed(0)} °C`), kv('Pioggia 5 gg prima', `${d.prevRain.toFixed(0)} mm`),
        kv('Umidità suolo', `${Math.round(d.soil)}%`), kv('Specie registrate', d.speciesCount), kv('Raccolto', `${d.kg.toFixed(2)} kg`), kv('Distanza', `${(d.distance / 1000).toFixed(1)} km`)),
      el('p', {}, el('b', {}, 'Scoperte: '), Object.entries(d.counts).map(([sp, n]) => `${n} ${SPECIES_BY_ID[sp].name}`).join(', ') || '—'),
      d.newSpecies.length ? el('p', {}, el('b', {}, 'Nuove per la collezione: '), d.newSpecies.map((id) => SPECIES_BY_ID[id].name).join(', ')) : null,
      el('p', { class: 'muted' }, `Zone: ${d.zones.map((z) => BIOME_LABEL[z]).join(', ')}`)));
    body.append(el('section', { class: 'panel' }, el('h3', {}, 'Diario delle spedizioni'),
      el('p', { class: 'muted' }, 'Confronta le uscite: quali zone rendono dopo giorni umidi? Quali specie compaiono solo in certe finestre stagionali?'), rows));
  }

  // ------------------------------------------------------------------ ENCICLOPEDIA
  tabEncyclopedia(body) {
    const s = this.state;
    const known = SPECIES.filter((sp) => s.encyclopedia[sp.id]?.known).length;
    const grid = el('div', { class: 'ency' });
    const detail = el('div', { class: 'panel ency-detail' }, el('p', { class: 'muted' }, 'Seleziona una specie.'));
    for (const sp of SPECIES) {
      const e = s.encyclopedia[sp.id];
      const k = e?.known;
      const card = el('div', { class: `ency-card ${k ? '' : 'unknown'}`, onclick: () => showDetail(sp) },
        el('img', { src: speciesThumb(sp, !k), alt: '' }),
        el('b', {}, k ? sp.name : '???'), el('small', {}, k ? sp.latin : RARITY[sp.rarity].label));
      grid.append(card);
    }
    const showDetail = (sp) => {
      const e = s.encyclopedia[sp.id];
      clear(detail);
      if (!e?.known) {
        detail.append(el('h3', {}, 'Specie non ancora scoperta'), el('img', { src: speciesThumb(sp, true), class: 'ency-big' }),
          el('p', {}, `Rarità: ${stars(RARITY[sp.rarity].stars)}`),
          el('p', { class: 'muted' }, `Indizio: ${seasonHint(sp)}; ${habitatHint(sp)}.`));
        return;
      }
      const ed = EDIBILITY[sp.edibility];
      const photos = s.photos.filter((p) => p.sp === sp.id).slice(-3);
      detail.append(
        el('h3', {}, sp.name, ' ', el('i', { class: 'muted' }, sp.latin)),
        el('img', { src: speciesThumb(sp), class: 'ency-big' }),
        el('p', {}, el('b', { style: { color: ed.color } }, ed.label), ` • Rarità ${stars(RARITY[sp.rarity].stars)}`),
        el('p', {}, el('b', {}, 'Cappello: '), sp.look.cappello), el('p', {}, el('b', {}, 'Sotto: '), sp.look.sotto),
        el('p', {}, el('b', {}, 'Gambo: '), sp.look.gambo), el('p', {}, el('b', {}, 'Base: '), sp.look.base), el('p', {}, el('b', {}, 'Habitat: '), sp.look.habitat),
        el('p', {}, el('b', {}, 'Stagione: '), seasonHint(sp)),
        el('p', { class: 'note' }, sp.notes),
        el('div', { class: 'de-grid' }, kv('Raccolti', e.collected), kv('Fotografati', e.photographed), kv('Identificati', e.identified), kv('Esemplare record', e.bestWeight ? `${e.bestWeight} g` : '—'), kv('Prima scoperta', formatDate(e.firstDay, true))),
        photos.length ? el('div', { class: 'photo-row' }, photos.map((p) => el('img', { src: p.img }))) : null);
    };
    body.append(el('section', { class: 'panel' }, el('h3', {}, `Enciclopedia — ${known}/${SPECIES.length} specie scoperte`),
      el('p', { class: 'muted' }, '⚠ Simulazione: non usare mai il gioco per identificare funghi reali. Nella realtà, non si consuma mai un fungo sulla base di un riconoscimento incerto: rivolgiti sempre a un ispettorato micologico.')),
    el('section', { class: 'grid2 ency-wrap' }, el('div', { class: 'panel' }, grid), detail));
  }

  // ------------------------------------------------------------------ MAPPE
  tabMap(body) {
    const s = this.state;
    const region = REGION_BY_ID[s.regionId];
    const world = getWorld(s.regionId);
    const cv = el('canvas', { width: 600, height: 600, class: 'mapcanvas' });
    const zs = ZONES[s.regionId];
    drawMap(cv, world, { poi: s.poi[s.regionId] || [], explored: s.explored[s.regionId], zones: { unlocked: new Set(zs.filter((z) => zoneUnlocked(s, z.id)).map((z) => z.id)), licensed: new Set(zs.filter((z) => licenseFor(s, z.id, s.day)).map((z) => z.id)) } });
    const ex = (s.explored[s.regionId] || '').split('').filter((c) => c === '1').length;
    const poiList = (s.poi[s.regionId] || []).map((p, i) => el('li', {}, `${p.label} — salvato il ${formatDate(p.day, true)}`,
      el('button', { class: 'btn ghost small', onclick: () => { s.poi[s.regionId].splice(i, 1); this.render(); } }, 'Elimina')));
    body.append(el('section', { class: 'grid2' },
      el('div', { class: 'panel' }, el('h3', {}, `Mappa — ${region.name}`), cv, mapLegend()),
      el('div', { class: 'panel' }, el('h3', {}, 'Esplorazione'), el('p', {}, `Zone esplorate: ${ex}/400 (${Math.round(ex / 4)}%)`),
        el('h3', {}, 'Punti salvati (GPS)'), poiList.length ? el('ul', { class: 'poi' }, poiList) : el('p', { class: 'muted' }, 'Con il GPS premi G durante la spedizione per salvare una zona promettente.'),
        el('p', { class: 'muted' }, 'Un punto ricco oggi non garantisce nulla domani: l\'ambiente evolve e una buona strategia resta una probabilità.'))));
  }

  // ------------------------------------------------------------------ COMPETENZE
  tabSkills(body) {
    const s = this.state;
    const lvl = playerLevel(s);
    body.append(el('section', { class: 'panel' },
      el('h3', {}, `Cercatore di livello ${lvl} — ${totalXP(s)} XP totali`),
      el('p', { class: 'muted' }, 'La progressione deriva dalla conoscenza acquisita: nessun livello rende magicamente visibili i funghi.'),
      el('div', { class: 'skills' }, Object.entries(SKILLS).map(([k, v]) => {
        const xp = s.skills[k] || 0;
        return el('div', { class: 'skill' }, el('div', { class: 'row between' }, el('b', {}, v.label), el('span', {}, `Liv. ${skillLevel(xp)}`)),
          bar(skillProgress(xp) * 100, 100, 'xp'), el('small', {}, v.desc));
      })),
      el('h3', {}, 'Statistiche'),
      el('div', { class: 'de-grid' }, kv('Spedizioni', s.stats.expeditions), kv('Raccolto totale', `${s.stats.kgTotal.toFixed(1)} kg`), kv('Distanza', `${(s.stats.distance / 1000).toFixed(1)} km`), kv('Guadagni', `${s.stats.earned} €`), kv('Incarichi', s.completedMissions))));
  }

  // ------------------------------------------------------------------ FOTO
  tabPhotos(body) {
    const s = this.state;
    body.append(el('section', { class: 'panel' }, el('h3', {}, 'Parete delle fotografie'),
      s.photos.length ? el('div', { class: 'photo-wall' }, s.photos.slice().reverse().map((p) => el('figure', {}, el('img', { src: p.img }),
        el('figcaption', {}, `${s.encyclopedia[p.sp]?.known ? SPECIES_BY_ID[p.sp].name : '???'} • ${formatDate(p.day, true)}`)))) :
        el('p', { class: 'muted' }, 'Fotografa gli esemplari durante l\'ispezione: le foto finiranno qui e nell\'enciclopedia.')));
  }
}

function kv(k, v) { return el('div', { class: 'kv' }, el('small', {}, k), el('b', {}, String(v))); }

export function reportView(rep) {
  return el('div', { class: 'report' },
    rep.newSpecies.length ? el('div', { class: 'new-species' }, el('b', {}, '✨ Nuove specie per la collezione: '), rep.newSpecies.map((id) => SPECIES_BY_ID[id].name).join(', ')) : null,
    ...rep.warnings.map((w) => el('p', { class: 'warn' }, w)),
    ...rep.lines.map((l) => el('p', {}, l)),
    ...rep.missionsDone.map((m) => el('p', { class: 'ok' }, `🏅 Incarico completato: ${m.title} (+${m.reward} €)`)),
    el('div', { class: 'xp-row' }, Object.entries(rep.xp).map(([k, v]) => el('span', { class: 'tag' }, `+${v} ${SKILLS[k].label}`))),
    el('p', { class: 'money' }, `Saldo della spedizione: ${rep.money >= 0 ? '+' : ''}${rep.money} €`),
    rep.levelUp ? el('p', { class: 'ok' }, `⭐ Sei salito al livello ${rep.levelUp}!`) : null,
    rep.unlockedZones?.length ? el('p', { class: 'ok' }, `🗺 Nuove zone aperte: ${rep.unlockedZones.join(', ')}. Compra il permesso nella scheda "Permessi e zone".`) : null);
}

function seasonHint(sp) {
  return sp.season.map(([a, b]) => `${MONTHS[monthOf(a)]}–${MONTHS[monthOf(b % 365)]}`).join(', ');
}
function monthOf(doy) { const st = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; let m = 11; while (m > 0 && st[m] > doy) m--; return m; }
function habitatHint(sp) {
  const trees = Object.keys(sp.trees);
  if (sp.traits.substrate === 'legno') return 'cresce sul legno morto';
  if (!trees.length) return `ama ${Object.keys(sp.biomes).map((b) => BIOME_LABEL[b].toLowerCase()).slice(0, 2).join(' e ')}`;
  return `associato a ${trees.slice(0, 2).map((t) => TREE_LABEL[t].toLowerCase()).join(' e ')}`;
}

export { CAP_COLORS, UNDER_TYPES, dayOfYear, seasonFactor, refreshMissions };

// Finestra delle impostazioni (accessibile dalla baita)
export function openSettings(app, s) {
  const ov = el('div', { class: 'modal-backdrop' });
  const apply = () => { applyQuality(app.viewer, s.settings); saveGame(s); };
  const sel = (label, key, opts, def, num = false) => el('label', {}, label, el('select', { onchange: (e) => { s.settings[key] = num ? +e.target.value : e.target.value; apply(); } },
    opts.map(([v, l]) => el('option', { value: v, selected: String(s.settings[key] ?? def) === String(v) ? '' : null }, l))));
  const gpu = app.viewer.userData?.gpu || 'sconosciuta';
  ov.append(el('div', { class: 'modal settings' },
    el('h3', {}, '⚙ Impostazioni'),
    el('p', { class: 'muted' }, `Scheda video usata dal browser: ${gpu}`),
    /intel/i.test(gpu) ? el('p', { class: 'warnc' }, 'Il browser sta usando la grafica integrata. Per il 4K imposta il browser su "Prestazioni elevate" (Windows → Impostazioni → Sistema → Schermo → Grafica) così userà la scheda NVIDIA.') : null,
    sel('Qualità grafica', 'quality', Object.entries(QUALITY).map(([k, v]) => [k, v.label]), 'alta'),
    sel('Risoluzione', 'resolution', RESOLUTIONS, 'auto'),
    el('label', {}, 'Ombre', el('input', { type: 'checkbox', checked: s.settings.shadows !== false ? '' : null, onchange: (e) => { s.settings.shadows = e.target.checked; apply(); } })),
    sel('Velocità del tempo', 'timeScale', [[6, 'x6'], [12, 'x12'], [24, 'x24'], [48, 'x48']], 12, true),
    el('label', {}, 'Sensibilità mouse', el('input', { type: 'range', min: 0.3, max: 2.5, step: 0.1, value: s.settings.sensitivity, oninput: (e) => { s.settings.sensitivity = +e.target.value; } })),
    el('label', {}, 'Volume', el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.settings.volume, oninput: (e) => { s.settings.volume = +e.target.value; audio.setVolume(+e.target.value); } })),
    el('div', { class: 'row end' }, el('button', { class: 'btn primary', onclick: () => { saveGame(s); ov.remove(); } }, 'Chiudi'))));
  document.body.append(ov);
}
