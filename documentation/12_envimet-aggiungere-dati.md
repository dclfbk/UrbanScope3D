# ENVI-met — come aggiungere o modificare i dati

Guida pratica per: aggiungere una nuova variabile, renderla "curata" (slider +
click), cambiare le quote mostrate, i colori, le etichette, oppure sostituire la
simulazione con un'altra (altro giorno, oppure UTCI/PET).

> Per **capire cosa contengono** i dati vedi
> [`11_envimet-data-reference.md`](./11_envimet-data-reference.md).

Tutto passa da **un solo script**: `scripts/build_envimet_overlays.py`.

---

## 0. Come funziona la pipeline (in breve)

```
web/public/data/Envimet_data/NN_nome_all_z.tif   (input: GeoTIFF 54 bande)
            │
            ▼   python scripts/build_envimet_overlays.py
            │
web/public/data/processed/envimet/
    ├── <key>.png                (overlay a terra di ogni variabile)
    ├── <key>__zN.png            (un PNG per quota, solo curati con slider)
    ├── <key>.values.json        (griglia valori per il click, solo curati)
    └── overlays.json            (meta unico: bounds, range, legenda, quote…)
web/public/data/processed/buildings_heights.geojson
    └── + air_temp e mrt_col iniettati in ogni edificio
```

I `.tif` ENVI-met **non hanno CRS**: lo script prende georeferenziazione e
rotazione da `web/public/data/04_Velocita_Vento.tif` (stessa griglia 253×273) e li
applica ai multibanda. Le bande vengono **capovolte** (`np.flipud`) perché
ENVI-met esporta "south-up".

**Dipendenze:** `rasterio`, `numpy`, `Pillow`. Lancio:

```bash
python scripts/build_envimet_overlays.py
```

---

## 1. Aggiungere una nuova variabile "extra" (automatico)

Le variabili **extra** (a terra, senza slider/click) sono prese **in automatico**:
basta mettere il nuovo file `NN_nome_all_z.tif` in `web/public/data/Envimet_data/`
e rilanciare lo script. La funzione `build_extra_variables()` raccoglie tutti i
`*_all_z.tif` non già curati.

Per dargli un nome italiano leggibile, aggiungi una voce in **`IT_LABELS`**
(altrimenti usa il `long_name` inglese del tif):

```python
IT_LABELS = {
    ...
    "nome_key": "Etichetta in italiano",
}
```

La `key` è il nome del file senza il prefisso numerico e senza `_all_z`
(es. `32_co2_all_z.tif` → `co2`).

---

## 2. Promuovere una variabile a "curata" (slider quote + valore al click)

I 7 dati curati sono nella lista **`CURATED`**. Aggiungi una riga:

```python
CURATED = [
    ...
    # (key, file, label IT, unità, rampa colore, aggregazione)
    ("nuova_key", "NN_nome_all_z.tif", "Etichetta IT", "°C", "ylorrd", "band"),
]
```

Campi:
- **key**: nome interno (usato nei PNG e in `overlays.json`).
- **file**: nome del `.tif`.
- **label / unità**: testo mostrato in legenda.
- **rampa**: una di `ylorrd` (caldo), `blues` (acqua/umidità), `greens`
  (vegetazione), `magma` (radiazione), `viridis` (generica), `rdbu` (divergente
  +/−). Definite in `RAMPS`.
- **aggregazione**:
  - `"band"` → usa la banda pedonale + genera i PNG dello slider quote;
  - `"maxz"` → massimo lungo la colonna (utile per la vegetazione).

Poi (consigliato) fissa il **range colore** in **`FIXED_RANGES`** così la scala è
stabile e confrontabile (senza, ricade sul percentile 2–98 del singolo overlay):

```python
FIXED_RANGES = {
    ...
    "nuova_key": (vmin, vmax),
}
```

Solo i curati con `agg="band"` ottengono lo slider quote e la griglia valori per
il click.

---

## 3. Cambiare le quote mostrate dallo slider

Modifica **`HEIGHT_BANDS`** (indici di banda, 0-based):

```python
# attuale (scelta guidata dai dati): 1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 25.5, 40.5, 58.5 m
# (58.5 m = banda 23, "sopra ogni edificio": il piu' alto nel dominio e' 50.1 m)
HEIGHT_BANDS = [2, 5, 6, 7, 8, 9, 12, 17, 23]
```

⚠️ Sono **indici di banda**, non metri. La griglia esiste solo a passo di 3 m sopra
i 4.5 m → vedi la tabella di mappatura indice↔metri in
[`11_envimet-data-reference.md`](./11_envimet-data-reference.md#come-cambiare-le-quote).
Più quote = più PNG (poche decine, costo basso). Dopo la modifica **rigenera**.

Lo slider nel viewer è **proporzionale ai metri reali** e aggancia la quota più
vicina: aggiungere/togliere quote non richiede modifiche al viewer, solo a
`HEIGHT_BANDS` + rigenerazione.

> Nota: `Z_BAND = 2` è la quota di **default** (pedonale ~1.5 m) usata per l'overlay
> a terra e per il campionamento di `air_temp` sugli edifici.

---

## 4. Cambiare colori, etichette, descrizioni

- **Range colore**: `FIXED_RANGES` nello script (vedi §2).
- **Rampe colore**: `RAMPS` nello script (e la copia `YLORRD` in `MapViewer.tsx`
  per gli edifici, da tenere allineata).
- **Etichette IT**: `IT_LABELS` nello script (vedi §1).
- **Descrizioni "per cittadini"** mostrate in legenda: `ENV_DESC` in
  `web/components/Map/MapViewer.tsx`.

---

## 5. Rigenerare e verificare

```bash
python scripts/build_envimet_overlays.py
```

Lo script stampa una riga per overlay (`[ok] key: ...`). Controlla:
- nuovi PNG in `web/public/data/processed/envimet/`;
- la voce in `overlays.json` (range, `heights`, legenda);
- in dev (`cd web && npm run dev`) che il layer compaia nel menu e lo slider
  funzioni.

---

## 6. Sostituire la simulazione (altro giorno) o aggiungere UTCI/PET

### Altro giorno / altro orario
Sostituisci i `.tif` in `web/public/data/Envimet_data/` con quelli della nuova
simulazione (stessa griglia 253×273) e aggiorna la data in `main()`:

```python
meta = {
    "source": "ENVI-met PILOT-01-TALEA 2024-07-27 11:00 (z_band=%d)" % Z_BAND,
    ...
}
```

La legenda del viewer legge la data **da qui** (`meta.source`) e la formatta da
sola (`formatEnvDate` in `MapViewer.tsx`): aggiornando questa stringa si aggiorna
la legenda. Se la griglia cambia (dimensioni/rotazione), va rifatto anche il file
di georeferenziazione `04_Velocita_Vento.tif`.

### Aggiungere UTCI / PET (comfort termico "feels-like")
Sarebbe il dato ideale per il messaggio comfort (numeri più "umani" della MRT, con
soglie ufficiali di stress da caldo), **ma non è nell'export attuale**: va generato
con il modulo **BIO-met** di ENVI-met (richiesta lato Leonardo). Una volta ottenuto
il `.tif`, si aggiunge come variabile **curata** (§2) e, volendo, si fa colorare
gli edifici con esso al posto della MRT in `MapViewer.tsx` (funzione
`pedestrianMrt` / `mrt_col`).
