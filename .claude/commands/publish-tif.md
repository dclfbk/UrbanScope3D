---
description: Pubblica online un GeoTIFF ENVI-met (flag shipped + whitelist + rebuild)
---

Pubblica su GitHub Pages la variabile ENVI-met indicata in $ARGUMENTS
(nome o id della variabile nel registry). Procedura di riferimento:
`documentation/12_envimet-aggiungere-dati.md` — leggila prima se qualcosa
non torna.

1. **Trova la variabile** in `web/lib/envimetRegistry.ts`. Se $ARGUMENTS è
   vuoto o ambiguo, elenca le variabili con `shipped: false` e chiedi quale
   pubblicare.
2. **Verifica il file** — il tif deve esistere in
   `web/public/data/Envimet_data/`; controllane il peso e dillo all'utente
   (il budget whitelistato attuale è ~119 MB: segnala se il nuovo file lo
   fa crescere molto).
3. **Flag** — imposta `shipped: true` per quella variabile nel registry.
4. **Whitelist** — aggiungi la riga di eccezione in `.gitignore` sotto la
   sezione `docs/data/Envimet_data/`, imitando le righe esistenti.
5. **Rebuild e pubblicazione** — esegui il flusso del comando `/deploy`
   (gate, build, robocopy in `docs/`, verifica, commit unico, push).
6. **Verifica finale** — conferma con `git status`/`git show --stat` che il
   nuovo tif sia entrato in `docs/data/Envimet_data/` e ricorda l'URL
   pubblico per il test del toggle online.
