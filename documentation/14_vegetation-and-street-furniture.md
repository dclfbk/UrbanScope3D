# Vegetazione e arredo urbano (dati Comune di Bologna)

Come sono scaricati, preparati e mostrati in 3D gli **alberi** e l'**arredo
urbano** del Comune di Bologna. Aggiunto a giugno 2026.

> Inventario completo dei dataset: [`1_dataset-inventory.md`](./1_dataset-inventory.md).

---

## 1. Dataset usati (Open Data Bologna, Opendatasoft)

| Tema | Dataset id | Contenuto | Geom |
|---|---|---|---|
| Alberi | `alberi-manutenzioni` | ~86k alberi comunali; campo `classe` = specie latina, `classe_circonferenza_diametro` = classe dimensione tronco (Cl1–Cl12) | Punto |
| Arredo | `arredo` | ~14k arredi; campo `classe_arredo` (panchine, cestini, fontane, ringhiere…), `classe_conservazione` | Punto |

Note:
- Gli alberi del Comune sono **più completi e ufficiali** degli OSM usati prima.
- **Lampioni / punti luce: NON sono in open data** (gestiti dal concessionario):
  andranno aggiunti dall'utente nella futura "modalità inserimento".

---

## 2. Download e preparazione

Script: **`scripts/download_bologna_assets.py`**. Per ciascun dataset:

1. scarica il GeoJSON completo dall'API Opendatasoft;
2. ritaglia alla bbox del comune (`11.25, 44.45, 11.45, 44.55`);
3. mappa i campi in proprietà leggere (vedi sotto);
4. **cuoce la quota del terreno** nella `z` di ogni punto (riusa la classe `Dem`
   di `bake_terrain_elevation.py`, tile Terrarium) così poggiano sul terreno 3D;
5. arrotonda le coordinate a 6 decimali per ridurre il peso.

```bash
python scripts/download_bologna_assets.py
```

Output (committati):
```
web/public/data/processed/trees_bologna.geojson    (~85k alberi, ~22 MB)
web/public/data/processed/arredo_bologna.geojson   (~13.7k arredi, ~2 MB)
```

Proprietà salvate:
- **alberi**: `genus`, `species`, `leaf_type` (needleleaved/broadleaved), `circonferenza` (classe tronco), `quartiere`, `pregio`, `cod`.
- **arredo**: `classe`, `conservazione`, `quartiere`.

Per aggiornarli (nuova versione dei dati): rilancia lo script e committa i due
GeoJSON.

---

## 3. Come sono mostrati nel viewer (`web/components/Map/MapViewer.tsx`)

### Alberi (layer "Alberi" / "Trees")
- Sorgente primaria = `trees_bologna.geojson` (fallback OSM → DBTR).
- Modello 3D esistente: tronco + chioma; conifera (cono) vs latifoglia (sfera) da
  `leaf_type`.
- **Altezza guidata dai dati**: oltre alla stima per specie (`GENUS_HEIGHT_M`),
  si scala per la **classe di circonferenza del tronco** (`CIRC_FACTOR`, Cl1≈0.28
  … Cl12≈1.1) + piccolo jitter. Il dataset non ha un'altezza misurata, questa è
  la stima più accurata possibile (alberello piccolo / grande maturo).

### Arredo urbano (layer "Arredo urbano" / "Street furniture")
- Categoria **Edifici**, subito dopo "Edifici 3D"; lazy-load al primo toggle.
- Modelli 3D dedicati per categoria (`arredoKind` dal campo `classe`), ora a
  **geometria tonda** (helper `addCyl` per cilindri/troncoconi componibili):
  - **cestino**: cilindro su palo con orlo svasato;
  - **fontana**: colonna in ghisa rastremata (base, collare, cupolino, beccuccio)
    — riconoscibile a colpo d'occhio (prima era una torretta a scatole, "non si
    vedeva");
  - **panchina**: fianchi a pannello + seduta e schienale a doghe;
  - **ringhiera**: montanti + correnti + pilastrini;
  - **generico / classe vuota** (~3.700 oggetti, 27%): dissuasore/paracarro tondo.
- **Cliccabili**: popup con tipo, stato di conservazione, quartiere.
- Limite noto: i dati **non hanno l'orientamento**, quindi gli oggetti sono tutti
  allineati allo stesso modo.

### Note UI correlate
- `maxZoom` della mappa = 21 (ci si avvicina fino al singolo arredo/albero).
- Etichette dei dati ENVI-met tradotte IT/EN nel viewer (`ENV_LABELS`).

---

## 4. Modalità inserimento utente (in sessione, non salvata)

Toolbar **"＋ Aggiungi"** in basso a destra (collassabile). L'utente posa oggetti
3D cliccando sulla mappa; la `z` è la quota del terreno sotto il clic
(`map.queryTerrainElevation`) così poggiano sul rilievo.

- **Tool a punto** (1 clic): albero, panchina, cestino, fontana, **lampione**
  (modello palo+braccio+lampada), dissuasore.
- **Tool a linea** (2 clic = segmento riempito di copie equidistanti): filare di
  alberi (spacing 8 m), siepe (cespugli, 1,1 m), ringhiera (1,5 m). Il 1° clic
  mostra un pallino giallo, il 2° chiude la linea.
- **Annulla** (ultimo) / **Svuota** (tutto). Stato solo in sessione (niente
  persistenza).

Implementazione (`MapViewer.tsx`): tipi `PlaceKind`/`PlacedObject`/`InsertTool`,
lista `INSERT_TOOLS`, `lineBetween` (copie equidistanti, distanza equirettangolare),
`buildPlacedLayers` (un `SimpleMeshLayer` per tipo, riusa i mesh di alberi/arredo +
`LAMP_MESH`/`PLACED_TREE_*`/`PLACED_SHRUB_MESH`). Il click handler intercetta in
testa quando un tool è attivo (via `insertToolRef`/`lineStartRef`) e posa invece
di aprire popup/probe.

## 5. Da fare (eventuale)

- Persistenza/condivisione degli oggetti inseriti (oggi solo sessione).
- Orientamento panchine stimato dalla strada; rotazione manuale degli oggetti.
- Cancellazione selettiva (clic su un oggetto inserito per rimuoverlo).
