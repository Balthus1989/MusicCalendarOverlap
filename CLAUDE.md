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
- Il motore conflitti (`src/lib/server/conflicts/`) è codice puro senza
  I/O, sempre coperto da test unitari.
- Le migrazioni Drizzle sono versionate: mai modificare una migrazione
  già committata.
- Prefisso `PUBLIC_` in SvelteKit = esposto al browser. Mai usarlo per
  chiavi server.
