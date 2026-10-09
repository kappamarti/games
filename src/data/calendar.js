// Calendario di gioco: il giorno 0 è il 1° settembre dell'anno 1.

export const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export const START_DOY = 243; // 1 settembre

export function dayOfYear(day) { return (START_DOY + day) % 365; }
export function yearOf(day) { return 1 + Math.floor((START_DOY + day) / 365); }

export function dateOf(day) {
  const doy = dayOfYear(day);
  let m = 11;
  while (m > 0 && MONTH_START[m] > doy) m--;
  return { day: doy - MONTH_START[m] + 1, month: m, year: yearOf(day), doy };
}

export function formatDate(day, short = false) {
  const d = dateOf(day);
  return short ? `${d.day} ${MONTHS[d.month].slice(0, 3)}` : `${d.day} ${MONTHS[d.month]}, anno ${d.year}`;
}

export function seasonOf(day) {
  const doy = dayOfYear(day);
  if (doy >= 79 && doy < 172) return 'primavera';
  if (doy >= 172 && doy < 265) return 'estate';
  if (doy >= 265 && doy < 355) return 'autunno';
  return 'inverno';
}

export const SEASON_LABEL = { primavera: 'Primavera', estate: 'Estate', autunno: 'Autunno', inverno: 'Inverno' };

// Ore di alba e tramonto approssimate (latitudine ~46°N)
export function sunTimes(day) {
  const doy = dayOfYear(day);
  const decl = Math.sin(((doy - 80) / 365) * Math.PI * 2); // -1 inverno .. +1 estate
  const dayLen = 12 + 3.6 * decl;
  const noon = 12.9;
  return { sunrise: noon - dayLen / 2, sunset: noon + dayLen / 2, dayLength: dayLen };
}

export function formatTime(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Fattore di stagionalità morbido [0..1] per finestre DOY (gestisce il passaggio d'anno)
export function seasonFactor(doy, windows) {
  let best = 0;
  for (const [a, b] of windows) {
    const len = (b - a + 365) % 365;
    const pos = (doy - a + 365) % 365;
    if (pos <= len) {
      const edge = Math.min(pos, len - pos);
      const ramp = Math.min(1, edge / Math.max(6, len * 0.2));
      best = Math.max(best, 0.35 + 0.65 * ramp);
    } else {
      // coda morbida fuori stagione (qualche esemplare precoce/tardivo)
      const dist = Math.min((a - doy + 365) % 365, (doy - b + 365) % 365);
      if (dist < 10) best = Math.max(best, 0.25 * (1 - dist / 10));
    }
  }
  return best;
}
