# 🍄 Mushroom Hunter

Simulatore di raccolta funghi in prima persona, ispirato a *Fishing Planet*: leggi il bosco,
interpreta il meteo (che ha memoria), studia alberi e terreno, trova, osserva e identifica
le specie — e torna all'auto prima del buio.

Prototipo web realizzato con **Three.js + [threepipe](https://github.com/repalash/threepipe) + Vite**, tutto procedurale
(nessun asset esterno): terreno, alberi, sottobosco, texture, modelli dei funghi e audio vengono generati dal codice.

## Grafica

Il rendering usa la pipeline di **threepipe** (dalla lista GitHub *graphics-library*, l'unica libreria web/three.js):

- pipeline HDR half-float con tone mapping ACES, contrasto e saturazione;
- **SSAO** (occlusione ambientale) dal G-buffer;
- **ombre a cascata (CSM)** del sole, morbide e stabili su tutta la scena vicina;
- illuminazione d'ambiente PBR generata dal cielo (aggiornata con ora e meteo);
- grana pellicola e leggera aberrazione cromatica;
- chiome fatte di "carte" di fogliame con normali sferiche, conifere a rami stratificati, LOD per gli alberi lontani;
- normal map procedurali per terreno, cortecce, rocce e tronchi; rametti, sassi, muschio e fiori attorno al giocatore;
- funghi con materiale fisico (velluto/sheen) che diventa lucido con la pioggia.

Preset di qualità (menu Pausa → *Qualità grafica*): **Bassa**, **Media** (predefinita sulle GPU integrate),
**Alta** (predefinita sulle GPU dedicate) e **Ultra**. Su una Intel Iris Xe il preset Media gira a circa 35–40 fps.

> Nota licenze: threepipe è Apache-2.0. I plugin aggiuntivi `@threepipe/webgi-plugins` (bloom, DOF, SSR) sono GPL-3.0
> e non sono stati inclusi per non imporre la GPL al progetto.

> ⚠ È una simulazione. Non usarla mai per identificare funghi reali.

## Avvio

```bash
npm install
npm run dev
```

Poi apri http://localhost:5173. Per una build statica: `npm run build` (output in `dist/`).

Galleria di sviluppo con tutti i modelli dei funghi: http://localhost:5173/?test=funghi

## Comandi nel bosco

| Tasto | Azione |
|---|---|
| Clic sul gioco | Cattura il mouse (oppure trascina col tasto destro per guardarti intorno) |
| W A S D / frecce | Muoviti |
| Shift | Corri (consuma energia) |
| C / Ctrl | Accovacciati (vedi meglio i funghi nascosti) |
| E | Esamina il fungo nel mirino / termina la spedizione vicino all'auto |
| M | Mappa |
| Tab | Cestino |
| H | Lettura del bosco (umidità, temperatura, habitat, visibilità) |
| G | Salva un punto d'interesse (serve il GPS) |
| T | Torcia frontale (se nello zaino) |
| Esc | Pausa e impostazioni (sensibilità, volume, velocità del tempo, ombre, risoluzione) |

## Cosa c'è

- **Spedizioni**: scegli regione, orario di partenza, modalità e attrezzatura nella baita; nel bosco il
  tempo scorre, il sole tramonta, l'energia e il comfort calano con fatica, pioggia e freddo.
- **Meteo con memoria**: giorni generati in sequenza (catena di Markov stagionale), umidità del suolo,
  neve che si accumula e si scioglie, previsioni imperfette (migliorano con la Pianificazione).
  Condizioni: sereno, variabile, nuvoloso, pioggia, pioggia intensa, temporale (con fulmini e tuoni),
  nebbia fitta, neve, gelo e brina, sole dopo la pioggia.
- **Ecosistema**: il bosco è diviso in celle con biomi, alberi, legno morto, esposizione e vicinanza al
  torrente. Ogni giorno le specie fruttificano secondo stagione, temperatura e piogge di qualche giorno
  prima; i funghi crescono, invecchiano, vengono mangiati da animali o lumache e marciscono.
  Raccogliere non fa ricomparire funghi nello stesso punto.
- **21 specie** con modelli 3D procedurali distinti (cappello, pori/lamelle/pliche/aculei, gambo, anello,
  volva, verruche, stadi giovane/maturo/vecchio, morsi e lumache): porcini (3 specie), finferlo, trombetta
  dei morti, steccherino, mazza di tamburo, chiodino, spugnola, dormiente, colombina, sanguinello,
  porcinello, ovolo buono, orecchione, nebbiolina, Amanita muscaria/pantherina/phalloides, porcino
  malefico, vescia.
- **Nessun fungo evidenziato**: i funghi sono coperti da foglie ed erba; quelli molto coperti si notano
  solo accovacciandosi.
- **Ispezione e identificazione**: modello ruotabile, osservazione di cappello, parte inferiore, gambo,
  base (meglio col coltello) e habitat; lente per i dettagli fini; guida micologica per confrontare le
  specie compatibili. Fotografa o raccogli.
- **Centro micologico**: verifica le identificazioni, scarta i tossici, distrugge il raccolto se c'è una
  specie mortale nel cestino, applica le regole (limite di 3 kg, porcini troppo piccoli), assegna incarichi.
- **Baita**: pianificazione, bollettino e storico meteo, negozio (12 oggetti), diario delle spedizioni,
  enciclopedia, mappe con zone esplorate e punti GPS, competenze (Osservazione, Micologia, Habitat,
  Orientamento, Pianificazione), parete delle fotografie.
- **Due regioni**: Bosco di Valfonda (900 m) e Altopiano dei Larici (1500 m, da sbloccare).
- **Modalità**: simulazione (realistica) e libera (meteo a scelta, bosco generoso, nessuna sanzione).
- Salvataggio automatico nel browser (localStorage).

## Zone, permessi e guardie forestali

- Ogni regione è divisa in **zone** (Bosco Comunale, Versante di Ponente, Castagneti di Levante, Alta Valle,
  Riserva Naturale Orientata; sull'Altopiano dei Larici: Pascoli, Lariceto Alto, Bosco del Gallo Cedrone, Pinete di Cresta).
- Le zone si **aprono salendo di livello** (barre di esperienza nella baita); quelle chiuse sono sbarrate.
- Per raccogliere serve un **permesso** (giornaliero, settimanale, stagionale, consortile, scientifico) da comprare
  nella scheda *Permessi e zone*. Ogni zona ha regole proprie: limite di kg, giorni consentiti (anche pari/dispari),
  orari, specie protette, numero massimo di esemplari, solo esemplari maturi.
- Regole generali: niente raccolta di notte, porcini sopra i 4 cm, contenitore rigido (vietato il sacchetto di
  plastica), vietato il rastrello.
- Le **guardie del Corpo Forestale** pattugliano i sentieri, ti notano e ti controllano; a volte aspettano al
  parcheggio. Multe, sequestri e reputazione. Puoi anche fermarle con **E** per chiedere informazioni.
- Attrezzatura: **ombrello** [U] (ripara dalla pioggia, ma col vento si rompe ed è pericoloso nei temporali),
  **torcia** [T], **bastone da trekking**, **thermos** [R], **rastrello** (efficace ma illegale).

## Risoluzione e 4K

*Impostazioni* (nella baita) o Pausa → **Risoluzione**: Automatica, 1080p, 1440p, **4K (2160p)**.
Per il 4K usa il browser a schermo intero (F11) e assicurati che usi la scheda NVIDIA
(Windows → Impostazioni → Sistema → Schermo → Grafica → browser → *Prestazioni elevate*).

## Non ancora implementato

- Cooperativa online fino a 4 giocatori (previsto dal design, richiede un server).
- Grafica fotorealistica da Unreal Engine 5: questo prototipo punta su atmosfera e sistemi di gioco.

## Struttura

```
src/
  core/     rng e rumore, audio procedurale
  data/     specie, attrezzatura e regioni, calendario
  sim/      meteo con memoria, ecosistema di crescita
  world/    generazione del mondo (terreno, biomi, sentieri, alberi, celle)
  render/   terreno, vegetazione, copertura del suolo, atmosfera, modelli dei funghi, texture
  game/     stato e salvataggi, spedizione, giocatore, descrizioni d'osservazione
  ui/       baita, ispezione, mappa, miniature
```
