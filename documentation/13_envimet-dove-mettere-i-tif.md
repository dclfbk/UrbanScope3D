# ENVI-met — dove mettere i file `.tif` (guida rapida)

Guida pratica e veloce per **aggiungere un dato ENVI-met** e farlo comparire nel
viewer. Per i dettagli completi vedi
[`12_envimet-aggiungere-dati.md`](./12_envimet-aggiungere-dati.md) e la tabella
delle variabili in [`11_envimet-data-reference.md`](./11_envimet-data-reference.md).

> ⚠️ I `.tif` grezzi **non** vengono caricati su Git (cartella in `.gitignore`,
> ~380 MB). Nel sito finiscono solo i **PNG leggeri** generati dallo script.

---

## 1. Dove e come mettere il file

Copia il GeoTIFF nella cartella:

```
web/public/data/Envimet_data/
```

con un nome nel formato:

```
NN_nome_variabile_all_z.tif
```

- `NN` = numero a due cifre (es. `38`) — serve solo per l'ordine.
- `nome_variabile` = nome interno (es. `pet`, `utci`) — diventa la "chiave".
- deve finire con **`_all_z.tif`** (è così che lo script lo riconosce).

**Requisiti del file** (altrimenti viene saltato):
- stessa griglia del dominio: **253 × 273 celle**;
- bande = livelli di quota z (di norma 54).

La georeferenziazione è automatica (presa da `04_Velocita_Vento.tif`, già presente):
i tif ENVI-met non hanno CRS, ci pensa lo script.

---

## 2. Far comparire il dato

Dalla cartella principale del progetto:

```bash
python scripts/build_envimet_overlays.py
```

Genera i PNG + aggiorna `web/public/data/processed/envimet/overlays.json`. Riavvia il
viewer (`cd web && npm run dev`): il nuovo dato compare nel pannello **Microclima**.

- Di default un dato nuovo finisce tra i **"Dati tecnici"** (overlay a terra,
  selezionabile, senza slider/valori al click).
- Per **promuoverlo** a dato "curato" (nome semplice, slider quote, valore al click,
  scala colore fissa) aggiungi una riga in `CURATED` dentro
  `scripts/build_envimet_overlays.py` — vedi la guida #12, §2.

---

## 3. Pubblicarlo online

Dopo aver rigenerato (passo 2):

```bash
cd web
NEXT_PUBLIC_BASE_PATH=/UrbanScope3D npm run build   # genera web/out
# copia il contenuto di web/out in ../docs (incluso .nojekyll)
```

poi `git add -A && git commit && git push`. Il sito (GitHub Pages, servito da `docs/`)
si aggiorna. URL: https://dclfbk.github.io/UrbanScope3D/

> Si committano solo i PNG/JSON in `processed/`, **non** i `.tif` grezzi.

---

## Riassunto

| Passo | Azione |
|---|---|
| 1 | Trascina `NN_nome_all_z.tif` in `web/public/data/Envimet_data/` |
| 2 | `python scripts/build_envimet_overlays.py` |
| 3 | build + copia in `docs/` + `git push` |
