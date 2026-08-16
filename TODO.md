# TODO — lista dalla call col professore (28 luglio 2026)

Recuperata dalla sessione del 28/07; stato aggiornato al 16/08/2026.

## Visualizzazione
- [ ] **Trovare modo per far vedere i dati in 3D dinamico** — in corso: "microclima vivo" (particelle) + motore GPU windgl; riferimenti in `materialePer3D/` (2 video + link L7). Se non si riesce: gif animata piccola usata come texture.
- [x] Punto che sale con griglia ENVI-met (il "foglio microclima" che sale di quota) — da confermare col prof
- [x] Colore tetti (tetti colorati per temperatura)

## Dati
- [x] Sistemare dati: mettere i **tif al posto delle png** — fatto il
  16/08/2026: i GeoTIFF si decodificano nel browser (`web/lib/envimetTif.ts`
  + worker), niente più PNG/overlays.json precotti (che restano nel repo come
  materiale di tesi). Online vanno i 12 tif `shipped` (~119 MB).
- [x] Sistemare documentazione se si usano i tif — note 11/12 aggiornate
- [x] (collegato) `flow_u/flow_v all_z.tif` — **recuperati il 16/08/2026** dal PC vecchio: tutti e 38 i GeoTIFF ENVI-met sono tornati in `web/public/data/Envimet_data/` e `wind_uv.values.json` (9 quote) è stato rigenerato. Il fallback direzione-da-PNG non serve più.

## UI / contenuti
- [ ] Intro per visualizzare la zona di interesse con video di UrbanScope3D e spiegazione dei dati mostrati
- [ ] Grafica a destra che si sovrappone — da verificare se ancora presente
- [ ] Spacing della UI — check generale
- [ ] Togliere rumore acustico
- [ ] Cambiare frase iniziale sotto "Explore"

## Tesi
- [ ] Guardare qualche paper sull'environment visualization
- [ ] Fare abstract e indice tesi, metterli in un file e condividerlo
