// Attrezzatura: ogni oggetto ha una funzione concreta nel gameplay.

export const EQUIPMENT = [
  { id: 'cestino_piccolo', name: 'Cestino piccolo', slot: 'cestino', price: 0, weight: 0.4, capacity: 2.5, volume: 24,
    desc: 'Leggero, adatto alle uscite brevi. Capacità 2,5 kg.' },
  { id: 'cestino_grande', name: 'Cestino grande', slot: 'cestino', price: 60, weight: 0.9, capacity: 5, volume: 50,
    desc: 'Maggiore capacità (5 kg), ma più ingombrante: consuma un po\' più di energia.' },
  { id: 'coltello', name: 'Coltello da raccolta', slot: 'tool', price: 0, weight: 0.1,
    desc: 'Taglio pulito: i funghi si conservano meglio. Permette di esaminare la base con cura.' },
  { id: 'guida', name: 'Guida micologica', slot: 'tool', price: 25, weight: 0.5,
    desc: 'Consulta tutte le specie durante l\'identificazione, anche quelle mai viste.' },
  { id: 'lente', name: 'Lente d\'ingrandimento', slot: 'tool', price: 35, weight: 0.05,
    desc: 'Rivela i dettagli fini: viraggi, reticoli, squamette, latice.' },
  { id: 'bussola', name: 'Bussola', slot: 'tool', price: 20, weight: 0.08,
    desc: 'Mostra l\'orientamento in alto sullo schermo. Indispensabile nella nebbia.' },
  { id: 'gps', name: 'GPS portatile', slot: 'tool', price: 180, weight: 0.25,
    desc: 'Mostra la tua posizione sulla mappa e permette di salvare punti d\'interesse [G].' },
  { id: 'torcia', name: 'Torcia frontale', slot: 'tool', price: 30, weight: 0.12,
    desc: 'Illumina il sentiero al crepuscolo e di notte [T].' },
  { id: 'impermeabile', name: 'Abbigliamento impermeabile', slot: 'vestiti', price: 90, weight: 0.8,
    desc: 'Mantiene il comfort sotto pioggia e neve.' },
  { id: 'scarponi', name: 'Scarponi da montagna', slot: 'vestiti', price: 110, weight: 1.1,
    desc: 'Meno scivolate sul bagnato e meno fatica in salita.' },
  { id: 'pile', name: 'Pile termico', slot: 'vestiti', price: 45, weight: 0.5,
    desc: 'Protegge dal freddo nelle mattine di gelo e in quota.' },
  { id: 'macchina_foto', name: 'Fotocamera', slot: 'tool', price: 0, weight: 0.3,
    desc: 'Fotografa gli esemplari per la collezione senza raccoglierli.' },
  { id: 'ombrello', name: 'Ombrello', slot: 'tool', price: 22, weight: 0.45,
    desc: 'Apri/chiudi con [U]: ripara da pioggia e neve, ma non si corre e col vento forte può rompersi. Pericoloso nei temporali allo scoperto.' },
  { id: 'bastone', name: 'Bastone da trekking', slot: 'tool', price: 28, weight: 0.3,
    desc: 'Meno fatica in salita e nessuna scivolata in discesa.' },
  { id: 'thermos', name: 'Thermos di tè caldo', slot: 'tool', price: 15, weight: 0.6,
    desc: 'Bevi con [R]: +40 energia e +30 comfort. Due sorsate per uscita.' },
  { id: 'rastrello', name: 'Rastrello', slot: 'tool', price: 12, weight: 0.7,
    desc: 'Smuove la lettiera e scopre i funghi nascosti. VIETATO dalle norme di raccolta: se le guardie lo trovano, multa e sequestro.' },
];

export const EQUIP_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));

export const STARTING_OWNED = ['cestino_piccolo', 'coltello', 'macchina_foto'];

export const REGIONS = [
  {
    id: 'valfonda', name: 'Bosco di Valfonda', seed: 1337, unlockLevel: 0, price: 0,
    desc: 'Valle prealpina con faggete, castagneti, boschi misti e radure. Ideale per iniziare.',
    biomeWeights: { faggeta: 3, misto: 3, conifere: 2, antica: 1, prati: 1.5 },
    alpineHeight: 999, baseHeight: 0, relief: 26, altitude: 900,
  },
  {
    id: 'larici', name: 'Altopiano dei Larici', seed: 9091, unlockLevel: 3, price: 150,
    desc: 'Altopiano di conifere, foresta antica e pascoli in quota. Più freddo, più selvaggio, specie particolari.',
    biomeWeights: { conifere: 4, antica: 2, faggeta: 1, prati: 1, misto: 0.5 },
    alpineHeight: 24, baseHeight: 4, relief: 40, altitude: 1500,
  },
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
