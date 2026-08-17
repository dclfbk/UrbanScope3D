# Design UrbanScope3D — tema chiaro Talea

Guida di design per chi tocca la UI. Descrive lo stile REALE dell'app
(estratto dal codice ad agosto 2026), non uno ideale: quando aggiungi o
modifichi interfaccia, imita queste ricette invece di inventare.

## Principio guida

**La mappa 3D è la protagonista.** La UI è vetro bianco satinato che
galleggia sopra la scena: pannelli semi-trasparenti con blur, mai superfici
opache grandi, mai elementi che coprono stabilmente il centro della mappa.
Ogni nuovo pannello deve trovare posto in un angolo libero (vedi mappa
posizioni sotto), non sovrapporsi a quelli esistenti.

## Palette

Tre famiglie di colore con ruoli SEPARATI — non mescolarle:

1. **UI chrome (brand Talea)** — token in `app/globals.css`:
   - Brand: blu accento `#1272b7`, verde `#21a84a`, verde scuro `#004d19`,
     giallo `#ffe604` (solo evidenziazioni, es. outline help mode).
   - Scala applicativa (`@theme`, quella da usare nei componenti):
     `talea-100 #04210f` (testo forte), `talea-200 #1f3d2a` (valori),
     `talea-300 #2d5a3d` (testo secondario/link), `talea-400 #1272b7`
     (accento interattivo), `talea-panel #ffffff` (pannelli, quasi sempre
     con opacità /85–/97), `talea-panel-2 #eef3ee` (input, superfici
     secondarie).
   - Muted di fatto (hardcoded storici, riusali identici finché non
     diventano token): `#5a7a67` (label/terziario), `#7a9a87` (muted).
2. **Rampe dati microclima** — `lib/envimetRegistry.ts` (ylorrd, blues,
   greens, magma, viridis). Sono il colore DEI DATI: non usarle per la UI,
   e non colorare i dati coi colori Talea. Le legende si generano con
   `rampCssGradient()`, i campioni puntuali con `rampColorAt()`.
3. **Palette edifici "Bologna"** — `lib/palette.ts` (rossi/ocra/sabbia per
   deck.gl). Riguarda la scena 3D, non la UI.

## Tipografia

- Un solo font effettivo: **Inter** (`--font-sans`). `--font-mono` è
  rimappato su Inter apposta: le classi `font-mono` in giro sono un residuo
  semantico ("etichetta tecnica"), non monospace reale. Va bene continuare
  a usarle in quel ruolo.
- Pattern titolo di pannello (ovunque):
  `text-[10px] font-mono uppercase tracking-widest text-talea-400`.
- Corpi testo piccoli: `text-[11px]`–`text-[13px]`; valori in
  `text-talea-200`, label in `#5a7a67` o `text-muted`.

## Ricetta pannello

Ogni pannello sovrapposto alla mappa usa questa combinazione (ripetuta
~15 volte nel codice — rispettarla alla lettera):

```
bg-talea-panel/85 border border-talea-400/30 rounded p-2 sm:p-3
backdrop-blur-sm shadow-xl
```

- Opacità del bianco crescente con l'importanza/z-index: `/85` pannelli
  normali, `/90` search e chip, `/95` dropdown e modali, `/97` guida.
- Raggio standard `rounded` (4px); i modali usano `rounded-lg`. Non
  introdurre altri raggi nuovi.
- Scala z-index: mappa 0 · night overlay 5 · pannelli 10 · controlli/header
  20 · dropdown/toast 30 · intro 40 · help overlay 60 · loading 100.

Posizioni già occupate (`absolute` sopra la mappa): top-center basemap +
ricerca (+ toggle Zone subito a destra del gruppo) · top-left toggle
layer/"cosa vedere" · top-right bussola (fino a 5rem) e InfoPanel (da
top-24, max-h 65vh−8rem) · right-center slider quota (su desktop spostato
a sinistra della colonna pannelli, ~276px dal bordo) · bottom-left
controlli tondi (meteo si apre sopra, a bottom-16) · bottom-center
TimeSlider e toast · bottom-right legenda (max-h 35vh). InfoPanel e
legenda si spartiscono la colonna destra: non allargare i max-h o tornano
ad accavallarsi.

## Bottoni — quattro stili, non un quinto

1. **Tondo icona** (controlli mappa): `w-10 h-10 rounded-full
   bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl
   text-talea-300 hover:text-talea-100 hover:border-talea-400/60
   transition-colors`.
2. **Pillola testo** (toggle/azioni secondarie): `px-2.5 py-1.5 rounded …
   text-[11px] font-mono uppercase tracking-widest`.
3. **Primario pieno** (conferme): `rounded bg-talea-400 text-white text-sm
   font-bold uppercase tracking-wider hover:bg-talea-300`.
4. **Header verde** (pagina explore): `rounded-full border-[1.5px]
   border-talea-green bg-white text-talea-green-dark hover:bg-talea-green
   hover:text-white`.

## Slider, toggle, legende

- Slider e checkbox sono input NATIVI con `accent-talea-400` — niente
  componenti custom, con l'unica eccezione voluta del sole/luna
  (`.sun-moon-slider` in `globals.css`).
- Legenda (bottom-right): per ogni layer titolo `text-talea-200 text-[11px]
  font-mono`, barra `h-2 rounded` con `background: rampCssGradient(...)`,
  min/max in `#5a7a67 text-[10px]`.

## Animazioni

- Lo standard attuale è sobrio: `transition-colors` (150ms) per hover,
  `duration-200` per chevron/apertura, `duration-300` per scale/fill,
  `duration-500 ease-out` per la barra di caricamento.
- **Mai animare il canvas WebGL via CSS o librerie DOM**: le animazioni di
  scena (vento, caldo, foschia) vivono in `lib/microlive.ts` e
  `lib/windgl/`. Framer-motion & co. possono toccare solo i pannelli UI.
- L'overlay notturno è deliberatamente SENZA transizione (il repaint a
  schermo intero durante il drag del TimeSlider costava troppo): non
  "sistemarlo".
- Se in futuro si aggiungono animazioni di entrata/uscita dei pannelli,
  prevedere `prefers-reduced-motion` (oggi assente).

## Debiti noti — da NON propagare

Incoerenze storiche censite: non peggiorarle imitandole, ma sistemarle è
lavoro a sé, non un effetto collaterale di altri task.

- Colori Tailwind di default residui del vecchio tema scuro
  (`text-red-400` nella bussola, `text-red-300` nel delete,
  `border-amber-400/40` nella barra selezione).
- Popup MapLibre costruiti come stringhe HTML con palette inline propria
  (`#666`, `#222`, `#0e7490`…) diversa dai pannelli React.
- ~~Landing fuori sistema~~ — sistemata il 17/08/2026: barra tricolore
  Talea, accenti `talea-400`/`talea-green`/`talea-yellow`, niente più
  `monospace` inline né azzurri `#5ba4dc`.
- Gradiente del layer rumore duplicato in due punti di `MapViewer.tsx`.
- Geist e Geist Mono caricati in `layout.tsx` ma mai usati.
- Token morti in `:root` di `globals.css` (`--shadow-*`, `--text-*`…):
  i componenti usano le utility Tailwind, non quei token.
