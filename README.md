# Calendario Eventi Condiviso

Calendario condiviso per organizzatori di concerti, con rilevamento automatico
delle sovrapposizioni tra date.

- Architettura completa: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Decisioni e vincoli: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stato

| Fase                    | Stato                            |
| ----------------------- | -------------------------------- |
| 0 — Fondazioni          | codice completo, manca il deploy |
| 1 — Anagrafiche         | codice completo, manca il deploy |
| 2 — Eventi e calendario | codice completo, manca il deploy |
| 3 — Motore conflitti    | da iniziare                      |
| 4 — Interoperabilità    | da iniziare                      |
| 5 — Import assistito    | da iniziare                      |
| 6 — Rifinitura          | da iniziare                      |

Fasi 0, 1 e 2 complete sul codice. Il progetto Supabase esiste, le migrazioni
fino a `0002_fase2_eventi` sono applicate e i generi sono seminati. Resta il
primo deploy su Cloudflare. Vedi [Setup](#setup).

I criteri di fine restano da verificare in esercizio, perché richiedono due
account veri: _login e logout in produzione_ (Fase 0), _due utenti in due
organizzazioni diverse con band e venue inseriti_ (Fase 1) e _una data in
`hold` di un'organizzazione che appare correttamente ridotta all'altra_
(Fase 2). Quest'ultimo è coperto dai test unitari di
`tests/unit/visibility.test.ts`, una asserzione per cella della matrice: ciò
che manca è vederlo accadere fra due persone, non la certezza che il codice lo
faccia.

## Setup

Serve Node 24.

```bash
npm install
```

### 1. Progetto Supabase

Crea un progetto su [supabase.com](https://supabase.com) **in una region UE** — qualunque
va bene; l'hosting europeo è parte della posizione GDPR (ADR-0002). La region
**non si cambia dopo la creazione**, quindi controllala prima di procedere.

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

Poi il seed della tassonomia generi, che è versionata e non si inserisce a mano
(ADR-0007). È idempotente: si può rilanciare a ogni deploy.

```bash
npm run db:seed
```

Senza generi, l'affinità che il motore conflitti calcola in Fase 3 non ha nulla
su cui lavorare.

### 3. Auth

Nel pannello Supabase, sezione _Authentication_:

- **URL Configuration → Redirect URLs**: aggiungi
  `http://localhost:5173/auth/callback` e
  `https://<dominio-di-produzione>/auth/callback`. Senza questo il magic link
  non torna all'applicazione.
- **Providers → Email**: lascia attivo il magic link; disattiva la password.

La registrazione è **solo su invito** (ADR-0004): il form di login usa
`shouldCreateUser: false`, quindi un indirizzo sconosciuto non crea un account.
Un account nasce unicamente accettando un invito valido, da `/invite/[code]`.

### 4. Primo accesso

Il calendario parte vuoto, e un invito può essere generato solo da chi è già
dentro: il primo utente va creato a mano.

1. In Supabase, _Authentication → Users → Add user_, con la tua email.
2. Accedi da `/login`. Il profilo viene creato al primo accesso.
3. Promuoviti ad amministratore della piattaforma:

   ```sql
   update profiles set is_platform_admin = true where email = 'tua@email';
   ```

4. Ricarica: atterri su `/admin/invites`, l'unica pagina raggiungibile da un
   profilo che non appartiene ancora a nessuna organizzazione. Genera il primo
   invito e aprilo tu stesso per registrare la tua organizzazione.

Da lì in poi ogni nuovo ingresso passa da un invito, generato da `/admin/invites`
per una organizzazione nuova o da `/org` per aggiungere un membro a una
esistente.

### 5. Dev server

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
| `npm run db:seed`     | tassonomia generi (idempotente)                 |
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
`profiles.id` ha una foreign key verso lo schema `auth`, che su Supabase non
appartiene al ruolo con cui giriamo le migrazioni. Va racchiuso nel blocco `DO`
di `0000_fase0_profiles.sql`, che lo salta quando la tabella esiste (ADR-0015).
Renderlo solo idempotente non basta: `IF NOT EXISTS` verifica comunque i
permessi e fallisce con `42501`.

### Endpoint cron

Gli endpoint sotto `/api/cron/` richiedono l'header `x-cron-secret` uguale al
secret `CRON_SECRET`. Senza header valido rispondono `403`, sempre.

### Il dev server parte ma la pagina non finisce mai di caricare

Sintomo: `npm run dev` stampa `ready in ...` e l'indirizzo, ma nel browser la
scheda gira a vuoto all'infinito.

Quasi sempre è la cache di pre-bundle di Vite (`node_modules/.vite`) rimasta
indietro rispetto alle dipendenze. Vite risponde `500` su un modulo con
_"there is a new version of the pre-bundle, a page reload is going to ask for
it"_, il client ricarica, riceve lo stesso errore, e il giro non finisce mai.

Succede in due casi:

- **dopo un `npm install` o `npm uninstall`** con il dev server già avviato,
  o riavviato senza che Vite si accorgesse del cambiamento;
- **con due dev server aperti sulla stessa cartella**: condividono
  `node_modules/.vite` e se lo invalidano a vicenda. Non tenerne due.

Rimedio, nell'ordine:

```bash
rm -rf node_modules/.vite
```

poi riavvia `npm run dev`. All'avvio deve comparire una riga tipo
`Forced re-optimization of dependencies` o `[optimizer] bundling
dependencies...`: è il segno che la cache è stata ricostruita.

**Non basta riavviare il server.** Vite serve i moduli pre-bundle con
`immutable`, quindi il browser tiene in cache i riferimenti ai vecchi hash e un
normale F5 non li richiede di nuovo: continua a chiederli, si prende un `504`
("outdated optimize dep") e ricarica all'infinito. Serve un ricaricamento
forzato con **Ctrl+Shift+R**, o F12 → **Application** → **Clear site data**.

Nota che la cache è per **origine**: se `http://localhost:5173` gira a vuoto
mentre `http://192.168.1.74:5173` funziona, non è il server ad avere due
comportamenti — è la prima origine ad avere lo sporco in cache e la seconda a
essere pulita.

Le dipendenze importate da una sola pagina sono le più esposte a questo giro,
perché Vite le scopre solo quando quella pagina viene servita per la prima
volta, e a quel punto ri-ottimizza e forza un reload. Per questo FullCalendar è
dichiarata in `vite.config.ts` sotto **`environments.client.optimizeDeps`**:
viene preparata all'avvio, non a metà sessione. Se in futuro aggiungi una
dipendenza usata da una rotta sola, elencala lì.

### Ogni pagina che tocca il database resta appesa

Sintomo insidioso: `/login` risponde, le pagine statiche rispondono, ma
qualunque rotta che interroghi il database non torna mai — nessun errore, né
nel browser né nel terminale.

Causa vista una volta e da non ripetere: un `optimizeDeps` scritto al **livello
principale** di `vite.config.ts`. In Vite 8 vale per tutti gli ambienti, SSR
compreso, e ri-ottimizzando l'SSR finisce nel pre-bundle anche `postgres`, che
da lì non riesce più ad aprire la connessione. Le dichiarazioni di
pre-bundling per il browser vanno **sempre** sotto `environments.client`.

Come riconoscerlo in fretta: se lo stesso `select` gira in millisecondi da uno
script `tsx` e non torna dall'applicazione, non è il database — è l'ambiente
SSR.

Attenzione anche alle misure: il pool ha **una sola connessione**
(`max: 1` in `db/client.ts`, obbligatorio con il pooler in transaction mode).
Una richiesta lenta accoda tutte le successive, quindi provando più volte di
seguito si misura la propria coda invece del problema. Ferma tutto, riavvia il
dev server e fai **una** richiesta.

### Il browser resta in attesa e non arriva mai nessun errore

Sintomo diverso dal precedente: il server risponde a `curl`, ma la scheda del
browser gira a vuoto per sempre, senza nemmeno un messaggio di errore.

Causa: su questa macchina `localhost` risolve in `::1`, e Vite di default si
lega **solo** a quello. Un browser che punta a `127.0.0.1` non trova nessuno in
ascolto — e su Windows il pacchetto verso una porta loopback IPv4 senza
listener viene **scartato invece che rifiutato**. Senza un rifiuto non c'è
errore da mostrare, e il browser aspetta all'infinito.

Il rimedio è già in `vite.config.ts` (`server.host: true`): il dev server
ascolta su entrambi gli stack, quindi `localhost`, `127.0.0.1` e `[::1]`
funzionano tutti. Come effetto collaterale il server risponde anche agli altri
dispositivi della rete locale — comodo per provare l'interfaccia dal telefono,
e ininfluente sul deploy. Al primo avvio Windows può chiedere di sbloccare
Node nel firewall: è quello.

Per controllare su cosa sta ascoltando:

```bash
netstat -ano | findstr :5173
```

Devono comparire **due** righe in `LISTENING`, una su `0.0.0.0` e una su
`[::]`. Se ne vedi una sola su `[::1]`, il dev server sta girando con una
configurazione vecchia: fermalo e riavvialo.

## Convenzioni di codice

- Il browser non parla mai direttamente con Supabase per i dati di dominio: solo
  l'auth passa dal client (ADR-0003).
- Nessun handler restituisce una riga `events` grezza: tutto passa da
  `serializeEvent()` (ADR-0005).
- Il motore conflitti in `src/lib/server/conflicts/` è codice puro senza I/O,
  sempre coperto da test unitari.
- Le etichette che servono anche al browser (nomi degli stati, ruoli di
  locandina) stanno in `src/lib/events.ts`, non sotto `$lib/server`:
  SvelteKit rifiuta di importare `$lib/server` dal codice client, e un
  calendario che deve scrivere "Opzionata" non è una decisione di dominio.
  Sotto `$lib/server` resta ciò che _decide_ qualcosa.
- Gli orari viaggiano come orario di parete (`2026-10-12T22:00`) fino al
  salvataggio, dove `daLocaleAIstante()` li converte in istanti. È l'unico
  punto di conversione: il server gira in UTC, e costruire una `Date` da
  un'ora italiana in qualunque altro punto sposterebbe la data di un'ora nei
  due fine settimana in cui cambia l'ora legale.
- Le rotte autenticate stanno dentro `src/routes/(app)/`: la guardia in
  `hooks.server.ts` protegge il gruppo, non una lista di path.
- Il contesto utente (`locals.viewer`, `locals.profile`) si popola **negli
  hook**, mai in una `load`. In SvelteKit le form action girano prima delle
  `load`: un contesto costruito in una `load` non esiste ancora quando
  l'action lo legge, e ogni scrittura fallisce con "Sessione non valida".
- La configurazione SvelteKit sta in `vite.config.ts`, non in un
  `svelte.config.js`: è la convenzione dello scaffolding corrente. Alcuni
  strumenti di terze parti cercano ancora `svelte.config.js` — se serve, si
  aggiunge un file minimale senza spostare la configurazione.
