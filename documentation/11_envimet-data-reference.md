# Dati ENVI-met — riferimento completo

Questo file spiega **cosa contengono** i dati della simulazione microclimatica
ENVI-met usati dal viewer: quante variabili ci sono, cosa misurano, in che unità,
come sono fatte le **quote (altezze z)** e quali di esse mostriamo nella mappa.

> Per **aggiungere** nuovi dati o cambiare le quote vedi
> [`12_envimet-aggiungere-dati.md`](./12_envimet-aggiungere-dati.md).

---

## 1. La simulazione

- **Fonte:** `ENVI-met PILOT-01-TALEA` — Bologna, zona Talea.
- **Istante simulato:** **27 luglio 2024, ore 11:00** (giornata estiva di caldo).
- ⚠️ **È una fotografia di quell'istante.** I valori NON cambiano col giorno/ora
  reali in cui guardi la mappa. Lo slider "altezza" cambia la **quota**, non l'ora.
- **Griglia orizzontale:** 253 × 273 celle, **3 × 3 m** ciascuna (~760 × 820 m).
- **Quote verticali (z):** **54 livelli** (vedi §3).

I file originali stanno in `web/public/data/Envimet_data/` (un GeoTIFF multibanda
per variabile, `NN_nome_all_z.tif`, 54 bande = 54 quote). Lo script
`scripts/build_envimet_overlays.py` li trasforma in PNG + `overlays.json` per il
viewer.

---

## 2. Le 38 variabili

Tutte le variabili hanno **54 quote** (sono dati 3D). La colonna **"Nel viewer"**
dice come le mostriamo:

- **Curato + slider** = uno dei 7 dati "per cittadini": PNG a più quote (slider
  altezza) + valore al click sulla mappa.
- **Curato (max-z)** = curato ma mostrato come massimo lungo la colonna (vedi nota
  vegetazione), senza slider.
- **Extra (a terra)** = selezionabile e colorato, ma un solo livello (pedonale) e
  niente valore al click.

| # | Variabile (file) | Unità | Nel viewer | Cosa misura (in parole semplici) |
|---|---|---|---|---|
| 00 | objects | — | Extra (maschera) | Maschera di edifici/oggetti solidi del modello. |
| 01 | flow_u | m/s | Extra | Componente E–O del vento. |
| 02 | flow_v | m/s | Extra | Componente N–S del vento. |
| 03 | flow_w | m/s | Extra | Componente verticale del vento (su/giù). |
| 04 | wind_speed | m/s | Extra | Velocità del vento. |
| 05 | wind_speed_change | % | Extra | Quanto il vento è rallentato/accelerato dagli edifici. |
| 06 | wind_direction | ° | Extra | Direzione di provenienza del vento. |
| 07 | pressure_perturbation | dPa | Extra | Perturbazione di pressione (effetto edifici sul flusso). |
| 08 | **potential_air_temperature** | °C | **Curato + slider** (`temperature`) | **Temperatura dell'aria.** Varia poco nello spazio (~6 °C). |
| 09 | air_temperature_delta | K | Extra | Differenza di temperatura aria rispetto al riferimento. |
| 10 | air_temperature_change | K/h | Extra | Velocità di riscaldamento/raffreddamento dell'aria. |
| 11 | specific_humidity | g/kg | Extra | Umidità specifica (grammi d'acqua per kg d'aria). |
| 12 | **relative_humidity** | % | **Curato + slider** (`humidity`) | **Umidità relativa.** |
| 13 | tke | m²/m³ | Extra | Turbolenza (energia cinetica turbolenta). |
| 14 | tke_dissipation | m³/m³ | Extra | Dissipazione della turbolenza. |
| 15 | vertical_exchange_coef_impuls | m²/s | Extra | Scambio turbolento verticale. |
| 16 | horizontal_exchange_coef_impuls | m²/s | Extra | Scambio turbolento orizzontale. |
| 17 | **vegetation_lad** | m²/m³ | **Curato (max-z)** (`vegetation_lad`) | **Densità del fogliame (LAD).** Mostrato come max lungo la colonna (la chioma è in alto, a 1.5 m sarebbe ~0). |
| 18 | **direct_sw_radiation** | W/m² | **Curato + slider** (`direct_sw`) | **Radiazione solare diretta** (sole pieno). |
| 19 | **diffuse_sw_radiation** | W/m² | **Curato + slider** (`diffuse_sw`) | **Radiazione solare diffusa** (cielo). |
| 20 | **reflected_sw_radiation** | W/m² | **Curato + slider** (`reflected_sw`) | **Radiazione solare riflessa** dalle superfici. |
| 21 | temperature_flux | K·m/s | Extra | Flusso di calore sensibile. |
| 22 | vapour_flux | g/kg·m/s | Extra | Flusso di vapore acqueo. |
| 23 | water_on_leafes | g/m² | Extra | Acqua sulle foglie. |
| 24 | leaf_temperature | °C | Extra | Temperatura delle foglie. |
| 25 | local_mixing_length | m | Extra | Lunghezza di mescolamento turbolento. |
| 26 | **mean_radiant_temp** | °C | **Curato + slider** (`mean_radiant_temp`) | **Temperatura media radiante (MRT) = "quanto scotta"** (sole + calore delle superfici). **È il dato con cui coloriamo gli edifici.** Forte contrasto sole/ombra (può andare da ~30 a ~80 °C). |
| 27 | tke_normalised_1d | — | Extra | TKE normalizzata (tecnico). |
| 28 | dissipation_normalised_1d | — | Extra | Dissipazione normalizzata (tecnico). |
| 29 | km_normalised_1d | — | Extra | Km normalizzato (tecnico). |
| 30 | tke_mechanical_turbulence_prod | — | Extra | Produzione meccanica di turbolenza. |
| 31 | stomata_resistance | s/m | Extra | Resistenza stomatica delle piante. |
| 32 | co2 | mg/m³ | Extra | Concentrazione di CO₂. |
| 33 | co2_2 | ppm | Extra | Concentrazione di CO₂ (in ppm). |
| 34 | plant_co2_flux | mg/m²s | Extra | Flusso di CO₂ della vegetazione. |
| 35 | div_lw_radiation_temp_change | K/h | Extra | Variazione di T da radiazione infrarossa. |
| 36 | natural_convection_velocity | m/s | Extra | Velocità di convezione naturale. |
| 37 | building_number | — | Extra (maschera) | ID numerico di ogni edificio del modello. |

### "C'è l'altezza degli edifici?"

No — **queste variabili non contengono l'altezza degli edifici.** L'"altezza" qui
è la **quota atmosferica (z)** a cui è misurata la variabile. Le altezze degli
edifici 3D vengono da un file separato, `web/public/data/processed/buildings_heights.geojson`
(proprietà `height`). Nella stessa pipeline, in ogni edificio iniettiamo anche:

- `air_temp` — temperatura aria al livello pedonale (campionata da #08);
- `mrt_col` — colonna di MRT per quota (campionata da #26), da cui prendiamo la
  **MRT pedonale (~1.5 m)** che colora l'edificio in modalità "temperatura".

---

## 3. Le quote (altezze z) — e perché ne mostriamo solo alcune

### Come è fatta la griglia verticale

La griglia è **fitta vicino al suolo** e **regolare in alto**. Le 54 quote reali
(in metri) sono:

```
0.3, 0.9, 1.5, 2.1, 2.7,            ← primo cella di 3 m divisa in 5 sotto-livelli
4.5, 7.5, 10.5, 13.5, 16.5, 19.5,   ← da qui in su: un livello ogni 3 m
22.5, 25.5, 28.5, 31.5, 34.5, 37.5,
40.5, 43.5, ... 145.5, 148.5
```

Quindi **sopra i 4.5 m esistono solo quote a passo di 3 m** (4.5, 7.5, 10.5, …):
qualsiasi altezza "tonda" che scegli viene agganciata al livello reale più vicino.

### Perché non le usiamo tutte

Due motivi:

1. **Costo file.** Ogni combinazione **(variabile × quota)** diventa **un PNG
   separato** (più, per i curati, una griglia di valori per il click). Esporre
   tutte e 54 le quote per i curati significherebbe **centinaia di PNG**
   (≈ 6 variabili × 54 ≈ 320 file), con repo gonfio e caricamento più lento.
2. **I dati lassù sono uniformi.** La variazione spaziale interessante
   (sole/ombra, effetto di alberi ed edifici) è **concentrata vicino al suolo** e
   sparisce in alto. Misurando lo spread spaziale (p5–p95) della MRT per quota:

   | Quota | Spread MRT |
   |---|---|
   | 1.5 m | 36 °C |
   | 10.5 m | 33 °C |
   | 16.5 m | 28 °C |
   | **19.5 m** | **15 °C** ← crollo |
   | 25.5 m | 12 °C |
   | 40.5 m | 8 °C (≈ piatto) |

   Tutta "l'azione" è **da terra fino a ~16 m** (strada + facciate fino ai tetti).

### Quote esposte (scelta guidata dai dati)

`HEIGHT_BANDS = [2, 5, 6, 7, 8, 9, 12, 17, 23]` →
**1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 25.5, 40.5, 58.5 m**.

Cioè: **fitte ogni 3 m da 1.5 a 16.5 m** (dove il dato è ricco), poi **rade**
(25.5, 40.5) per mostrare che in alto è uniforme, e un'ultima a **58.5 m**
"sopra ogni edificio" (il più alto nel dominio è 50.1 m — vedi sotto).

> Edifici nel dominio ENVI-met (1090): mediana 13.4 m, 99° percentile 34.7 m,
> **massimo 50.1 m**; solo 3 superano i 40.5 m. Il piano a 52.5 m li copre tutti.

### Come viene disegnato l'overlay (foglio sollevato alla quota)

> **Aggiornato (fine giugno 2026).** Prima l'overlay era una sorgente immagine
> MapLibre **drappeggiata sul terreno**; si è scelto invece di farlo **salire**
> con la quota, su richiesta dell'utente.

L'overlay è un **`BitmapLayer` deck.gl** posato a `ENV_GROUND_ELEV (56.9 m, =
`ground_elev` in `overlays.json`) + quota della banda`: lo slider altezza lo
**solleva fisicamente** in 3D. L'esagerazione del terreno è 1, quindi i metri
deck combaciano col terreno.

Dentro il dominio il terreno varia **~26 m** (da ~41 a ~67 m s.l.m.): un foglio
piatto alla quota vera, alle bande basse (1,5 / 4,5 m), verrebbe "bucato" dal
terreno in salita. Per evitarlo il foglio è disegnato con `depthCompare:
'always'`: dove starebbe **sotto** il terreno viene comunque disegnato **sopra**.
Compromesso: da angolazione obliqua il foglio piatto può sovrascrivere
terreno/edifici che gli stanno davanti (effetto raggi-X); la resa "che segue le
colline" richiederebbe un mesh tassellato (lavoro futuro).

Il punto cliccato è un **disco piatto deck.gl** (`env-probe-dot`) posato sul
foglio alla sua quota; il marker DOM a terra è nascosto quando un foglio è
attivo. Selezionare un overlay (o "Edifici → temperatura") **inquadra il dominio
dall'alto** in automatico (`flyToEnvDomain`). (Codice: `env-bitmap` /
`env-probe-dot` nei layer deck di `MapViewer.tsx`.)

Le celle **senza dato (NoData)** non sono trasparenti ma riempite di un **verde
salvia tenue** (`colorize` in `build_envimet_overlays.py`), così il dominio non
lascia buchi sulla mappa.

### Slider proporzionale

Nel viewer lo slider altezza è **proporzionale ai metri reali**: la posizione del
cursore riflette l'altezza vera, quindi le quote fitte vicino al suolo restano
vicine fra loro e quelle alte distanti. Allo spostamento aggancia (snap) la quota
disponibile più vicina. (Codice: `MapViewer.tsx`, blocco "Slider ALTEZZA".)

### Come cambiare le quote

Modifica `HEIGHT_BANDS` con gli **indici di banda** (0-based) — non metri: la
griglia esiste solo a passo di 3 m sopra i 4.5 m, quindi ogni quota si aggancia
al livello reale più vicino. Mappatura indice→metri:

| Indice | 0 | 2 | 5 | 6 | 7 | 8 | 9 | 12 | 15 | 17 | 18 | 21 | 22 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Metri | 0.3 | 1.5 | 4.5 | 7.5 | 10.5 | 13.5 | 16.5 | 25.5 | 34.5 | 40.5 | 43.5 | 52.5 | 55.5 |

Dopo la modifica va **rigenerata** la pipeline — istruzioni in
[`12_envimet-aggiungere-dati.md`](./12_envimet-aggiungere-dati.md).
