# Calendario Eventi Condiviso

Calendario condiviso per organizzatori di concerti, con rilevamento automatico
delle sovrapposizioni tra date.

- Architettura completa: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Decisioni e vincoli: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stato

| Fase                    | Stato                            |
| ----------------------- | -------------------------------- |
| 0 — Fondazioni          | codice completo, manca il deploy |
| 1 — Anagrafiche         | da iniziare                      |
| 2 — Eventi e calendario | da iniziare                      |
| 3 — Motore conflitti    | da iniziare                      |
| 4 — Interoperabilità    | da iniziare                      |
| 5 — Import assistito    | da iniziare                      |
| 6 — Rifinitura          | da iniziare                      |

La Fase 0 è completa sul codice. Restano i passi che richiedono account e
credenziali: creazione del progetto Supabase, applicazione delle migrazioni e
primo deploy su Cloudflare. Vedi [Setup](#setup).

## Setup

Serve Node 24.

```bash
npm install
```

### 1. Progetto Supabase

Crea un progetto su [supabase.com](https://supabase.com) **in region EU
(Frankfurt)** — l'hosting europeo è parte della posizione GDPR (ADR-0002).

Dal pannello del progetto, in _Project Settings → API_ e _→ Database_, raccogli:

- URL del progetto e chiave `anon`
- chiave `service_role`
- stringa di connessione del **pooler** (porta 6543, transaction mode)
- stringa di connessione **diretta** (porta 5432)

Poi:

```bash
cp .env.example .env
```

e valorizza `.env`. Alla `DATABASE_URL` del pooler va aggiunto `?prepare=false`
se non è già presente nella query string.

> Il prefisso `PUBLIC_` in SvelteKit significa **esposto al browser**. Non
> usarlo mai per una chiave server.

### 2. Migrazioni

```bash
npm run db:migrate
```

Le migrazioni usano `DIRECT_DATABASE_URL` (porta 5432), mai il pooler, e girano
da locale o da CI — mai a runtime.

### 3. Auth

Nel pannello Supabase, sezione _Authentication_:

- **URL Configuration → Redirect URLs**: aggiungi
  `http://localhost:5173/auth/callback` e
  `https://<dominio-di-produzione>/auth/callback`. Senza questo il magic link
  non torna all'applicazione.
- **Providers → Email**: lascia attivo il magic link; disattiva la password.

La registrazione è **solo su invito** (ADR-0004): il form di login usa
`shouldCreateUser: false`, quindi un indirizzo sconosciuto non crea un account.
Per il primo accesso crea l'utente a mano da _Authentication → Users → Add
user_, poi segna il profilo come platform admin:

```sql
update profiles set is_platform_admin = true where email = 'tua@email';
```

### 4. Dev server

```bash
npm run dev
```

## Comandi

| Comando               | Cosa fa                                         |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | dev server                                      |
| `npm run check`       | svelte-check + typecheck                        |
| `npm run lint`        | prettier --check + eslint                       |
| `npm run format`      | prettier --write                                |
| `npm test`            | vitest (unit)                                   |
| `npm run db:generate` | genera migrazione da `schema.ts`                |
| `npm run db:migrate`  | applica (usa `DIRECT_DATABASE_URL`, porta 5432) |
| `npm run db:studio`   | drizzle studio                                  |
| `npm run build`       | build di produzione (adapter-cloudflare)        |

## Deploy

Cloudflare Workers, tramite `adapter-cloudflare`. La configurazione del Worker è
in `wrangler.jsonc`.

Le variabili d'ambiente **non** stanno in `wrangler.jsonc`: sono secret del
Worker.

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CRON_SECRET
```

Le `PUBLIC_*` possono stare tra le variabili in chiaro del Worker (sono già
esposte al browser per definizione).

```bash
npm run build
npx wrangler deploy
```

Via di fuga documentata: se emergono limiti di CPU per richiesta su Cloudflare,
si passa ad `adapter-vercel` senza toccare il codice applicativo
(ARCHITECTURE.md §3).

## Runbook

### Backup

`.github/workflows/backup.yml` esegue un `pg_dump` settimanale cifrato con GPG.
Non è opzionale: il free tier di Supabase non garantisce backup utilizzabili
(ADR-0002). Richiede i secret di repository `DIRECT_DATABASE_URL` e
`BACKUP_PASSPHRASE`.

Per ripristinare:

```bash
gpg --decrypt backup-AAAA-MM-GG.dump.gpg > backup.dump
pg_restore --no-owner --no-privileges -d "$DIRECT_DATABASE_URL" backup.dump
```

Verifica il ripristino su un database di scarto almeno una volta: un backup mai
ripristinato non è un backup.

### Migrazioni

Le migrazioni sono versionate. **Mai modificare una migrazione già committata**:
se serve un cambiamento, se ne genera una nuova.

Dopo ogni `npm run db:generate`, controlla il file prodotto prima di committarlo.
Drizzle può riemettere un `CREATE TABLE "auth"."users"` non condizionato, perché
`profiles.id` ha una foreign key verso lo schema `auth` gestito da Supabase: va
reso idempotente come in `0000_fase0_profiles.sql` (ADR-0015).

### Endpoint cron

Gli endpoint sotto `/api/cron/` richiedono l'header `x-cron-secret` uguale al
secret `CRON_SECRET`. Senza header valido rispondono `403`, sempre.

## Convenzioni di codice

- Il browser non parla mai direttamente con Supabase per i dati di dominio: solo
  l'auth passa dal client (ADR-0003).
- Nessun handler restituisce una riga `events` grezza: tutto passa da
  `serializeEvent()` (ADR-0005).
- Il motore conflitti in `src/lib/server/conflicts/` è codice puro senza I/O,
  sempre coperto da test unitari.
- Le rotte autenticate stanno dentro `src/routes/(app)/`: la guardia in
  `hooks.server.ts` protegge il gruppo, non una lista di path.
- La configurazione SvelteKit sta in `vite.config.ts`, non in un
  `svelte.config.js`: è la convenzione dello scaffolding corrente. Alcuni
  strumenti di terze parti cercano ancora `svelte.config.js` — se serve, si
  aggiunge un file minimale senza spostare la configurazione.
