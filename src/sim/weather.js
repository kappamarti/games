// Sistema meteorologico con memoria: genera giorni in sequenza (catena di Markov
// stagionale), conserva lo storico e produce previsioni imperfette.
import { mulberry32, hash2, clamp, lerp, pickWeighted, gaussian } from '../core/rng.js';
import { dayOfYear, sunTimes } from '../data/calendar.js';

export const WEATHER_TYPES = {
  sereno: { label: 'Sereno', icon: '☀️' },
  variabile: { label: 'Variabile', icon: '⛅' },
  nuvoloso: { label: 'Nuvoloso', icon: '☁️' },
  pioggia: { label: 'Pioggia', icon: '🌧️' },
  pioggia_intensa: { label: 'Pioggia intensa', icon: '🌧️🌧️' },
  temporale: { label: 'Temporale', icon: '⛈️' },
  nebbia: { label: 'Nebbia fitta', icon: '🌫️' },
  neve: { label: 'Neve', icon: '🌨️' },
  gelo: { label: 'Gelo e brina', icon: '❄️' },
  sole_dopo_pioggia: { label: 'Sole dopo la pioggia', icon: '🌤️' },
};

const BASE_ALT = 900;

function climate(doy) {
  const meanT = 8.5 + 10 * Math.sin((2 * Math.PI * (doy - 110)) / 365);
  // probabilità di "giorno perturbato" per stagione
  const wet = 0.32 + 0.12 * Math.sin((2 * Math.PI * (doy - 200)) / 365) + 0.08 * Math.exp(-(((doy - 305) / 30) ** 2));
  const storm = Math.max(0, Math.sin((2 * Math.PI * (doy - 100)) / 365)) * 0.22; // estate
  const fog = 0.06 + 0.16 * Math.max(0, Math.cos((2 * Math.PI * (doy - 320)) / 365));
  return { meanT, wet, storm, fog };
}

export function createWeatherState(seed) {
  return { seed, history: {}, forecastNoise: {}, prevType: 'variabile', generatedUntil: -61 };
}

// Garantisce che i giorni fino a `day` siano generati
export function ensureDays(ws, day) {
  while (ws.generatedUntil < day) {
    const d = ws.generatedUntil + 1;
    ws.history[d] = generateDay(ws, d, ws.history[d - 1]);
    ws.prevType = ws.history[d].baseType;
    ws.generatedUntil = d;
    if (d % 20 === 0) for (const k of Object.keys(ws.history)) if (+k < d - 75) delete ws.history[k];
  }
}

function generateDay(ws, d, prev) {
  const rand = mulberry32((ws.seed * 7919 + d * 104729) >>> 0);
  const doy = dayOfYear(d);
  const c = climate(doy);
  const p = prev ? prev.baseType : 'variabile';
  const persist = (t) => (t === p ? 1.6 : 1);
  const weights = [
    ['sereno', (1 - c.wet) * 0.55 * persist('sereno')],
    ['variabile', 0.28 * persist('variabile')],
    ['nuvoloso', 0.18 * persist('nuvoloso')],
    ['pioggia', c.wet * 0.55 * persist('pioggia') * (p === 'pioggia' || p === 'nuvoloso' ? 1.4 : 1)],
    ['pioggia_intensa', c.wet * 0.16 * (p === 'pioggia' ? 1.8 : 1)],
    ['temporale', c.storm * (p === 'sereno' || p === 'variabile' ? 1.3 : 0.8)],
    ['nebbia', c.fog * (p === 'pioggia' || p === 'nebbia' ? 1.8 : 1)],
  ];
  // una settimana piovosa prima dell'inizio della partita: la prima uscita trova un bosco vivo
  const baseType = d >= -12 && d <= -7 ? (d % 2 ? 'pioggia' : 'pioggia_intensa') : pickWeighted(weights, rand);
  // temperatura: anomalia persistente (autocorrelata)
  const anom = (prev ? prev.anom * 0.7 : 0) + gaussian(rand) * 1.6;
  const cloudy = { sereno: 0, variabile: 0.4, nuvoloso: 0.8, pioggia: 1, pioggia_intensa: 1, temporale: 0.5, nebbia: 0.7 }[baseType];
  const range = lerp(11, 4, cloudy);
  const mean = c.meanT + anom - (baseType === 'pioggia_intensa' ? 1.5 : 0);
  const tMin = mean - range * 0.5, tMax = mean + range * 0.5;
  let rain = 0;
  if (baseType === 'variabile') rain = rand() < 0.35 ? rand() * 3 : 0;
  if (baseType === 'nuvoloso') rain = rand() < 0.3 ? rand() * 1.5 : 0;
  if (baseType === 'pioggia') rain = 5 + rand() * 12;
  if (baseType === 'pioggia_intensa') rain = 20 + rand() * 28;
  if (baseType === 'temporale') rain = 8 + rand() * 22;
  if (baseType === 'nebbia') rain = rand() * 0.6;
  const st = sunTimes(d);
  const sun = Math.max(0, st.dayLength * (1 - cloudy) - (baseType === 'nebbia' ? 3 : 0));
  return {
    day: d, baseType, anom,
    tMin: +tMin.toFixed(1), tMax: +tMax.toFixed(1), rain: +rain.toFixed(1), sun: +sun.toFixed(1),
    humidity: Math.round(clamp(55 + cloudy * 35 + (rain > 0 ? 8 : 0) + rand() * 6, 35, 100)),
    wind: +clamp((baseType === 'temporale' ? 0.6 : 0.15) + rand() * 0.35, 0, 1).toFixed(2),
    fogMorning: baseType === 'nebbia' || (rand() < c.fog * 1.5 && cloudy < 0.6),
    rainStart: 4 + rand() * 10, rainLen: 3 + rand() * 9, stormHour: 13 + rand() * 4.5, showerHour: 10 + rand() * 7,
  };
}

// Versione regionale del giorno (quota, neve, gelo, "sole dopo la pioggia")
export function regionalDay(ws, day, region) {
  ensureDays(ws, day);
  if (!ws.history[day]) ws.history[day] = generateDay(ws, day, null);
  if (!ws.history[day - 1]) ws.history[day - 1] = generateDay(ws, day - 1, null);
  const base = ws.history[day];
  const prev = ws.history[day - 1];
  const off = -((region.altitude - BASE_ALT) / 1000) * 6.5;
  const r = { ...base, tMin: +(base.tMin + off).toFixed(1), tMax: +(base.tMax + off).toFixed(1), type: base.baseType };
  const meanT = (r.tMin + r.tMax) / 2;
  r.snow = 0;
  if (r.rain > 0.5 && meanT < 1.2) { r.snow = +(r.rain * 1.1).toFixed(1); r.type = 'neve'; }
  if ((r.type === 'sereno' || r.type === 'variabile') && r.tMin < -0.5) r.type = 'gelo';
  if ((r.type === 'sereno' || r.type === 'variabile') && prev && prev.rain > 7 && r.type !== 'gelo') r.type = 'sole_dopo_pioggia';
  return r;
}

// Condizioni orarie per il rendering e il gameplay
export function hourly(rec, hour) {
  const t = rec.type;
  const temp = lerp(rec.tMin, rec.tMax, 0.5 - 0.5 * Math.cos(((clamp(hour, 6, 15) - 6) / 9) * Math.PI)) - (hour > 15 ? (hour - 15) * (rec.tMax - rec.tMin) / 15 : 0);
  let cloud = 0.08, rain = 0, snow = 0, fog = 0, wind = rec.wind * 0.6, lightning = 0;
  const fogMorning = rec.fogMorning ? clamp(1 - (hour - 7.5) / 3, 0, 1) * 0.75 : 0;
  switch (t) {
    case 'sereno': case 'gelo': cloud = 0.06; fog = fogMorning; break;
    case 'sole_dopo_pioggia': cloud = 0.25 + 0.15 * Math.sin(hour); fog = Math.max(fogMorning, clamp(1 - (hour - 7) / 2.5, 0, 1) * 0.45); break;
    case 'variabile': {
      cloud = 0.45 + 0.25 * Math.sin(hour * 1.3);
      if (rec.rain > 0 && Math.abs(hour - rec.showerHour) < 0.7) rain = 0.35;
      fog = fogMorning * 0.6; break;
    }
    case 'nuvoloso': cloud = 0.85; if (rec.rain > 0 && Math.abs(hour - rec.showerHour) < 1) rain = 0.15; fog = fogMorning * 0.5 + 0.08; break;
    case 'pioggia': {
      cloud = 1;
      const on = hour >= rec.rainStart && hour <= rec.rainStart + rec.rainLen;
      rain = on ? 0.55 : 0.12; fog = 0.18; wind = rec.wind * 0.8; break;
    }
    case 'pioggia_intensa': cloud = 1; rain = 0.75 + 0.25 * Math.sin(hour * 0.9); fog = 0.3; wind = rec.wind; break;
    case 'temporale': {
      const s = rec.stormHour;
      if (hour < s - 2.5) { cloud = 0.25; }
      else if (hour < s) { cloud = lerp(0.3, 1, (hour - (s - 2.5)) / 2.5); wind = lerp(0.2, 0.7, (hour - (s - 2.5)) / 2.5); }
      else if (hour < s + 2.2) { cloud = 1; rain = 0.95; wind = 1; lightning = 1; fog = 0.15; }
      else { cloud = lerp(1, 0.4, clamp((hour - s - 2.2) / 2, 0, 1)); rain = hour < s + 3 ? 0.3 : 0; }
      break;
    }
    case 'nebbia': cloud = 0.7; fog = Math.max(0.55, 0.95 - clamp((hour - 9) / 6, 0, 1) * 0.4); wind = 0.05; break;
    case 'neve': cloud = 1; snow = 0.7; fog = 0.35; break;
  }
  return { temp: +temp.toFixed(1), cloud: clamp(cloud, 0, 1), rain, snow, fog: clamp(fog, 0, 1), wind: clamp(wind, 0, 1), lightning };
}

// Previsione imperfetta: l'errore cresce con l'orizzonte e cala con l'abilità di pianificazione
export function forecast(ws, today, ahead, region, planningLevel = 0) {
  const out = [];
  for (let k = 0; k <= ahead; k++) {
    const d = today + k;
    const real = regionalDay(ws, d, region);
    if (k === 0) { out.push({ ...real, certainty: 1 }); continue; }
    const acc = clamp(0.9 - k * 0.14 + planningLevel * 0.03, 0.4, 0.97);
    const h = hash2(d, k, ws.seed);
    let type = real.type;
    if (h > acc) {
      const alt = { sereno: 'variabile', variabile: h > 0.5 ? 'sereno' : 'pioggia', nuvoloso: 'pioggia', pioggia: 'nuvoloso', pioggia_intensa: 'pioggia', temporale: 'variabile', nebbia: 'nuvoloso', neve: 'nuvoloso', gelo: 'sereno', sole_dopo_pioggia: 'variabile' };
      type = alt[type] || type;
    }
    const err = (1 - acc) * 6;
    out.push({
      ...real, type,
      tMin: +(real.tMin + (hash2(d, 11, ws.seed) - 0.5) * err).toFixed(0),
      tMax: +(real.tMax + (hash2(d, 12, ws.seed) - 0.5) * err).toFixed(0),
      rain: Math.max(0, Math.round(real.rain * (0.6 + hash2(d, 13, ws.seed) * 0.8))),
      certainty: acc,
    });
  }
  return out;
}

// Record artificiale per la modalità libera
export function freeDay(day, type, baseRec) {
  const presets = {
    sereno: { rain: 0, tMin: 7, tMax: 19 }, sole_dopo_pioggia: { rain: 0, tMin: 8, tMax: 17 }, nuvoloso: { rain: 0, tMin: 9, tMax: 15 },
    pioggia: { rain: 12, tMin: 8, tMax: 13 }, pioggia_intensa: { rain: 35, tMin: 7, tMax: 11 }, temporale: { rain: 18, tMin: 13, tMax: 24 },
    nebbia: { rain: 0, tMin: 5, tMax: 11 }, neve: { rain: 10, tMin: -4, tMax: 0 }, gelo: { rain: 0, tMin: -4, tMax: 6 }, variabile: { rain: 1, tMin: 8, tMax: 17 },
  };
  const p = presets[type] || presets.sereno;
  return { ...baseRec, ...p, type, baseType: type, fogMorning: type === 'nebbia' || type === 'sole_dopo_pioggia', snow: type === 'neve' ? 8 : 0, wind: type === 'temporale' ? 0.7 : 0.2, rainStart: 8, rainLen: 10, stormHour: 11.5, showerHour: 12 };
}
