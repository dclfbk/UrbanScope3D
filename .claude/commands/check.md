---
description: Typecheck (tsc --noEmit) + eslint in web/, report sintetico
---

Esegui il gate di qualità del progetto, in `web/`:

1. `npx tsc --noEmit` (non esiste script npm dedicato)
2. `npm run lint`

Puoi lanciarli in parallelo. Alla fine riporta un riepilogo sintetico:
"tutto pulito" oppure l'elenco degli errori raggruppati per file, con
riferimenti `file:riga` cliccabili. Non correggere nulla senza che te lo
chieda: questo comando è solo diagnosi.
