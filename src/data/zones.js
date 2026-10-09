// Zone di raccolta: ogni regione è divisa in settori con permessi e regole diverse.
// Le zone si aprono salendo di livello; per raccogliere serve un permesso valido.

export const DAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

// Il giorno 0 della partita è un lunedì
export function dayOfWeek(day) { return ((day % 7) + 7) % 7; }

/*
 * rules:
 *  kg: limite giornaliero di commestibili raccolti nella zona
 *  days: giorni della settimana consentiti (0 = lunedì) oppure 'pari' / 'dispari' (giorno del mese)
 *  hours: 'luce' = dall'alba al tramonto, oppure [inizio, fine]
 *  protected: specie vietate nella zona
 *  speciesRules: { id: 'no_giovane' | numero massimo di esemplari }
 *  pickingAllowed: false = solo osservazione e fotografie
 */
export const ZONES = {
  valfonda: [
    {
      id: 'v_comunale', name: 'Bosco Comunale di Valfonda', short: 'Comunale', level: 0, color: '#d8b45a',
      desc: 'Il bosco attorno al parcheggio, gestito dal Comune. Il posto giusto per imparare.',
      rules: { kg: 3, days: 'tutti', hours: 'luce', protected: [], speciesRules: {} },
      licenses: [
        { id: 'giornaliero', name: 'Tesserino giornaliero', price: 5, days: 1 },
        { id: 'stagionale', name: 'Tesserino stagionale comunale', price: 40, days: 'stagione' },
      ],
    },
    {
      id: 'v_ponente', name: 'Versante di Ponente', short: 'Ponente', level: 1, color: '#7fb0d8', seed: [-125, -10],
      desc: 'Boschi ombrosi sul versante ovest della valle. Gestiti dalla Comunità Montana: raccolta a giorni pari.',
      rules: { kg: 2, days: 'pari', hours: [7, 18], protected: [], speciesRules: { porcino: 6 } },
      licenses: [
        { id: 'giornaliero', name: 'Permesso giornaliero C.M.', price: 8, days: 1 },
        { id: 'settimanale', name: 'Permesso settimanale C.M.', price: 30, days: 7 },
      ],
    },
    {
      id: 'v_levante', name: 'Castagneti di Levante', short: 'Levante', level: 2, color: '#e08a5a', seed: [125, -10],
      desc: 'Castagneti e querceti di un consorzio privato. Ovoli solo a cappello aperto.',
      rules: { kg: 2, days: [1, 3, 5, 6], hours: 'luce', protected: [], speciesRules: { ovolo: 'no_giovane', porcino_nero: 4 } },
      licenses: [
        { id: 'giornaliero', name: 'Permesso consortile giornaliero', price: 12, days: 1 },
        { id: 'stagionale', name: 'Permesso consortile stagionale', price: 55, days: 'stagione' },
      ],
    },
    {
      id: 'v_altavalle', name: 'Alta Valle', short: 'Alta Valle', level: 3, color: '#9ad07a', seed: [-80, -150],
      desc: 'La testata della valle, più fresca e umida. Chiusa il lunedì e il venerdì per la fauna.',
      rules: { kg: 2, days: [1, 2, 3, 5, 6], hours: [6, 19], protected: [], speciesRules: {} },
      licenses: [
        { id: 'giornaliero', name: 'Permesso Alta Valle giornaliero', price: 10, days: 1 },
        { id: 'settimanale', name: 'Permesso Alta Valle settimanale', price: 38, days: 7 },
      ],
    },
    {
      id: 'v_riserva', name: 'Riserva Naturale Orientata', short: 'Riserva', level: 4, color: '#c47ad8', seed: [110, -150],
      desc: 'Area protetta: senza permesso scientifico si può solo osservare e fotografare.',
      rules: { kg: 1, days: [5, 6], hours: [8, 17], protected: ['ovolo', 'spugnola'], speciesRules: {}, pickingAllowed: false, scientificKg: 1 },
      licenses: [
        { id: 'ingresso', name: 'Ingresso riserva (solo fotografie)', price: 3, days: 1 },
        { id: 'scientifico', name: 'Permesso scientifico (raccolta, reputazione ≥ 70)', price: 60, days: 'stagione', reputation: 70, allowsPicking: true },
      ],
    },
  ],
  larici: [
    {
      id: 'l_pascoli', name: 'Pascoli del Rifugio', short: 'Pascoli', level: 3, color: '#d8b45a',
      desc: 'Radure e pinete attorno al rifugio. Regolamento del Parco: raccolta a giorni dispari.',
      rules: { kg: 2, days: 'dispari', hours: 'luce', protected: [], speciesRules: {} },
      licenses: [
        { id: 'giornaliero', name: 'Tesserino del Parco giornaliero', price: 10, days: 1 },
        { id: 'stagionale', name: 'Tesserino del Parco stagionale', price: 70, days: 'stagione' },
      ],
    },
    {
      id: 'l_lariceto', name: 'Lariceto Alto', short: 'Lariceto', level: 5, color: '#7fb0d8', seed: [-120, -40],
      desc: 'Larici e abeti secolari. Limite severo sui porcini.',
      rules: { kg: 1.5, days: 'dispari', hours: [7, 18], protected: [], speciesRules: { porcino: 4, porcino_pinicolo: 4 } },
      licenses: [
        { id: 'giornaliero', name: 'Permesso Lariceto giornaliero', price: 14, days: 1 },
        { id: 'settimanale', name: 'Permesso Lariceto settimanale', price: 50, days: 7 },
      ],
    },
    {
      id: 'l_gallo', name: 'Bosco del Gallo Cedrone', short: 'Gallo Cedrone', level: 6, color: '#c47ad8', seed: [110, -60],
      desc: 'Zona di tutela del gallo cedrone: accesso solo nel fine settimana, nessuna raccolta di dormienti.',
      rules: { kg: 1.5, days: [5, 6], hours: [9, 16], protected: ['dormiente'], speciesRules: {} },
      licenses: [
        { id: 'giornaliero', name: 'Permesso di tutela giornaliero', price: 18, days: 1 },
      ],
    },
    {
      id: 'l_cresta', name: 'Pinete di Cresta', short: 'Cresta', level: 7, color: '#9ad07a', seed: [0, -165],
      desc: 'Pinete esposte sulla cresta. Panorami, vento e porcini rossi.',
      rules: { kg: 2, days: 'tutti', hours: 'luce', protected: [], speciesRules: { porcino_pinicolo: 5 } },
      licenses: [
        { id: 'giornaliero', name: 'Permesso di cresta giornaliero', price: 12, days: 1 },
        { id: 'stagionale', name: 'Permesso di cresta stagionale', price: 60, days: 'stagione' },
      ],
    },
  ],
};

export const ZONE_BY_ID = Object.fromEntries(Object.values(ZONES).flat().map((z) => [z.id, z]));

export function daysLabel(days) {
  if (days === 'tutti') return 'tutti i giorni';
  if (days === 'pari') return 'solo giorni pari del mese';
  if (days === 'dispari') return 'solo giorni dispari del mese';
  return days.map((d) => DAY_SHORT[d]).join(', ');
}

export function hoursLabel(h) {
  return h === 'luce' ? "dall'alba al tramonto" : `dalle ${h[0]}:00 alle ${h[1]}:00`;
}

// Raggio (m) del settore comunale attorno al parcheggio
export const COMMUNAL_RADIUS = 115;
