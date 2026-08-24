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
npm run db:generate # genera migrazione da schema.ts
npm run db:migrate # applica (usa DIRECT_DATABASE_URL, porta 5432)

## Vincoli non negoziabili

- Il browser non parla mai direttamente con Supabase per i dati di
  dominio. Solo l'auth passa dal client.
- Nessun handler restituisce una riga `events` grezza: tutto passa da
  `serializeEvent()`. Vedi la matrice di visibilità in ARCHITECTURE.md §5.
- Lo stesso vale per i conflitti: mai una riga `conflicts` grezza, perché
  `details` contiene quali band erano annunciate su ciascun lato. Si passa
  da `serializeConflict()` / `redigiConflitto()`. Vedi ADR-0024.
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
  già committata.
- Prefisso `PUBLIC_` in SvelteKit = esposto al browser. Mai usarlo per
  chiavi server.
