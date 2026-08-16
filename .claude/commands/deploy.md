---
description: Build di produzione, rebuild di docs/ e commit+push su main
---

Pubblica il sito su GitHub Pages seguendo ESATTAMENTE questa sequenza.
Se un passo fallisce, fermati e riporta l'errore: non proseguire.

1. **Gate di qualità** — in `web/`: `npx tsc --noEmit` e `npm run lint`.
   Errori = stop.
2. **Build** — in `web/`: build di produzione con
   `NEXT_PUBLIC_BASE_PATH=/UrbanScope3D npm run build` (output in `web/out/`).
   In PowerShell: `$env:NEXT_PUBLIC_BASE_PATH='/UrbanScope3D'; npm run build`.
3. **Rebuild docs/** — `robocopy web\out docs /MIR` dalla root del repo
   (robocopy esce con codice 1-7 in caso di successo: non trattarlo come
   errore). Poi assicurati che `docs/.nojekyll` esista (ricrealo vuoto se
   /MIR l'ha tolto): senza, Pages scarta `_next/`.
4. **Verifica dati** — controlla con `git status` che sotto
   `docs/data/Envimet_data/` ci siano ancora solo i tif whitelistati in
   `.gitignore` (i 12 `shipped: true` del registry) e che `docs/data/` non
   sia esplosa di file nuovi non voluti.
5. **Commit unico** — app + `docs/` nello stesso commit (regola del
   CLAUDE.md), messaggio in italiano che descrive la modifica + "rebuild
   Pages". Poi push su `main`.
6. **Riepilogo** — ricorda che il sito aggiornato sarà su
   https://dclfbk.github.io/UrbanScope3D/ (Pages impiega qualche minuto).

Argomento opzionale ($ARGUMENTS): se fornito, usalo come descrizione della
modifica nel messaggio di commit.
