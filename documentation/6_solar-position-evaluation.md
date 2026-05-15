# Solar position evaluation

## Scope

Lib JS per calcolare azimuth + altitudine del sole dato lat/lon/timestamp.
Output usato per:

- direzione luce nel viewer,
- ombre cast (Issue 7),
- time slider che scorre un giorno o un anno.

Vincoli: client-side, bundle piccolo, no server. Gira insieme a MapLibre
([Issue 5](./5_framework-evaluation.md)).

## Candidati

### SunCalc

- lib mini, sun + moon. ~10 KB minified, no deps.
- accuratezza: < ~1° su sun position. Per uno shadow viewer di citta' va bene.
- repo originale fermo da anni, fork attivi (`suncalc3`).

### suncalc3

- fork attivo di SunCalc, types TS, fix minori. Stesso API/accuratezza/peso.
- drop-in se scegli SunCalc oggi.

### astronomy-engine

- ephemerids ad alta accuratezza (Don Cross). < 1 arcomin sul sole, validato
  contro JPL.
- bundle ~80-120 KB, API ampia.
- overkill per uno shadow viewer. Giusto se poi servono studi solari di
  irraggiamento.

### NREL SPA

- algoritmo NREL di riferimento, accuratezza ~0.0003°.
- vari port JS (`spa.js`, npm `solar-position-algorithm`).
- pensato per ingegneria solare (PV), peso simile ad astronomy-engine.

### solar-calculator (d3)

- mini, focalizzato su sunrise / sunset. Scomodo per un `(az, alt)` in render
  loop.

### Native dei framework

- MapLibre: nessun sole nativo. La luce si setta via `light` style, l'app
  calcola.
- Cesium: ha `Cesium.Simon1994PlanetaryPositions` + ombre integrate. Non
  rilevante per l'MVP MapLibre.
- Three.js / deck.gl: nessun sole nativo, si aspetta una direzione precomputata.

## Confronto

| Lib | Accuratezza | Bundle (min) | Manutenzione | TS types | API per noi |
|---|---|---:|---|---|---|
| **SunCalc** | < ~1° | ~10 KB | bassa | community | semplice, una call |
| **suncalc3** | < ~1° | ~12 KB | attiva | si | come SunCalc |
| **astronomy-engine** | < 1' | ~80-120 KB | attiva | si | ampia |
| NREL SPA (port) | ~0.0003° | ~50-80 KB | varia | varia | densa |
| solar-calculator (d3) | ~0.5-1° | ~5 KB | bassa | no | sunrise/sunset focalizzata |
| Cesium nativo | molto alta | n/a (engine) | engine-tied | si | solo dentro Cesium |

Compatibilita' browser: tutte pure ES, no DOM dep.

## Scelta

**suncalc** per l'MVP (gia' installato come `suncalc` + `@types/suncalc` nel
`package.json`, non serve switchare a `suncalc3`).

Perche':

- accuratezza < ~1° basta: a scala citta' l'errore di direzione ombra non si vede.
- bundle minimo, zero impatto cold start.
- API: una call `getPosition(date, lat, lon) -> {azimuth, altitude}`.
- TS types ok via `@types/suncalc`.

**Upgrade path**: passare a `astronomy-engine` o port SPA solo se il prototipo
vuole vantarsi di accuratezza fisica (mappe di irraggiamento, stima resa PV).
L'integration point e' una sola funzione, swap meccanico.

## Integrazione

Modulo singolo, time-source unico, usato da luce e ombre.

```text
web/lib/sun.ts
  getSunPosition(date, lat, lon) -> {azimuthDeg, altitudeDeg, isDay}
  toMapLibreLight(sun)            -> {anchor, position, color, intensity}

web/components/Map/MapViewer.tsx
  - state: currentTime
  - getSunPosition(currentTime, AOI lat, AOI lon)
  - map.setLight(toMapLibreLight(sun))   // facce delle estrusioni MapLibre
  - SunLight({timestamp: currentTime.getTime(), _shadow: true})
    nel deck.gl overlay (Issue 7)

web/components/UI/TimeSlider.tsx
  - range 0-1439 min, step 15
  - preset: solstizi / equinozi / "adesso"
```

Step:

1. installare `suncalc` + `@types/suncalc` (gia' fatto).
2. scrivere `web/lib/sun.ts`.
3. esporre `currentTime` nello state del viewer.
4. agganciare `setLight` ad ogni cambio di `currentTime`.
5. aggiungere il `TimeSlider`.

## Validazione

Sanity check su Bologna (44.494, 11.343):

| Data / ora (Europe/Rome) | Atteso (rough) | Sorgente |
|---|---|---|
| 21 giugno 13:00 (solstizio est.) | sole alto ~69°, azimuth ~sud | NOAA solar calculator |
| 21 dicembre 12:00 (solstizio inv.) | basso ~22°, azimuth ~sud | NOAA solar calculator |
| 21 marzo 18:30 (equinozio tramonto) | alt ~0°, azimuth ~ovest (270°) | NOAA solar calculator |

Accept: suncalc entro 1° del riferimento per ogni riga, tutto l'anno.

## Note

- timezone: lo slider mostra Europe/Rome ma alla lib passiamo UTC. Verificare DST.
- dove sta `currentTime`? URL hash per i link condivisibili oppure zustand. Per
  ora `useState` locale nel viewer.
- punto di riferimento: centro AOI o per-feature lat/lon? A scala citta' la
  differenza e' < 0.01°, AOI center basta.
- cache della posizione sole per minuto, non ricalcolare a ogni frame.
