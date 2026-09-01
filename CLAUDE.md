# Calendario Eventi Condiviso

Calendario condiviso per organizzatori di concerti, con rilevamento
automatico delle sovrapposizioni tra date.

## Architettura

L'architettura completa è in `docs/ARCHITECTURE.md`. **Leggilo prima
di scrivere codice.** Contiene modello dati, matrice di visibilità,
motore di rilevamento conflitti e piano di implementazione a fasi.

Le decisioni prese e i loro vincoli sono in `docs/DECISIONS.md`.
Se durante il lavoro emerge una decisione architetturale nuova,
aggiungi una voce ADR prima di chiudere la sessione.

## Stack

SvelteKit 2 + TypeScript · Drizzle ORM · Supabase Postgres (EU)
Tailwind + shadcn-svelte · FullCalendar · deploy su Cloudflare Workers

## Comandi

npm run dev # dev server
npm run check # svelte-check + typecheck
npm run test # vitest
npm run test:e2e # smoke Playwright: database vero, si pulisce da solo
npm run db:generate # genera migrazione da schema.ts
npm run db:migrate # applica (usa DIRECT_DATABASE_URL, porta 5432)
npm run rilascia # rilascio completo: controlli, tag, deploy

## Vincoli non negoziabili

- Il browser non parla mai direttamente con Supabase per i dati di
  dominio. Solo l'auth passa dal client.
- Nessun handler restituisce una riga `events` grezza: tutto passa da
  `serializeEvent()`. Vedi la matrice di visibilità in ARCHITECTURE.md §5.
- Lo stesso vale per i conflitti: mai una riga `conflicts` grezza, perché
  `details` contiene quali band erano annunciate su ciascun lato. Si passa
  da `serializeConflict()` / `redigiConflitto()`. Vedi ADR-0024.
- E vale per la **scheda operativa della band** (Fase 7): mai una riga
  `artist_observations` grezza. Si passa da `serializeArtistCard()` /
  `redigiScheda()`. Il cachet si vede solo **a fasce**, solo **sopra
  soglia** (n≥2 osservazioni da ≥2 organizzazioni, 24 mesi) e **mai
  attribuito**; sulla scheda non esiste nessun campo di giudizio né
  nessuna nota di testo libero, e la lista artisti non si ordina né si
  filtra per prezzo. Non sono preferenze di prodotto: sono ciò che rende
  difendibile il trattamento. Vedi ADR-0048, 0049, 0050, 0051.
- Le **regole** del motore conflitti (`conflicts/engine.ts`, `rules.ts`,
  `genre-affinity.ts`, `geo.ts`) sono codice puro senza I/O, sempre coperto
  da test unitari. L'accesso al database sta accanto, in `reconcile.ts`,
  `queries.ts`, `actions.ts` e `preview.ts`, e non deve rientrare nelle
  regole: è ciò che le rende testabili caso per caso.
- L'import assistito **compila un form, non crea una data**. Il parser non
  decide lo stato, non marca nessuna band come annunciata e non collega
  nessuna riga di lineup all'anagrafica: `status` e `isAnnounced` non
  esistono proprio in `bersaglioParse`. Vedi ADR-0031.
- Le migrazioni Drizzle sono versionate: mai modificare una migrazione
  già committata. E ogni migrazione resta **compatibile con il rilascio
  precedente**: `wrangler rollback` riporta indietro il Worker in pochi
  secondi e non annulla niente sul database. Si aggiunge in un rilascio, si
  toglie in quello dopo. Vedi ADR-0046.
- Un **rilascio** passa da `npm run rilascia`, non da `npm run deploy` a mano:
  alza il numero prima della build — la versione è murata nell'artefatto e si
  legge dal piè di pagina o da `/api/version` — esegue gli smoke test e non fa
  il push. Le note di rilascio sono `git log` fra due tag: non esiste un
  `CHANGELOG.md` ed è deliberato. Vedi ADR-0046.
- Le **notifiche** nascono già redatte, per un destinatario solo: il testo
  si costruisce da un evento o da un conflitto **già serializzato**, e se il
  serializzatore restituisce `null` non nasce nessuna riga. Niente avviso
  senza nomi, niente avviso vuoto: proprio niente. Vedi ADR-0035.
- Il **canale** delle notifiche è Telegram, e niente nel layer lo nomina
  tranne `sinks/telegram.ts`: colonne, preferenze e servizio parlano di
  "consegna". L'email è stata rimossa in Fase 6 e il canale è già cambiato
  una volta — il prossimo deve costare un file. Vedi ADR-0039.
- Il **service worker** non mette in cache nessuna risposta che contenga
  dati di dominio. In cache va solo ciò che è uguale per tutti: build,
  asset statici, la pagina `/offline`. È l'unico posto dell'architettura
  dove una risposta sopravvivrebbe al contesto che l'ha prodotta.
- Il **registro delle modifiche** lo legge solo l'organizzazione
  proprietaria, platform admin compreso: conserva i valori precedenti dei
  campi, titolo incluso.
- Prefisso `PUBLIC_` in SvelteKit = esposto al browser. Mai usarlo per
  chiavi server.
