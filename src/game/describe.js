// Generazione delle osservazioni sul campo a partire dalla morfologia reale dell'esemplare.
// Le descrizioni sono diverse da quelle della guida: il giocatore deve confrontarle.
import * as THREE from 'three';
import { UNDER_TYPES, SPECIES } from '../data/species.js';
import { TREE_LABEL, BIOME_LABEL } from '../world/worldgen.js';

const NAMED = {
  'bianco': '#f2efe6', 'crema': '#e8d8b0', 'giallo': '#f0c030', 'giallo oro': '#f4c832', 'ocra': '#c9a058', 'arancio': '#e8742a',
  'rosso vivo': '#c8241a', 'rosso mattone': '#8a3a24', 'rosso sangue': '#a01a14', 'nocciola chiaro': '#b08a5a', 'nocciola': '#8a5a30', 'bruno scuro': '#3e2a1c',
  'nerastro': '#1e1c1c', 'grigio chiaro': '#bdbab2', 'grigio': '#8a8a88', 'grigio ardesia': '#5a5a62', 'verde oliva': '#7a8450',
  'violaceo': '#6a5a86', 'miele': '#c08a3a', 'giallo uovo': '#f0b42a', 'arancio carota': '#e07a2e',
  'marrone': '#7a4a2a', 'castano': '#5e3a22', 'beige': '#d8c8a8', 'bruno rossiccio': '#7a3422', 'bianco sporco': '#dcd6c4',
};
const NAMED_RGB = Object.entries(NAMED).map(([n, h]) => [n, new THREE.Color(h)]);

export function colorName(hex) {
  const c = new THREE.Color(hex);
  let best = 'indefinito', bd = Infinity;
  for (const [n, k] of NAMED_RGB) {
    const d = (c.r - k.r) ** 2 + (c.g - k.g) ** 2 + (c.b - k.b) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

const SHAPE = {
  convesso: { giovane: 'emisferica, ancora chiusa sul gambo', maturo: 'convessa e carnosa', vecchio: 'appianata, con il bordo sollevato' },
  piatto: { giovane: 'convessa', maturo: 'piana, depressa al centro', vecchio: 'piana e irregolare' },
  imbuto: { giovane: 'a piccolo imbuto', maturo: 'a imbuto, con il margine ondulato', vecchio: 'a imbuto, sfrangiata' },
  parasole: { giovane: 'ovoidale, chiusa come una bacchetta di tamburo', maturo: 'ampia, a parasole con un umbone centrale', vecchio: 'larghissima, a ombrello' },
  mensola: { giovane: 'a piccola conchiglia', maturo: 'a conchiglia/orecchio, attaccata lateralmente', vecchio: 'a conchiglia, con il bordo lobato' },
  alveolato: { giovane: 'ovoidale, a nido d\'ape', maturo: 'conico-ovoidale, a nido d\'ape', vecchio: 'allungata, con alveoli scuri' },
  trombetta: { giovane: 'a tromba stretta', maturo: 'a tromba cava, aperta verso l\'alto', vecchio: 'a tromba sfrangiata' },
  pera: { giovane: 'a pera, compatta', maturo: 'a pera', vecchio: 'a pera, con un forellino in cima' },
};
const TEXTURE = {
  liscio: 'liscia', vellutato: 'vellutata e opaca', squame: 'cosparsa di squame scure', zonato: 'a zone concentriche', pruinoso: 'come velata di brina',
  fibrillato: 'percorsa da fini fibrille radiali', perle: 'ricoperta di piccole perle', alveoli: 'con alveoli profondi separati da costole',
};
const STEM = {
  panciuto: 'panciuto, ingrossato in basso', cilindrico: 'cilindrico', slanciato: 'lungo e slanciato', conico: 'pieno, che si allarga verso l\'alto', laterale: 'cortissimo e laterale',
};

export function observe(aspect, ctx) {
  const { sp, stage, capCm, flags, hasLens, hasKnife, baseHidden, nearTrees, substrate, biome, habitatLevel } = ctx;
  const m = sp.morph;
  switch (aspect) {
    case 'cappello': {
      const shape = SHAPE[m.cap.shape]?.[stage] || 'regolare';
      const c1 = colorName(m.cap.color), c2 = colorName(m.cap.color2);
      let t = `Colore ${c1}${c2 !== c1 ? `, sfumato di ${c2}` : ''}. Forma ${shape}; superficie ${TEXTURE[m.cap.texture] || 'liscia'}.`;
      if (m.cap.spots) t += flags.washed ? ' Restano pochi residui bianchi (la pioggia li ha lavati).' : ' Cosparsa di verruche bianche in rilievo.';
      if (m.cap.striato) t += ' Il margine è finemente striato.';
      t += ` Diametro circa ${capCm.toFixed(0)} cm.`;
      if (flags.eaten) t += ' Sul bordo c\'è il morso di un animale.';
      if (flags.slugs) t += ' Una lumaca ci sta banchettando.';
      if (hasLens && m.cap.texture === 'squame') t += ' (Lente) Le squame sono fibrose e si staccano facilmente.';
      return t;
    }
    case 'sotto': {
      const type = m.under.type;
      if (type === 'nessuna') return 'Non ci sono né lamelle né pori: il corpo è chiuso. Premendolo è sodo.' + (hasLens ? ` (Lente) ${sp.look.sotto}` : '');
      if (type === 'alveoli') return 'Non c\'è una parte inferiore distinta: il cappello è una spugna alveolata saldata al gambo.' + (hasLens ? ' (Lente) All\'interno è completamente cavo.' : '');
      const col = colorName(stage === 'vecchio' && m.under.colorOld ? m.under.colorOld : m.under.color);
      let t = `${UNDER_TYPES[type]} di colore ${col}.`;
      if (type === 'pieghe' || m.cap.shape === 'imbuto') t += ' Scendono lungo il gambo (decorrenti).';
      if (hasLens) t += ` (Lente) ${sp.look.sotto}`;
      else if (type === 'pori') t += ' Servirebbe una lente per osservare meglio i pori e la loro reazione al tocco.';
      return t;
    }
    case 'gambo': {
      if (m.stem.shape === 'nessuno') return 'Nessun gambo distinto: il corpo fruttifero si restringe verso il basso.';
      const c1 = colorName(m.stem.color), c2 = colorName(m.stem.color2 || m.stem.color);
      let t = `Gambo ${STEM[m.stem.shape] || 'cilindrico'}, ${c1}${c2 !== c1 ? ` con tonalità ${c2}` : ''}.`;
      t += m.stem.ring ? ' Porta un ANELLO membranoso.' : ' Nessun anello.';
      if (m.stem.zebrato) t += ' È decorato da zebrature trasversali.';
      if (m.stem.squame) t += ' È coperto di squamette scure.';
      if (m.stem.reticolo) t += hasLens ? ' (Lente) La parte alta è percorsa da un reticolo in rilievo.' : ' Sembra esserci un disegno in rilievo: con una lente si vedrebbe meglio.';
      if (m.stem.scrobicoli && hasLens) t += ' (Lente) Piccole fossette più scure.';
      if (hasLens && !m.stem.reticolo) t += ` (Lente) ${sp.look.gambo}`;
      return t;
    }
    case 'base': {
      if (m.growth === 'mensola') return 'Non c\'è una base nel terreno: il fungo è attaccato direttamente al legno.';
      if (m.growth === 'cespitoso') return 'Gli esemplari sono uniti alla base in un cespo che parte dal legno. Nessuna volva.';
      if (!hasKnife && baseHidden) return 'La base è interrata tra foglie e terriccio: senza coltello non riesci a esaminarla senza rovinare il fungo.';
      const pre = hasKnife ? 'Scavando con cura con il coltello: ' : 'Spostando il terriccio con le dita: ';
      if (m.stem.volva) return pre + 'alla base c\'è una VOLVA bianca e membranosa, a forma di sacco.';
      if (m.stem.volvaWarts) return pre + 'la base è un bulbo circondato da cercini di verruche bianche (resti di volva).';
      if (m.stem.bulbo) return pre + 'la base è bulbosa, senza volva.';
      return pre + 'la base è semplice, senza volva né bulbo.';
    }
    case 'habitat': {
      const counts = {};
      for (const t of nearTrees) counts[t.type] = (counts[t.type] || 0) + 1;
      const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${TREE_LABEL[k]}`);
      let t = `${BIOME_LABEL[biome]}. ${parts.length ? `Alberi entro 8 m: ${parts.join(', ')}.` : 'Nessun albero nelle immediate vicinanze.'}`;
      t += substrate === 'legno' ? ' Cresce sul legno morto.' : ' Cresce sul terreno.';
      if (habitatLevel >= 2) {
        const assoc = Object.keys(sp.trees);
        const near = assoc.filter((a) => counts[a]);
        if (near.length) t += ` (Esperienza) Probabile legame con: ${near.map((a) => TREE_LABEL[a]).join(', ')}.`;
      }
      return t;
    }
  }
  return '';
}

// Colori del cappello compatibili per specie (per il filtro della guida)
const CAP_COMPAT = {
  colombina: ['violetto', 'verde', 'grigio'], satanas: ['bianco', 'grigio'], mazza_tamburo: ['marrone', 'bianco'], chiodino: ['giallo', 'marrone'],
  spugnola: ['giallo', 'marrone'], steccherino: ['bianco', 'giallo', 'arancio'], nebbiolina: ['grigio', 'bianco'], amanita_muscaria: ['rosso', 'arancio'],
  ovolo: ['arancio', 'rosso'], amanita_phalloides: ['verde', 'bianco', 'giallo'], porcino_pinicolo: ['rosso', 'marrone'], dormiente: ['grigio', 'nero'],
  sanguinello: ['arancio'], vescia: ['bianco'], trombetta: ['nero', 'grigio'], porcino_nero: ['marrone', 'nero'],
};
export function capCompat(sp) { return CAP_COMPAT[sp.id] || [sp.traits.capColor]; }

export function candidates(pool, trueSp, observed, revealedBase) {
  return pool.filter((c) => {
    if (observed.cappello && !capCompat(c).includes(trueSp.traits.capColor)) return false;
    if (observed.sotto && c.traits.under !== trueSp.traits.under) return false;
    if (observed.gambo && c.traits.ring !== trueSp.traits.ring) return false;
    if (observed.base && revealedBase && c.traits.volva !== trueSp.traits.volva) return false;
    if (observed.habitat && c.traits.substrate !== trueSp.traits.substrate) return false;
    return true;
  });
}

export { SPECIES };
