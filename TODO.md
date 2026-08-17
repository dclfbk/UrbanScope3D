# TODO — lista dalla call col professore (28 luglio 2026)

Recuperata dalla sessione del 28/07; stato aggiornato al 17/08/2026.

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
- [x] Grafica a destra che si sovrappone — sistemata il 17/08/2026: slider quota spostato a sinistra della colonna pannelli, InfoPanel sotto la bussola (top-24), InfoPanel/legenda si spartiscono l'altezza (65vh/35vh), toggle "Quartieri" staccato dalla search bar (il calc ignorava bottone basemap+gap)
- [x] Spacing della UI — passata del 17/08/2026 (vedi sopra + meteo che si apre sopra i controlli, help mode che ri-misura i riquadri quando i pannelli cambiano)
- [x] Togliere rumore acustico — 17/08/2026: rimossi sia l'hiss all'hover del layer rumore (suonava fuori da ogni toggle) sia l'intero paesaggio sonoro col suo bottone; `lib/soundscape.ts` resta nel repo come materiale di tesi
- [x] Cambiare frase iniziale sotto "Explore" — ora "Il microclima urbano di Bologna in 3D"; landing riportata alla palette Talea + toggle lingua
- [x] (extra 17/08) Lingua persistente e condivisa tra le pagine (localStorage, `lib/i18n.ts`): la scelta manuale sopravvive a reload/navigazioni
- [x] (extra 17/08) Colore "temperatura edifici": range sui percentili 5-95 delle MRT pedonali degli edifici (prima min/max dell'intero cubo → tutto piatto), legenda coerente e testo corretto (è la MRT a 1,5 m, NON sale lungo l'edificio; i ~70-80 °C al sole di luglio sono valori MRT normali, non un bug)
- [x] (extra 17/08) Il punto cliccato resta ancorato al terreno (prima saliva col foglio microclima quando muovevi lo slider quota)
- [x] (extra 17/08) Lint a zero: 12 errori + 7 warning ESLint sistemati

## Tesi
- [ ] Guardare qualche paper sull'environment visualization
- [ ] Fare abstract e indice tesi, metterli in un file e condividerlo
