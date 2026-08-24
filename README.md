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
| 3 — Motore conflitti    | codice completo, manca il deploy |
| 4 — Interoperabilità    | codice completo, manca il deploy |
| 5 — Import assistito    | da iniziare                      |
| 6 — Rifinitura          | da iniziare                      |

Fasi da 0 a 4 complete sul codice. Il progetto Supabase esiste, le migrazioni
fino a `0004_fase4_feed` sono applicate e i generi sono seminati. Resta il
primo deploy su Cloudflare. Vedi [Setup](#setup).

**Il criterio di fine della Fase 4 è stato verificato per intero** (23 agosto
2026), su client veri e non solo dai test. Il criterio chiedeva che _un feed
sottoscritto in Google Calendar e in Apple Calendar mostri le date corrette e
si aggiorni dopo una modifica_, e sono entrambe soddisfatte: **le date
compaiono giuste in tutti e due, e spostando una data nell'applicazione tutti
e due la spostano.**

Sottoscrivere un feed richiede però un URL che Google e Apple possano
raggiungere, e il deploy non c'è ancora: la prova si è fatta esponendo il dev
server con un tunnel usa-e-getta, che è la stessa cosa dal punto di vista dei
due client. Come si rifà è nel runbook, sotto [Feed ICS](#feed-ics) — servirà
di nuovo ogni volta che si tocca il formato.

Il resto, verificato sull'applicazione in esecuzione con i dati di
`npm run db:seed:demo`:

- il feed risponde `text/calendar` con `X-WR-CALNAME`, `REFRESH-INTERVAL:PT12H`
  e `SOURCE`, e **rispetta la matrice di visibilità**: la data confermata di
  un'altra organizzazione esce intera, quella opzionata diventa un evento di
  giornata intera intitolato _"Opzionata · Metal · Circolo Arci Lupo Bianco"_
  senza titolo, locale, orario né generi secondari, e la **bozza altrui non
  compare affatto**;
- **`SEQUENCE` cresce solo sulla data modificata.** Spostando _Serata Bassa
  Marea_ dal 12 al 14 settembre, la sua voce è passata a `20273183` mentre le
  altre quattro sono rimaste ferme a `20086451`/`20086452`. Il dettaglio che
  conta è il secondo: se il numero salisse a ogni scaricamento, i client
  rileggerebbero tutto ogni volta e nessuno se ne accorgerebbe finché il feed
  non diventa grande. È l'errore che [ADR-0011](docs/DECISIONS.md) elenca per
  nome ([ADR-0028](docs/DECISIONS.md));
- i filtri restringono davvero: un feed «solo metal entro 60 km da Perugia»
  creato dal modulo geocodifica la città una volta sola e lascia fuori la
  serata jazz e quella cantautorale, tenendo i sottogeneri (Stoner, Sludge,
  Black Metal, Doom) — la tassonomia di [ADR-0007](docs/DECISIONS.md) all'opera;
- disdire un feed ha effetto **subito**: lo stesso URL passa da `200` a `404`,
  e gli altri feed dello stesso profilo continuano a funzionare;
- gli export rispettano la stessa matrice — nel CSV la riga di una data
  opzionata altrui ha vuote le colonne di titolo, locale, orario e lineup e
  piene quelle di giorno, città, genere principale e organizzazione;
- il JSON-LD contiene **solo le tre date annunciate** su sei, con
  `EventCancelled` su quella annullata, ed è assente dalla pagina di una data
  opzionata altrui;
- il copy per i social si genera per le tre piattaforme e **avvisa**: su una
  data ancora opzionata dice che pubblicare il testo equivale ad annunciarla.

Il caso delicato si comporta come deve anche qui. Una band non annunciata non
compare in **nessuna** delle quattro uscite nuove — feed, ICS singolo, export,
copy social — e i test lo verificano cercandone il nome nel file intero, non
nei campi in cui ci si aspetterebbe di trovarlo.

**Il criterio di fine della Fase 3 è stato verificato nell'applicazione in
esecuzione** (22 agosto 2026), non solo dai test. Il criterio chiedeva due
cose, e sono entrambe soddisfatte: compilando una data in conflitto **l'avviso
compare durante la compilazione**, prima di salvare, e il conflitto **è
persistito per entrambe le parti**.

Provato con i dati di `npm run db:seed:demo`:

- l'anteprima nel form segnala la sovrapposizione digitando il 12 settembre,
  senza aver salvato niente;
- la dashboard mostra il conflitto, con la controparte ridotta a giorno,
  città, genere e contatto perché la sua data è opzionata;
- le azioni funzionano tutte — presa d'atto per lato, chiusura con nota,
  archiviazione, riapertura dallo storico;
- `POST /api/cron/recompute` rileva e persiste, ed è idempotente: la seconda
  esecuzione trova zero conflitti nuovi;
- una data annullata e poi riopzionata riapre il conflitto che era stato
  chiuso con una nota ([ADR-0027](docs/DECISIONS.md)), azzerando le prese
  d'atto e conservando la nota.

Il caso più delicato si comporta come deve. Una band opzionata in segreto da
un'organizzazione e già annunciata da un'altra la stessa sera produce un
conflitto che **l'organizzazione con la band segreta vede, col nome della
band, mentre l'altra non vede affatto** — perché vederlo le direbbe chi ha
ingaggiato la controparte. È il leak che [ADR-0009](docs/DECISIONS.md)
elencava come rischio noto, chiuso da [ADR-0024](docs/DECISIONS.md).

Resta legato al deploy il solo ricalcolo notturno: `.github/workflows/recompute-conflicts.yml`
ha bisogno dei secret `APP_URL` e `CRON_SECRET`, e di un `APP_URL` che esista.
I feed non sono in questa lista — funzionano, è stato provato — ma vale per
loro l'avvertenza su `PUBLIC_APP_URL` nella sezione [Deploy](#deploy).

**Il criterio di fine della Fase 2 è stato verificato nell'applicazione in
esecuzione** (21 agosto 2026), non solo dai test: con i dati di
`npm run db:seed:demo`, un profilo che appartiene a una sola organizzazione
vede le date delle altre esattamente come prevede la matrice di §5 — la bozza
altrui non compare affatto, la data opzionata mostra solo giorno, città,
genere principale e contatto, la confermata espone la sola lineup annunciata,
l'annullata resta visibile col suo badge, e la propria data opzionata si apre
per intero, note interne comprese.

Restano invece da verificare i criteri che richiedono **due account veri**:
_login e logout in produzione_ (Fase 0) e _due utenti in due organizzazioni
diverse_ (Fase 1). Il collo di bottiglia non è il codice ma la posta: il
servizio email integrato di Supabase ammette pochissimi invii all'ora, quindi
il secondo account conviene crearlo dopo aver configurato un SMTP
personalizzato (vedi il runbook).

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

Le migrazioni usano `DIRECT_DATABASE_URL` (porta 5432), mai il pooler in
transaction mode, e girano da locale o da CI — mai a runtime.

> **Attenzione all'host.** Supabase offre due stringhe sulla 5432: la
> connessione diretta `db.<ref>.supabase.co` e il **pooler in session mode**
> `aws-<n>-<region>.pooler.supabase.com`. La prima oggi risponde **solo su
> IPv6**, e da una rete senza IPv6 `drizzle-kit migrate` resta appeso su
> `applying migrations...` finché non lo si interrompe, senza mai stampare un
> errore di rete. Usa la seconda: è la forma già scritta in `.env.example`, ha
> lo stesso comportamento per le migrazioni, e la 5432 basta a distinguerla
> dalla 6543 del transaction mode.

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

#### Il template email non è facoltativo

In **Authentication → Emails → Magic Link** il corpo del messaggio va
sostituito con questo:

```html
<h2>Accedi al Calendario Eventi Condiviso</h2>
<p>
	<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink">Accedi</a>
</p>
<p>Se non hai chiesto tu questo accesso, ignora questa email.</p>
```

**Con il template predefinito il login non funziona**, e vale la pena sapere
perché prima di perderci un pomeriggio.

Quello predefinito usa `{{ .ConfirmationURL }}`, che manda l'utente a
`/auth/v1/verify` di Supabase, il quale a sua volta rimbalza sul nostro
callback con un `?code=`. Quel codice si scambia con una sessione solo
esibendo un **verificatore PKCE**, che il server ha messo in un cookie quando
l'utente ha compilato il form di login. Il presupposto è che chi clicca il
link sia lo stesso browser che l'ha richiesto — e per un link che viaggia
dentro un'email è un presupposto sbagliato: si apre la posta dal telefono,
dalla webmail, da un client che delega al browser di sistema. Su Windows basta
che il browser predefinito non sia quello in cui si stava lavorando. Il cookie
non c'è, e il callback registra `pkce_code_verifier_not_found`.

Con `{{ .TokenHash }}` il link punta **direttamente** all'applicazione e non
passa più da `/auth/v1/verify`. Il callback prende il ramo `token_hash`, che
usa `verifyOtp` e non ha bisogno di nessun cookie: funziona da qualunque
browser e da qualunque dispositivo. In più `next` sopravvive, perché non c'è
più nessuno che riscrive l'URL di ritorno.

Il `?` prima di `token_hash` non è un refuso, ed è il punto in cui è più facile
sbagliare. L'azione di login costruisce `emailRedirectTo` come
`/auth/callback?next=…`, ma **Supabase scarta la query string**: confronta
`redirect_to` con la allow-list dei Redirect URL e rende l'indirizzo così come
è scritto lì. `{{ .RedirectTo }}` arriva quindi al template senza query, e con
un `&` si otterrebbe `/auth/callback&token_hash=…` — un percorso unico, che
risponde **404**.

Conseguenza pratica: nel flusso via email il `next` non sopravvive mai, e dopo
l'accesso si atterra dove decide `safeNext(null)`, cioè `/calendar`. È una
dipendenza fra un template che vive nel pannello Supabase e una riga di codice
nel repo — per questo è annotata in tutti e due i posti.

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

> **`PUBLIC_APP_URL` va fissata sul nome definitivo prima che qualcuno
> sottoscriva un feed, e poi non si cambia.** Da Fase 4 non è più solo
> cosmetica: il suo host finisce dentro gli `UID` degli eventi ICS, che sono
> la chiave con cui un client calendario riconosce che una data è _la stessa_
> di ieri. Cambiarla non aggiorna le date già scaricate — ne crea un secondo
> set accanto alle prime, in tutti i calendari sottoscritti, e l'unico rimedio
> è chiedere a ognuno di disdire e risottoscrivere.
>
> Vale anche al contrario: se si prova un feed da un tunnel (vedi il runbook),
> quella sottoscrizione va tolta dai calendari prima di passare all'indirizzo
> vero, per lo stesso motivo.

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
secret `CRON_SECRET`. Senza header valido rispondono `403`, sempre. Il
controllo sta in `cronGuard` dentro `src/hooks.server.ts` e copre l'intero
prefisso: un endpoint nuovo sotto `/api/cron/` è protetto senza doverci
pensare, ed è il motivo per cui i singoli handler non ricontrollano.

Se `CRON_SECRET` non è configurata sul server, gli endpoint restano **chiusi**.
L'alternativa — aprirli quando la variabile manca — trasformerebbe una
dimenticanza di configurazione in un endpoint pubblico che riscrive mezzo
database.

`POST /api/cron/recompute` ricalcola i conflitti di tutte le date `hold` e
`confirmed` nella finestra futura (18 mesi di default, `?mesi=N` per
cambiarla). È idempotente: si può rilanciare a mano senza pensarci, e la
risposta dice quanti eventi ha esaminato, quanti conflitti sono nuovi e quanti
ne ha chiusi. Lo schedula `.github/workflows/recompute-conflicts.yml`, che ha
bisogno dei secret `APP_URL` e `CRON_SECRET`.

Il ricalcolo ordinario non passa da qui: avviene a ogni salvataggio di una
data. Il job notturno serve a recuperare le derive, perché la riconciliazione
è progettata per non sollevare mai e quindi può fallire in silenzio.

### Feed ICS

`GET /api/ics/[token].ics` è **l'unico endpoint pubblico che restituisce dati
di dominio**, ed è pubblico per un motivo che non si può aggirare: nessun
client calendario sa fare login. L'autenticazione è il token nell'URL.

Il feed contiene esattamente ciò che vedrebbe il profilo che lo possiede, mai
un campo di più: è redatto da `serializeEvent()` come qualunque altra uscita.
Le bozze non ci sono in nessun caso ([ADR-0029](docs/DECISIONS.md)).

Un token si disdice da `/settings/feeds`. La revoca ha effetto immediato e non
tocca gli altri feed della stessa persona. Le date già scaricate restano nel
calendario di chi le aveva, ferme all'ultima lettura: un feed che smette di
rispondere non le cancella, e non c'è modo di farlo.

Un token revocato e uno inesistente rispondono **entrambi** `404`.
Distinguerli direbbe a chi ha un URL vecchio che quell'URL era buono.

**Se un calendario non si aggiorna** — le date compaiono ma restano ferme —
guarda il `SEQUENCE` delle voci prima e dopo aver modificato una data:

```bash
curl -s https://APP_URL/api/ics/TOKEN.ics | grep -A1 "UID:ID_EVENTO" | grep SEQUENCE
```

Se non cambia, il problema è `events.updated_at` che non si muove, non il feed:
il numero si deriva da lì ([ADR-0028](docs/DECISIONS.md)). È il guasto più
insidioso di questa integrazione perché non produce nessun errore — produce un
calendario che sembra a posto ed è vecchio di un mese.

`last_accessed_at` sulla riga di `calendar_feeds` dice quando un client è
passato l'ultima volta. Un feed «mai letto» dopo giorni significa che l'URL non
è stato incollato da nessuna parte, non che il feed sia rotto.

Il rate limit per token previsto da ARCHITECTURE.md §16 arriva in Fase 6,
insieme a quelli di `/api/parse` e `/api/geocode`.

#### Provare un feed senza deployare

Il feed è l'unica parte di questo prodotto che **non si può collaudare da
soli**: che il file sia valido lo dicono i test, che un client vero lo digerisca
lo dice solo un client vero, e i server di Google `localhost` non lo
raggiungono. Serve un indirizzo pubblico temporaneo.

```bash
winget install --id Cloudflare.cloudflared   # una volta sola
npm run dev
cloudflared tunnel --url http://localhost:5173   # in un secondo terminale
```

Il tunnel stampa un indirizzo `https://<parole-a-caso>.trycloudflare.com`, nuovo
a ogni avvio e senza bisogno di account. Poi:

1. metti quell'indirizzo in `PUBLIC_APP_URL` nel `.env` e **riavvia il dev
   server** — la variabile si legge all'avvio;
2. crea un feed **dall'indirizzo del tunnel**, non da localhost, altrimenti
   l'URL che la pagina mostra è ancora quello vecchio;
3. prima di darlo a Google, controlla che risponda davvero:
   `curl -s https://<tunnel>/api/ics/<token>.ics | head -12`.

`vite.config.ts` autorizza `.trycloudflare.com` in `server.allowedHosts`: da
Vite 6 il dev server rifiuta le richieste con un `Host` non locale, e senza
quella riga Google riceverebbe `Blocked request. This host is not allowed.` —
cioè un guasto che si presenta come un feed vuoto.

**Per la prova di aggiornamento sposta la data nell'applicazione**, non nel
calendario: il feed è in sola lettura ([ADR-0011](docs/DECISIONS.md)) e i due
client non lasciano nemmeno modificare un calendario sottoscritto. Spostala di
un **giorno** e non di un'ora, così si vede anche sulle voci che nel feed sono
eventi di giornata intera. Apple ha un comando di aggiornamento immediato,
Google no: per chiudere in fretta si guarda Apple, e Google conferma con i suoi
tempi.

Finita la prova: chiudi il tunnel, **togli la sottoscrizione dai calendari**
(gli `UID` contengono l'host del tunnel — vedi l'avvertenza sotto
[Deploy](#deploy)), disdici il feed di prova e rimetti `PUBLIC_APP_URL` a
`http://localhost:5173`.

Finché il tunnel è aperto il dev server è raggiungibile da internet, con dietro
il database vero. Tutto è dietro sessione tranne login, invito e il feed col
token, ma è un motivo in più per non lasciarlo su.

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

### `npm run build` fallisce con EPERM su `.svelte-kit/cloudflare`

```
error during build:
Error: EPERM, Permission denied: ....svelte-kitcloudflare
```

Il bundle in realtà è stato prodotto — la riga `✓ built` compare poco sopra.
A fallire è la pulizia della cartella di output dell'adapter Cloudflare.

Causa: **il dev server è ancora acceso.** Vite tiene aperti dei descrittori su
`.svelte-kit`, e su Windows una cartella osservata non si cancella. Ferma
`npm run dev` e rilancia la build. Su Linux e macOS lo stesso comando passa,
quindi in CI non si vede: è un inciampo solo locale, ma capita esattamente nel
momento peggiore, cioè quando si prova a fare un deploy di fretta.

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

> **Correzione (2026-08-22).** Qui c'era il consiglio opposto: «il pool ha una
> sola connessione, quindi prova **una** richiesta alla volta, altrimenti
> misuri la tua stessa coda». Seguirlo nascondeva il guasto invece di
> mostrarlo — il blocco si manifesta **solo** con richieste concorrenti, ed è
> per questo che è rimasto inspiegato per mezza giornata. La causa era `max: 1`
> col pooler in transaction mode: vedi [ADR-0026](docs/DECISIONS.md), il pool
> ora ha dieci connessioni.

### Le pagine autenticate non rispondono, poi il dev server muore

Sintomo: `/calendar` resta appesa circa due minuti, poi nel terminale compare
un `[500]` con `Failed query: select … from "profiles"` seguito da
`PostgresError: canceling statement due to statement timeout` (`57014`), e il
processo termina con `triggerUncaughtException`.

La query su `profiles` è quasi sempre **innocente**: è solo la prima della coda
quando la connessione è già bloccata da un'altra. Per vedere la colpevole
bisogna guardare dal lato del database mentre il blocco è in corso:

```sql
select pid, state, wait_event_type, wait_event,
       round(extract(epoch from now() - query_start)) as secondi,
       left(query, 90)
from pg_stat_activity
where datname = current_database() and state = 'active';
```

Una sessione `active` ferma su `wait_event = ClientRead` significa che Postgres
ha finito e sta aspettando un client che non parlerà più: è una
desincronizzazione del protocollo, non una query lenta.

La causa nota è `max: 1` col pooler in transaction mode ([ADR-0026](docs/DECISIONS.md)),
corretta. Se il sintomo tornasse, la prova che lo isola è confrontare **una**
richiesta con **tre in parallelo**: se la prima passa e le altre no, è di nuovo
il pipelining sulla connessione condivisa.

### Il browser resta in attesa e non arriva mai nessun errore

Sintomo: la scheda del browser gira a vuoto per sempre, senza nemmeno un
messaggio di errore. Su Windows un pacchetto verso una porta loopback senza
listener viene **scartato invece che rifiutato**, e senza un rifiuto non c'è
errore da mostrare: il browser aspetta all'infinito.

**Controlla per prima cosa che ci sia qualcosa in ascolto.** È la causa più
banale e la più facile da non sospettare, perché non produce nessun segnale:

```bash
netstat -ano | findstr :5173
```

Nessuna riga vuol dire che il dev server non è in esecuzione, o gira su
un'altra porta perché la 5173 era occupata quando è partito — Vite in quel caso
ripiega sulla 5174 e lo scrive solo nella riga `Local:` del suo avvio. Capita
soprattutto **dopo un magic link**: `PUBLIC_APP_URL` fissa `localhost:5173`
nell'email, quindi il link punta lì anche se il server nel frattempo è morto o
si è spostato. Il login non c'entra: è la porta a essere muta.

Se invece una riga c'è, il problema è un altro: su questa macchina `localhost`
risolve in `::1`, e Vite senza configurazione si lega **solo** a quello. Un
browser che punta a `127.0.0.1` ricade allora nel caso di sopra — nessun
listener a quell'indirizzo, nessun rifiuto, attesa infinita.

Il rimedio è già in `vite.config.ts` (`server.host: true`): il dev server
ascolta su entrambi gli stack, quindi `localhost`, `127.0.0.1` e `[::1]`
funzionano tutti. Come effetto collaterale il server risponde anche agli altri
dispositivi della rete locale — comodo per provare l'interfaccia dal telefono,
e ininfluente sul deploy. Al primo avvio Windows può chiedere di sbloccare
Node nel firewall: è quello.

Per controllare su cosa sta ascoltando, guarda l'indirizzo nelle righe
`LISTENING` di `netstat`:

- `[::]` da solo va **bene**: è un socket dual-stack, e serve anche l'IPv4.
  `localhost`, `127.0.0.1` e `[::1]` rispondono tutti e tre. È quello che
  produce `server.host: true`, ed è la configurazione corrente.
- `[::1]` da solo è il caso rotto: il socket è legato al solo loopback IPv6, e
  chi arriva da `127.0.0.1` non trova nessuno. Il dev server sta girando con
  una configurazione vecchia: fermalo e riavvialo.

> **Correzione (2026-08-22).** Questa voce diceva che dovevano comparire _due_
> righe, una su `0.0.0.0` e una su `[::]`. Non è vero su Windows con Node: il
> socket dual-stack ne mostra una sola. Chi seguiva l'istruzione alla lettera
> concludeva che la configurazione fosse vecchia e riavviava senza motivo,
> mentre il problema era altrove — quasi sempre nessun listener affatto.

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
