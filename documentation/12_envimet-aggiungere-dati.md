# ENVI-met — aggiungere o modificare i dati (file `.tif`)

Guida pratica per **aggiungere un dato ENVI-met** (file `.tif`) al viewer, per
renderlo "curato" (slider + click), cambiarne colori/etichette, pubblicarlo
online, oppure sostituire la simulazione con un'altra (altro giorno, o UTCI/PET).

> Per **capire cosa contengono** i dati vedi
> [`11_envimet-data-reference.md`](./11_envimet-data-reference.md).

> **Aggiornato (agosto 2026): non c'è più nessuna pipeline da rigenerare.**
> I GeoTIFF vengono scaricati e decodificati direttamente **nel browser**
> (`web/lib/envimetTif.ts` + Web Worker con geotiff.js). Il "catalogo" delle
> variabili è un file TypeScript committato: **`web/lib/envimetRegistry.ts`**
> (l'ex `overlays.json`). Tutto quello che prima si faceva rilanciando
> `scripts/build_envimet_overlays.py` ora si fa modificando quel file.
> Lo script Python e i suoi output PNG/JSON restano nel repo come materiale
> storico/di tesi, ma il sito non li legge più.

---

## Avvio rapido (3 passi)

1. **Copia il GeoTIFF** in `web/public/data/Envimet_data/` con nome
   `NN_nome_variabile_all_z.tif`. Requisiti: stessa griglia del dominio
   **253 × 273 celle**, bande = livelli di quota z (di norma 54, con tag GDAL
   `z_m` per banda), nodata −9999, export south-up (come tutti gli altri: il
   worker fa il flip). Il CRS **non serve**: la georeferenziazione del dominio
   è costante in `web/lib/envimetGeo.ts`.
2. **Aggiungi la voce** in `ENV_VARS` dentro `web/lib/envimetRegistry.ts`
   (vedi §1). Riavvia il dev server: il dato compare nel pannello Microclima
   (tra i "Dati tecnici" se `curated: false`).
3. **Pubblica online** (se serve): `shipped: true` nel registry + whitelist in
   `.gitignore` + rebuild di `docs/` (vedi §5).

---

## 1. Aggiungere una variabile al registry

Ogni variabile è una voce di `ENV_VARS` (`web/lib/envimetRegistry.ts`),
tipo `EnvimetVarDef`:

```ts
{
  key: 'pet',                                  // nome interno univoco
  file: '38_pet_all_z.tif',                    // in web/public/data/Envimet_data/
  label: { it: 'Comfort termico (PET)', en: 'Thermal comfort (PET)' },
  desc: { it: '…', en: '…' },                  // divulgativa, solo curati
  unit: '°C',
  ramp: 'ylorrd',        // ylorrd | blues | greens | magma | viridis | rdbu
  range: [18, 41],       // FISSO [vmin, vmax]; null = percentili 2-98 sul cubo
  agg: 'band',           // 'band' = quota per quota (slider); 'maxz' = max colonna
  curated: true,         // true = dato "per cittadini"; false = tecnico
  shipped: false,        // true = tif pubblicato online (vedi §5)
}
```

Note:
- **`range` fisso** = "stesso colore = stesso valore" fra quote e simulazioni:
  consigliato per i curati. Con `null` la scala si adatta al cubo.
- **`agg: 'maxz'`** serve ai dati concentrati in alto (vegetazione LAD: a
  1.5 m sarebbe ~0), mostra il massimo lungo la colonna, senza slider.
- Le **rampe colore** sono in `ENV_RAMPS` nello stesso file (identiche alla
  vecchia pipeline Python, così i colori restano quelli dei PNG storici).

Con la voce nel registry il resto è automatico: toggle, legenda, foglio 3D,
valore al click, profilo verticale. Nessun passo di build dei dati.

## 2. Variabili tecniche nel viewer

Il pannello mostra di default solo i dati **curati**. Le variabili con
`curated: false` compaiono solo con `SHOW_TECHNICAL_ENVIMET = true` in
`web/components/Map/MapViewer.tsx` (menu a scomparsa "Dati tecnici").

## 3. Quote / slider

Non c'è più nulla da configurare: lo slider copre **tutte le 54 quote** del
cubo (0.3 → 148.5 m, snap alla banda reale più vicina, lette dai tag `z_m`;
fallback `ENV_Z_LEVELS` in `envimetGeo.ts`).

## 4. Verificare in locale

```bash
cd web && npm run dev     # aprire http://localhost:3000 (o http://127.0.0.1:3000)
```

Attiva il layer nel pannello Microclima: parte il download del tif (barra di
avanzamento sulla voce), poi foglio + click + profilo. Errore sul toggle =
file mancante o griglia sbagliata (guarda la console).

## 5. Pubblicare online

I `.tif` sorgente sono **gitignorati** (`/web/public/data/Envimet_data/`,
~372 MB). Online (GitHub Pages, servito da `docs/`) vanno **solo i tif
`shipped: true`** (~119 MB per i 12 attuali). Per pubblicarne uno nuovo:

1. `shipped: true` nella voce del registry;
2. aggiungi la riga di **whitelist** in `.gitignore` (root):
   `!/docs/data/Envimet_data/NN_nome_all_z.tif`;
3. rebuild + deploy:

```bash
cd web
NEXT_PUBLIC_BASE_PATH=/UrbanScope3D npm run build   # genera web/out (copia TUTTO public/, tif inclusi)
# copia il contenuto di web/out in ../docs (robocopy /MIR) e ripristina docs/.nojekyll
```

poi dalla cartella principale `git add -A && git commit && git push`.
Il sito si aggiorna su https://dclfbk.github.io/UrbanScope3D/

> Una variabile `shipped: false` resta usabile in locale (se il file c'è);
> online il suo toggle mostra un errore ma non rompe nulla.

## 6. Sostituire la simulazione (altro giorno) o aggiungere UTCI/PET

### Altro giorno / altro orario
Sostituisci i `.tif` in `web/public/data/Envimet_data/` con quelli della nuova
simulazione (stessa griglia 253×273) e aggiorna la costante **`ENV_SOURCE`** in
`web/lib/envimetGeo.ts` (la legenda formatta la data da lì, `formatEnvDate` in
`MapViewer.tsx`). Se cambia la griglia (dimensioni/rotazione) vanno rigenerati
anche `ENV_CORNERS`/`ENV_GROUND_PLANE` in `envimetGeo.ts` — la ricetta è nel
commento in cima a quel file.

### Aggiungere UTCI / PET (comfort termico "feels-like")
Sarebbe il dato ideale per il messaggio comfort (numeri più "umani" della MRT,
con soglie ufficiali di stress da caldo), **ma non è nell'export attuale**: va
generato con il modulo **BIO-met** di ENVI-met (richiesta lato Leonardo). Una
volta ottenuto il `.tif`, si aggiunge come variabile **curata** (§1) e,
volendo, si fa colorare gli edifici con esso al posto della MRT in
`MapViewer.tsx`.
