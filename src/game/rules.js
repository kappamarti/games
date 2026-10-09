// Zone, permessi e regole di raccolta (con i controlli delle guardie forestali).
import { ZONES, ZONE_BY_ID, COMMUNAL_RADIUS, dayOfWeek, daysLabel, hoursLabel, DAY_NAMES } from '../data/zones.js';
import { SPECIES_BY_ID, EDIBILITY } from '../data/species.js';
import { dateOf, sunTimes, seasonOf, formatTime } from '../data/calendar.js';
import { playerLevel } from './state.js';
import { CELLS, CELL } from '../world/worldgen.js';

// --- geometria delle zone ----------------------------------------------------
export function assignZones(world, regionId) {
  const zones = ZONES[regionId];
  const communal = zones[0];
  const others = zones.slice(1);
  const p = world.parking;
  for (const c of world.cells) {
    const d = Math.hypot(c.cx - p.x, c.cz - p.z);
    if (d < COMMUNAL_RADIUS) { c.zone = communal.id; continue; }
    // Voronoi deformato per bordi naturali
    let best = Infinity, id = others[0].id;
    for (const z of others) {
      const wob = Math.sin(c.cx * 0.031 + z.seed[1] * 0.01) * 18 + Math.cos(c.cz * 0.027 + z.seed[0] * 0.01) * 18;
      const dd = Math.hypot(c.cx - z.seed[0], c.cz - z.seed[1]) + wob;
      if (dd < best) { best = dd; id = z.id; }
    }
    c.zone = id;
  }
  world.zoneAt = (x, z) => world.cellAt(x, z).zone;
  // punti in cui i sentieri attraversano un confine di zona (per le sbarre)
  const crossings = [];
  for (const tr of world.trails) {
    for (let i = 1; i < tr.length; i++) {
      const a = world.zoneAt(tr[i - 1].x, tr[i - 1].z), b = world.zoneAt(tr[i].x, tr[i].z);
      if (a !== b) crossings.push({ x: (tr[i - 1].x + tr[i].x) / 2, z: (tr[i - 1].z + tr[i].z) / 2, dir: Math.atan2(tr[i].z - tr[i - 1].z, tr[i].x - tr[i - 1].x), a, b });
    }
  }
  world.zoneCrossings = crossings;
  // centroidi per le etichette della mappa
  const acc = {};
  for (const c of world.cells) { (acc[c.zone] ||= { x: 0, z: 0, n: 0 }); acc[c.zone].x += c.cx; acc[c.zone].z += c.cz; acc[c.zone].n++; }
  world.zoneCenters = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { x: v.x / v.n, z: v.z / v.n }]));
}

export function zoneUnlocked(state, zoneId) {
  return playerLevel(state) >= ZONE_BY_ID[zoneId].level;
}

// --- permessi ---------------------------------------------------------------
function seasonEndDay(day) {
  let d = day;
  const s = seasonOf(day);
  while (seasonOf(d + 1) === s) d++;
  return d;
}

export function buyLicense(state, zoneId, licId) {
  const z = ZONE_BY_ID[zoneId];
  const lic = z.licenses.find((l) => l.id === licId);
  if (!lic) return { ok: false, msg: 'Permesso inesistente.' };
  if (!zoneUnlocked(state, zoneId)) return { ok: false, msg: `Zona non ancora accessibile (livello ${z.level}).` };
  if (lic.reputation && state.reputation < lic.reputation) return { ok: false, msg: `Serve una reputazione di almeno ${lic.reputation}.` };
  if (state.money < lic.price) return { ok: false, msg: 'Fondi insufficienti.' };
  state.money -= lic.price;
  const until = lic.days === 'stagione' ? seasonEndDay(state.day) : state.day + lic.days - 1;
  state.licenses ||= {};
  const cur = state.licenses[zoneId];
  // si tiene il permesso più "forte" (quello che consente la raccolta) e la scadenza più lunga
  if (!cur || cur.until < state.day || lic.allowsPicking || !cur.allowsPicking) {
    state.licenses[zoneId] = { id: lic.id, name: lic.name, until: Math.max(until, cur && cur.until >= state.day && cur.id === lic.id ? cur.until : until), allowsPicking: !!lic.allowsPicking };
  } else {
    cur.until = Math.max(cur.until, until);
  }
  return { ok: true, msg: `${lic.name} valido fino al ${dateOf(until).day}/${dateOf(until).month + 1}.` };
}

export function licenseFor(state, zoneId, day) {
  const l = state.licenses?.[zoneId];
  return l && l.until >= day ? l : null;
}

// --- regole -----------------------------------------------------------------
export function dayAllowed(rules, day) {
  const d = rules.days;
  if (d === 'tutti') return true;
  const dm = dateOf(day).day;
  if (d === 'pari') return dm % 2 === 0;
  if (d === 'dispari') return dm % 2 === 1;
  return d.includes(dayOfWeek(day));
}

export function hourAllowed(rules, day, hour) {
  if (rules.hours === 'luce') { const st = sunTimes(day); return hour >= st.sunrise && hour <= st.sunset; }
  return hour >= rules.hours[0] && hour <= rules.hours[1];
}

export function pickingAllowedHere(state, zoneId) {
  const z = ZONE_BY_ID[zoneId];
  const lic = licenseFor(state, zoneId, state.day);
  if (z.rules.pickingAllowed === false) return !!lic?.allowsPicking;
  return !!lic;
}

/** Problemi legali di una raccolta (lista vuota = tutto in regola) */
export function pickIssues(state, { zoneId, day, hour, sp, stage, capCm, basket, container }) {
  const z = ZONE_BY_ID[zoneId];
  const r = z.rules;
  const out = [];
  const lic = licenseFor(state, zoneId, day);
  if (!lic) out.push(`Non hai un permesso valido per "${z.name}".`);
  else if (r.pickingAllowed === false && !lic.allowsPicking) out.push('Qui il tuo permesso consente solo osservazione e fotografie.');
  if (!dayAllowed(r, day)) out.push(`Oggi (${DAY_NAMES[dayOfWeek(day)]} ${dateOf(day).day}) la raccolta non è consentita: ${daysLabel(r.days)}.`);
  if (!hourAllowed(r, day, hour)) out.push(`Fuori orario (${formatTime(hour)}): raccolta consentita ${hoursLabel(r.hours)}.`);
  if (r.protected.includes(sp)) out.push(`${SPECIES_BY_ID[sp].name}: specie protetta in questa zona.`);
  const sr = r.speciesRules[sp];
  if (sr === 'no_giovane' && stage === 'giovane') out.push(`${SPECIES_BY_ID[sp].name}: qui si raccolgono solo esemplari maturi.`);
  if (typeof sr === 'number') {
    const n = basket.filter((b) => b.sp === sp && b.zone === zoneId).length;
    if (n >= sr) out.push(`${SPECIES_BY_ID[sp].name}: massimo ${sr} esemplari in questa zona.`);
  }
  if (SPECIES_BY_ID[sp].minPickStage === 'giovane' && capCm < 4) out.push('Cappello sotto i 4 cm: raccolta vietata per i porcini.');
  if (container === 'sacchetto') out.push('Il sacchetto di plastica è vietato: serve un contenitore rigido e aerato.');
  const limit = lic?.allowsPicking && r.scientificKg ? r.scientificKg : r.kg;
  const kg = basket.filter((b) => b.zone === zoneId && EDIBILITY[SPECIES_BY_ID[b.sp].edibility].value).reduce((a, b) => a + b.weight, 0) / 1000;
  if (kg >= limit) out.push(`Hai già raggiunto il limite di ${limit} kg per questa zona.`);
  return out;
}

/**
 * Controllo di una guardia forestale. Restituisce l'esito e applica multe/sequestri al cestino.
 */
export function rangerInspection(state, exp) {
  const checks = []; // {ok, text}
  let fine = 0;
  const confiscate = new Set();
  const zoneId = exp.world.zoneAt(exp.player.pos.x, exp.player.pos.z);
  const z = ZONE_BY_ID[zoneId];
  const lic = licenseFor(state, zoneId, state.day);
  checks.push({ ok: !!lic, text: lic ? `Permesso per ${z.short}: ${lic.name}` : `Nessun permesso per ${z.short} (ammesse solo passeggiate e foto)` });

  // contenitore e attrezzi
  const bag = exp.container === 'sacchetto';
  if (exp.basket.length) {
    checks.push({ ok: !bag, text: bag ? 'Funghi trasportati in un sacchetto di plastica' : 'Contenitore rigido e aerato' });
    if (bag) fine += 25;
  }
  const rake = exp.state.loadout.includes('rastrello');
  checks.push({ ok: !rake, text: rake ? 'Rastrello: attrezzo vietato, sequestrato' : 'Nessun attrezzo vietato' });
  if (rake) { fine += 100; exp.state.loadout = exp.state.loadout.filter((i) => i !== 'rastrello'); exp.state.owned = exp.state.owned.filter((i) => i !== 'rastrello'); exp.rakeConfiscated = true; }

  // esemplari raccolti illegalmente (segnati al momento della raccolta)
  const illegal = exp.basket.filter((b) => b.issues && b.issues.length);
  if (exp.basket.length) checks.push({ ok: !illegal.length, text: illegal.length ? `${illegal.length} esemplari raccolti in violazione delle regole` : 'Raccolta conforme alle regole di zona' });
  for (const b of illegal) { confiscate.add(b.mid); fine += 15; }

  // limiti di peso per zona
  const byZone = {};
  for (const b of exp.basket) {
    if (!EDIBILITY[SPECIES_BY_ID[b.sp].edibility].value || confiscate.has(b.mid)) continue;
    (byZone[b.zone] ||= []).push(b);
  }
  for (const [zid, items] of Object.entries(byZone)) {
    const zz = ZONE_BY_ID[zid];
    const l = licenseFor(state, zid, state.day);
    const limit = l?.allowsPicking && zz.rules.scientificKg ? zz.rules.scientificKg : zz.rules.kg;
    const kg = items.reduce((a, b) => a + b.weight, 0) / 1000;
    if (kg > limit + 0.05) {
      checks.push({ ok: false, text: `${zz.short}: ${kg.toFixed(2)} kg raccolti, limite ${limit} kg` });
      fine += Math.round((kg - limit) * 40);
      items.sort((a, b) => a.quality - b.quality);
      let over = kg - limit;
      for (const b of items) { if (over <= 0) break; confiscate.add(b.mid); over -= b.weight / 1000; }
    }
  }
  if (Object.keys(byZone).length && ![...checks].some((c) => !c.ok && c.text.includes('limite'))) checks.push({ ok: true, text: 'Quantità entro i limiti' });

  const passed = fine === 0;
  return { checks, fine, confiscate, passed, zone: z };
}

export function rulesSummary(z) {
  const r = z.rules;
  const parts = [
    r.pickingAllowed === false ? 'Raccolta solo con permesso scientifico' : `Max ${r.kg} kg al giorno`,
    daysLabel(r.days), hoursLabel(r.hours),
  ];
  if (r.protected.length) parts.push(`protette: ${r.protected.map((s) => SPECIES_BY_ID[s].name).join(', ')}`);
  for (const [sp, v] of Object.entries(r.speciesRules)) parts.push(v === 'no_giovane' ? `${SPECIES_BY_ID[sp].name} solo maturi` : `${SPECIES_BY_ID[sp].name} max ${v}`);
  return parts;
}

export { CELLS, CELL, ZONES, ZONE_BY_ID };
