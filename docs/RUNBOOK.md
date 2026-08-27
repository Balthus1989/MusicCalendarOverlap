# Runbook — Calendario Eventi Condiviso

Il documento operativo del progetto: stato verificato, installazione, comandi,
deploy, manutenzione e i difetti già incontrati con la loro diagnosi. **È
scritto per chi ci mette le mani**, non per chi arriva sul repository.

Fino al 27 agosto 2026 questo file era il `README.md` in radice, cioè la prima
cosa che GitHub mostrava a chiunque. Non era il posto giusto: la stringa di
connessione al pooler, i codici di errore di Supabase e il modo di riprodurre in
locale un guasto di `workerd` non sono la presentazione di un prodotto. La
presentazione sta ora in [`../README.md`](../README.md), e qui è rimasto il
resto.

- Presentazione e funzionalità: [`../README.md`](../README.md)
- Architettura completa: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Decisioni e vincoli: [`DECISIONS.md`](DECISIONS.md)

## Stato

| Fase                    | Stato                               |
| ----------------------- | ----------------------------------- |
| 0 — Fondazioni          | in produzione                       |
| 1 — Anagrafiche         | in produzione                       |
| 2 — Eventi e calendario | in produzione                       |
| 3 — Motore conflitti    | in produzione                       |
| 4 — Interoperabilità    | in produzione                       |
| 5 — Import assistito    | in produzione; testo libero sospeso |
| 6 — Rifinitura          | in produzione                       |

**L'applicazione è online** (26 agosto 2026):

```
https://calendario-eventi-condiviso.rendar55.workers.dev
```

Il progetto Supabase esiste, le migrazioni fino a `0009_fase6_telegram` sono
applicate e i generi sono seminati.

Il primo giro in produzione ha trovato **un difetto che sei fasi di sviluppo
non potevano vedere**: l'applicazione rispondeva un 500 sì e uno no, sempre
sulla prima query della richiesta, sempre in una decina di millisecondi. Il
pool di connessioni stava in una variabile di modulo — la cosa giusta su Node,
un guasto su Cloudflare, dove un socket aperto nel contesto di una richiesta
non è utilizzabile da un'altra. Ora la connessione vive quanto la richiesta
([ADR-0041](DECISIONS.md)), e **nasce solo se qualcuno la chiede**: la
prima stesura la apriva all'ingresso della catena degli hook, e così facendo
metteva `npm run build` in mano al database — la prerenderizzazione di
`/offline` attraversa gli hook e pretendeva `DATABASE_URL`, che la CI non ha e
non deve avere. Rossa sul solo passo `Build`, e con ragione.

Si riproduce in locale con `wrangler dev`, che gira lo stesso runtime: vedi il
runbook, sotto [Riprodurre in locale un difetto che si vede solo in
produzione](#riprodurre-in-locale-un-difetto-che-si-vede-solo-in-produzione).

**Corretto e verificato sul dominio vero**: ventidue richieste consecutive
tutte `200` dove prima alternava, e la **suite E2E completa passa contro la
produzione** — quindici test su quindici. Che chiude anche i due criteri
rimasti indietro dall'inizio:

- _login e logout in produzione_ (**Fase 0**): il magic link viene convertito in
  sessione da `/auth/callback` sul dominio pubblico, e da lì l'applicazione si
  apre;
- _due utenti in due organizzazioni diverse_ (**Fase 1**): due profili, due
  circoli, e la matrice di visibilità che si comporta come deve fra loro.

Gli endpoint di cron sono **chiusi a chi non ha il segreto**: `403` senza
header, JSON con. Dopo ogni corsa il database resta pulito: zero organizzazioni,
profili ed eventi con il prefisso `e2e-`.

Il feed ICS servito da lì porta gli `UID` col dominio definitivo. Erano nati
con un refuso — una lettera di troppo incollata a mano in `PUBLIC_APP_URL` — e
sono stati corretti prima che qualcuno sottoscrivesse il feed, che è l'unico
momento in cui correggerli costa zero.

**La Fase 6 è l'unica senza un criterio di fine dichiarato in `ARCHITECTURE.md`
§12**: è una lista di rifiniture, non una promessa da verificare. Quello che si
può dire è che cosa è stato provato e che cosa no (24 agosto 2026).

**Provato sull'applicazione in esecuzione, dagli smoke test end-to-end.** I
quindici test di `tests/e2e/` girano contro il database vero, con due
organizzazioni create e cancellate a ogni giro, e passano tutti. Coprono il
percorso di §15 quasi per intero: Alfa genera un invito, inserisce una data
opzionata e **vede il conflitto comparire prima di salvare**; Beta la ritrova
ridotta a giorno, città e genere, con il conflitto in dashboard, l'avviso nella
casella e un feed ICS che contiene la propria data ma non il titolo di quella
opzionata da Alfa. Resta fuori, dichiarandolo, la registrazione di un terzo
utente che riscatta l'invito ([ADR-0038](DECISIONS.md)).

Il caso di sempre si comporta come deve anche qui: la band che Beta non ha
annunciato **non compare nella pagina della sua data vista da Alfa**, e il
controllo si fa cercandone il nome nell'HTML intero.

**Provato a mano.** I quattro endpoint di cron rispondono e sono idempotenti:
`recompute` ritrova zero conflitti nuovi alla seconda esecuzione, `digest`
scrive un riepilogo a settimana e la seconda corsa dello stesso lunedì non
manda niente, `notify` e `purge` girano a vuoto quando non c'è niente da fare.

Due difetti trovati proprio così, e non dai test:

- `/api/cron/purge` rispondeva **500**. Dentro un template `sql` grezzo la
  `Date` non passa dal codificatore della colonna e arriva a Postgres come il
  testo di `toString()`, che nessun `timestamptz` sa leggere. La tabella dei
  contatori di rate limit non si sarebbe svuotata mai, e nessuno se ne sarebbe
  accorto guardando l'applicazione;
- le migrazioni `0006` e `0007` **non erano applicate**, e il layer di notifica
  taceva invece di rompersi — è progettato per non sollevare mai. Se ne sono
  accorti i due smoke test nuovi sulla casella degli avvisi, che erano gli
  unici a guardare il risultato invece dell'assenza di errori.

**Il canale delle notifiche funziona, ed è Telegram** (25 agosto 2026).
L'email è stata rimossa: mandarne a destinatari arbitrari richiede un dominio
verificato che non c'è, e nessun fornitore fa diversamente
([ADR-0039](DECISIONS.md)). Al suo posto un bot, che non chiede domini né
record DNS.

Provato per intero sull'applicazione in esecuzione, dal collegamento alla
consegna: il manutentore ha collegato la propria chat da
`/settings/notifications` — codice, pulsante Avvia sul bot, conferma — e
`telegram_chat_id` è comparso in `notification_prefs` con il codice consumato.

La prova migliore però è arrivata da sé, e riguarda un'altra decisione. In coda
c'era un **digest scritto il 24 agosto**, quando nessun canale esisteva: era
rimasto lì con `consegnata_at` a `NULL`, che è il comportamento voluto. Alla
prima corsa di `/api/cron/notify` dopo il collegamento è partito da solo —
`consegnate: 1`, e in tabella `consegnata_at` valorizzato con
`errore_consegna` a `NULL`. **Un avviso nato quando non c'era nessun canale,
consegnato dal canale arrivato dopo, senza che nessuno lo rimettesse in coda:**
è la promessa di [ADR-0036](DECISIONS.md) verificata sul caso migliore
possibile, e per caso.

Il collegamento della chat **non passa da un webhook** ed è per questo che si è
potuto provare senza deploy: il codice si cerca fra i messaggi con
`getUpdates`, che funziona anche da `localhost`
([ADR-0040](DECISIONS.md)).

**La PWA è installata, e il guscio offline funziona** (26 agosto 2026). Il
manutentore l'ha aggiunta alla schermata home da Brave su Android: l'app si apre
senza barra degli indirizzi, e in modalità aereo compare **«Sei senza rete»**
invece dell'errore del browser. Le date offline non ci sono, ed è voluto: una
cache nel browser è l'unico posto dove una risposta sopravvivrebbe al contesto
che l'ha prodotta.

**La corsa notturna gira da sola.** `recompute-conflicts.yml` è partita alle
04:21 UTC del 26 agosto senza che nessuno la lanciasse, e ha risposto con i tre
JSON dei suoi passi. Uno vale più degli altri:

```json
{
	"parseJobs": { "cancellati": 0 },
	"notifiche": { "cancellate": 0 },
	"rateLimit": { "cancellate": 1 },
	"durataMs": 926
}
```

`rateLimit.cancellate: 1` è la pulizia dei contatori scaduti che faceva **500**
prima della correzione: ora lavora in produzione, di notte, senza che nessuno
guardi.

**Anche il digest settimanale gira da GitHub** (27 agosto 2026). Ci sono volute
tre corse: una `startup_failure` senza causa apparente, poi una che è rimasta in
coda diciannove ore — nessuna delle due per colpa del progetto, come si è visto
il giorno dopo, quando la terza è finita in **undici secondi**:

```json
{
	"settimana": "2026-W35",
	"destinatari": 1,
	"registrate": 0,
	"ripetuti": 1,
	"consegnate": 0,
	"fallite": 0
}
```

`ripetuti: 1` e `consegnate: 0` sono la risposta giusta, non una mancata: il
digest di quella settimana era già stato consegnato, e la chiave di deduplica
porta dentro l'etichetta ISO della settimana. È la prova che **rilanciare a mano
il workflow non manda niente a nessuno**, che è ciò che rende sicuro il pulsante
«Run workflow» — e non si poteva sapere senza premerlo due volte.

**L'applicazione si apre dal telefono** (27 agosto 2026). Fino a oggi non si
apriva: su 28 file `.svelte` il layout applicativo non aveva **nessuna** utility
responsive, e bastava aprirla da un cellulare per vederlo. Le nove voci di
navigazione, messe in un `flex-wrap`, occupavano due righe piene di testo da
14px più una terza con «Esci» spinto a filo del bordo destro dal suo `ml-auto`;
il pannello filtri, sempre aperto, ne prendeva altri 310; la barra di
FullCalendar collassava su sé stessa, con «Oggi» uscito dal proprio gruppo e il
titolo a capo addosso ai pulsanti di vista.

Il risultato è che **della pagina calendario il calendario non si vedeva**: la
prima riga di griglia arrivava oltre il bordo inferiore dello schermo.

Sotto `md:` la navigazione principale scende in una barra fissa in basso con
quattro voci — Calendario, Conflitti, Avvisi, Nuova data, che è il ciclo
quotidiano di §1 — e tutto il resto passa dietro un pannello laterale. Il
calendario apre in `listMonth`, perché su colonne da 34px il titolo di una data
non entra e non è un difetto che il CSS possa correggere. Sopra `md:` non
cambia niente ([ADR-0042](DECISIONS.md)).

Le misure a 375px, prima e dopo:

|                         | prima                           | dopo           |
| ----------------------- | ------------------------------- | -------------- |
| Barra di navigazione    | ~110px su 3 righe               | 61px           |
| Filtri                  | ~310px sempre aperti            | 46px chiusi    |
| Barra del calendario    | collassata, 2 righe sovrapposte | 44px, una riga |
| **Prima data visibile** | **oltre il bordo (~760px)**     | **352px**      |
| `<select>`              | 14px, iOS ingrandisce al fuoco  | 16px           |
| Scorrimento orizzontale | —                               | nessuno        |

Due cose emerse applicando, che il progetto su carta non aveva previsto.

- **Nelle righe di elenco lo stato va scritto.** Nelle viste a griglia si legge
  dal bordo tratteggiato, che è la scelta di non affidarlo al solo colore; ma
  una voce di elenco è un `<tr>`, e un bordo tratteggiato attorno a una riga di
  tabella non si disegna in modo affidabile. Siccome l'elenco è ciò che si vede
  aprendo l'applicazione dal telefono, perdere lì la differenza fra una data
  confermata e una opzionata significherebbe perderla e basta. Le etichette
  usano le stesse parole di `ETICHETTE_STATO` e sono elementi veri, non
  `::after`, così le legge anche chi ascolta la pagina.
- **I 16px sui campi non sono tipografia.** Safari su iPhone ingrandisce la
  pagina quando un campo con testo più piccolo riceve il fuoco, e non la
  rimpicciolisce quando lo perde: su un modulo da trenta campi come quello degli
  eventi la pagina resta storta fino in fondo.

Provato con `npm run check`, `npm run lint`, i 527 test unitari e i **15 smoke
test end-to-end**, che entrano davvero nell'applicazione e quindi dicono che la
navigazione nuova non ha rotto nessun flusso critico. Gli scatti di controllo
vengono da un giro Playwright a 393×852 e a 1280×900 sul database di sviluppo,
che si è ripulito da solo.

**Non provato, e va detto.**

- L'accessibilità è stata corretta dove i difetti erano **misurabili** — voci
  del calendario irraggiungibili da tastiera, bordo dei campi a 1,3:1 contro il
  minimo di 3:1, fuoco perso a ogni riga di lineup rimossa — ma **nessuno l'ha
  provata con uno screen reader vero**. È il genere di verifica che vale solo
  se la fa una persona che quello strumento lo usa davvero.
- Il layout mobile è **misurato ma non vissuto**: le altezze, i bersagli da
  44px e l'assenza di scorrimento orizzontale vengono da un browser headless a
  393×852, e il giro l'ha fatto uno script, non un pollice. Quello che si
  scopre solo usandola resta da scoprire — se le quattro voci in basso siano le
  quattro giuste, se il pannello dei filtri si riapra quando serve, se qualcuno
  cerchi «Nuova data» dove non c'è più.

**Il criterio di fine della Fase 5 è verificato nell'applicazione in esecuzione
per le due strade deterministiche, e sospeso per la terza** (24 agosto 2026).
Il criterio chiede che _incollando il testo di un evento reale, il form risulti
compilato in modo utilizzabile_, e per `.ics` e CSV lo è: il manutentore ha
fatto il giro intero dal browser — incolla, form pre-compilato, proposte di
collegamento delle band accettate e rifiutate, salvataggio — e la data esce
giusta.

I controlli che contavano, provati a mano e non solo dai test:

- l'orario dell'`.ics` legge **22:00** e non 20:00 né 21:00, cioè l'ora legale
  applicata all'istante giusto;
- la data nasce in **bozza**, qualunque cosa dica il testo;
- le band compaiono come **proposte** e non risultano già collegate.

Prima del giro dal browser era emerso un difetto che i test non potevano
vedere: il pannello mandava al server l'organizzazione dei valori di partenza
invece di quella scelta nel menù, e chi appartiene a due circoli avrebbe potuto
salvare la data sotto quella sbagliata. Corretto, insieme a un difetto più
vecchio di `Field.svelte`, che dichiarava la prop `onInput` senza collegarla
mai al ramo `<select>`.

Provato prima contro il database vero, con la tassonomia e l'anagrafica reali:

- un `.ics` con `DTSTART:20261012T200000Z` compila il form con **le 22:00
  italiane** — l'ora legale applicata all'istante giusto — collega il locale
  all'anagrafica leggendo il `LOCATION`, risolve `CATEGORIES:Punk,Hardcore`
  nella tassonomia chiusa come `punk` più `hardcore`, e lascia la data in
  **bozza**;
- un CSV con `22:00 → 02:00` porta la fine al **giorno dopo**, normalizza
  `"10,00 €"` in `10,00`, estrae la lineup e ne propone il collegamento
  all'anagrafica **senza applicarlo**;
- un post di Instagram con emoji e «Porte 21:00, inizio 22:00» viene
  riconosciuto come testo libero, cioè mandato al modello: è il verso
  pericoloso del riconoscimento, e non scatta;
- il registro `parse_jobs` scrive, rilegge e scade.

**Resta fuori l'estrazione dal testo libero**, che è il caso principale della
fase. Senza `LLM_API_KEY` l'incolla di un post risponde che il riconoscimento
non è configurato — provato, ed è il comportamento voluto: le due strade
deterministiche non ne risentono, perché non passano da nessun modello.

Il codice della terza strada è completo e coperto dal tipo, ma **nessun post
reale è ancora passato da un modello**, quindi la qualità dell'estrazione non
è misurata e il prompt non è tarato su niente. La messa a punto è
deliberatamente **sospesa**, non dimenticata: il manutentore valuta un LLM
ospitato in locale, e un prompt tarato su Haiku non si trasferirebbe a un
modello da 7-14 miliardi di parametri (decisione #7 in
[DECISIONS.md](DECISIONS.md)).

Quando quella strada si riaprirà, le due cose da fare in quest'ordine sono:
provare l'estrazione su post veri leggendo `parse_jobs`, e solo dopo toccare
`parse/prompt.ts`.

La riverifica delle API Meta che [ADR-0010](DECISIONS.md) rimandava a
questa fase **è stata fatta**, e la conclusione regge: leggere gli eventi di
Utenti e Pagine è riservato ai Facebook Marketing Partner, e Instagram non
modella affatto il concetto di evento. Il punto aperto #5 di `ARCHITECTURE.md`
§17 si chiude, e con esso l'intero elenco dei punti con una scadenza di fase
([ADR-0030](DECISIONS.md)).

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
  non diventa grande. È l'errore che [ADR-0011](DECISIONS.md) elenca per
  nome ([ADR-0028](DECISIONS.md));
- i filtri restringono davvero: un feed «solo metal entro 60 km da Perugia»
  creato dal modulo geocodifica la città una volta sola e lascia fuori la
  serata jazz e quella cantautorale, tenendo i sottogeneri (Stoner, Sludge,
  Black Metal, Doom) — la tassonomia di [ADR-0007](DECISIONS.md) all'opera;
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
  chiuso con una nota ([ADR-0027](DECISIONS.md)), azzerando le prese
  d'atto e conservando la nota.

Il caso più delicato si comporta come deve. Una band opzionata in segreto da
un'organizzazione e già annunciata da un'altra la stessa sera produce un
conflitto che **l'organizzazione con la band segreta vede, col nome della
band, mentre l'altra non vede affatto** — perché vederlo le direbbe chi ha
ingaggiato la controparte. È il leak che [ADR-0009](DECISIONS.md)
elencava come rischio noto, chiuso da [ADR-0024](DECISIONS.md).

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

I criteri che richiedevano **due account veri** — _login e logout in
produzione_ (Fase 0) e _due utenti in due organizzazioni diverse_ (Fase 1) —
sono stati verificati il 26 agosto 2026 dalla suite E2E contro la produzione,
senza passare dalla posta: i token di accesso si generano con il ruolo di
servizio e si spendono su `/auth/callback`, che è la stessa porta del magic
link ([ADR-0038](DECISIONS.md)).

Resta però da configurare un **SMTP personalizzato** prima di invitare persone
vere: il servizio integrato di Supabase ammette pochissimi invii all'ora. Vedi
[L'SMTP del magic link](#lsmtp-del-magic-link) nel runbook. **Quell'SMTP non ha
niente a che vedere con le notifiche**, che passano da Telegram: le due strade
sono a confronto in [Le due strade degli avvisi](#le-due-strade-degli-avvisi).

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
- **Project Settings → Authentication → SMTP**: configura un mittente tuo prima
  di invitare chiunque. Il servizio integrato ammette pochissimi invii all'ora.
  Come si fa, e cosa comporta usare una Gmail, sta in
  [L'SMTP del magic link](#lsmtp-del-magic-link). **Non è l'SMTP delle
  notifiche**, che non esiste: quelle passano da un'API HTTP, vedi
  [Le due strade dell'email](#le-due-strade-dellemail).

La registrazione è **solo su invito** (ADR-0004): il form di login usa
`shouldCreateUser: false`, quindi un indirizzo sconosciuto non crea un account.
Un account nasce solo da un invito valido — accettandolo da `/invite/[code]`,
oppure nel momento in cui l'invito viene generato con un indirizzo, perché è
`inviteUserByEmail` a crearlo per poterglielo spedire ([ADR-0045](DECISIONS.md)).
Finché l'invito non viene accettato quell'account è inerte: nessun profilo,
nessuna membership, nessun accesso.

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

In **Authentication → Emails → Invite user** va messo lo stesso schema, con
`type=invite` al posto di `type=magiclink`:

```html
<h2>Sei stato invitato al Calendario Eventi Condiviso</h2>
<p>
	Un organizzatore ti ha invitato sul calendario condiviso delle date, dove ci si
	coordina sulle serate prima di annunciarle.
</p>
<p>
	<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Entra</a>
</p>
<p>Se non ti aspettavi questo invito, ignora questa email.</p>
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
sbagliare: con un `&` si otterrebbe `/auth/callback&token_hash=…`, un percorso
unico, che risponde **404**.

Quel `?` è corretto **a patto che `{{ .RedirectTo }}` arrivi nudo**, senza query
string. Ed è il motivo per cui l'azione di login passa `emailRedirectTo` come
`/auth/callback` e basta.

> **Correzione (2026-08-26).** Qui c'era scritto che «Supabase scarta la query
> string», e che quindi si poteva passare `/auth/callback?next=…` senza
> conseguenze. **È falso**, e non se n'è accorto nessuno finché il primo magic
> link non è partito da un indirizzo pubblico: `redirect_to` torna **intero**,
> il template ci appende il proprio `?`, e nella posta arriva un link con due
> punti interrogativi —
> `/auth/callback?next=%2Fcalendar?token_hash=…&type=magiclink`. Un URL ne
> ammette uno solo: `token_hash` finisce dentro il valore di `next` e al
> callback non arriva. Il registro diceva
> `{"via":"nessun parametro utilizzabile","parametri":["next","type"]}`, che è
> esattamente questo.
>
> Nessun test poteva vederlo. La suite E2E entra dalla stessa porta ma
> costruisce il link da sé, quindi non passa mai dal template: **l'unico modo di
> incontrarlo era cliccare un link ricevuto per posta**.

Conseguenza pratica: nel flusso via email il `next` non sopravvive, e dopo
l'accesso si atterra dove decide `safeNext(null)`, cioè `/calendar`. È una
perdita accettabile — chi arriva da un magic link non stava andando da nessuna
parte in particolare — ed è una dipendenza fra un template che vive nel
pannello Supabase e una riga di codice nel repo, per questo annotata in tutti e
due i posti.

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
| `npm run test:e2e`    | smoke Playwright (database vero, vedi runbook)  |
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
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_BOT_USERNAME
npx wrangler secret put LLM_API_KEY
```

Senza quelle di Telegram l'applicazione funziona e non manda niente fuori: gli
avvisi restano in pagina e in coda. È un modo legittimo di partire, ma va
saputo — vedi [Notifiche](#notifiche).

Lato GitHub servono i secret di repository `APP_URL` e `CRON_SECRET` per i due
workflow schedulati (`recompute-conflicts.yml` ogni notte, `digest.yml` il
lunedì) e `DIRECT_DATABASE_URL` più `BACKUP_PASSPHRASE` per il backup.

Le `PUBLIC_*` possono stare tra le variabili in chiaro del Worker (sono già
esposte al browser per definizione).

> **Il nome scelto è `calendario-eventi-condiviso.rendar55.workers.dev`**, e
> viene dal nome del Worker in `wrangler.jsonc` più il sottodominio
> dell'account Cloudflare. Rinominare il Worker equivale a cambiare dominio.
>
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

`POST /api/cron/purge` cancella i dati con una scadenza. Sono tre, con tre
motivi diversi: i job di `parse_jobs` più vecchi di **90 giorni**, dove
`raw_text` è il testo che qualcuno ha incollato e può contenere dati personali
di terzi ([ADR-0032](DECISIONS.md)); le notifiche più vecchie di **180
giorni**, che non contengono niente che il destinatario non potesse già vedere
ma riempiono una casella che nessuno apre; i contatori di rate limit la cui
finestra è passata, che non sono dati di nessuno
([ADR-0037](DECISIONS.md)). È idempotente, e la risposta dice quante righe
ha tolto per ciascuno.

Lo chiama la **stessa** GitHub Action del ricalcolo, come secondo passo: due
endpoint distinti, perché ricalcolare e cancellare sono cose diverse e un
endpoint che si chiama «ricalcola» non deve cancellare righe; un solo workflow,
perché aggiungere uno scheduler per un `curl` sarebbe il contrario di
[ADR-0013](DECISIONS.md). Il file si chiama ancora
`recompute-conflicts.yml` — rinominarlo perderebbe lo storico delle esecuzioni
su GitHub.

`POST /api/cron/digest` manda il riepilogo settimanale (§10). Lo schedula
`.github/workflows/digest.yml` il lunedì mattina — un workflow a parte, perché
la cadenza è diversa da quella notturna e un `if` sul giorno dentro un job è il
posto peggiore dove tenere una regola di calendario. **Rilanciarlo a mano è
innocuo:** la chiave di deduplica contiene l'etichetta ISO della settimana, e
la risposta lo dice (`ripetuti` maggiore di zero, `registrate` a zero).

`POST /api/cron/notify` fa le due cose che le notifiche devono fare ogni notte:
i solleciti sulle date opzionate che hanno superato la scadenza di annuncio, e
il **ritentativo delle email rimaste in coda**. Lo chiama la stessa Action
notturna, dopo `purge`.

### Le due strade degli avvisi

**Da questo prodotto partono messaggi per due vie diverse, che non si parlano.**
Confonderle costa un pomeriggio, perché il sintomo è identico — «non mi arriva
niente» — e i rimedi stanno in due posti che non si assomigliano.

| Cosa                                        | Lo manda        | Si configura                                                   | Serve a                       |
| ------------------------------------------- | --------------- | -------------------------------------------------------------- | ----------------------------- |
| **Magic link** di accesso                   | Supabase Auth   | pannello Supabase → _Project Settings → Authentication → SMTP_ | far **entrare** la gente      |
| **Notifiche**: conflitti, digest, solleciti | un bot Telegram | `TELEGRAM_BOT_TOKEN` (secret del Worker)                       | avvisare chi è **già dentro** |
| **Invito** a entrare                        | Supabase Auth   | lo stesso SMTP del magic link, più il template _Invite user_    | far entrare **la prima volta** |

Configurare l'SMTP su Supabase non fa arrivare nessuna notifica, e configurare
il bot non fa arrivare nessun magic link.

L'invito sta **sulla prima strada, non sulla seconda**: si rivolge a chi nel
calendario non esiste ancora, quindi non ha una chat collegata, ma un indirizzo
email sì — ed è lo stesso SMTP del magic link a portarcelo ([ADR-0045](DECISIONS.md)).
Se manca la `SUPABASE_SERVICE_ROLE_KEY` l'invito si genera lo stesso e il link si
passa a mano: la pagina che lo mostra dice quale dei due casi è capitato.

#### L'SMTP del magic link

Il servizio email integrato di Supabase ammette **pochissimi invii all'ora**: è
sufficiente per il primo accesso del manutentore e diventa un ostacolo appena
si prova a far entrare la seconda persona. Prima di invitare qualcuno va quindi
configurato un SMTP proprio, nel pannello Supabase.

Una casella Gmail personale funziona ed è il modo più rapido di partire, con tre
avvertenze che è meglio conoscere prima:

- serve una **App Password** di Google, non la password dell'account, e per
  generarla l'account deve avere la verifica in due passaggi attiva;
- il tetto è dell'ordine dei **500 messaggi al giorno**, e Google può rallentare
  o marcare gli invii automatici;
- il **mittente sarà un indirizzo personale**. Per un invito che arriva a un
  organizzatore che non ti conosce, un dominio del progetto fa un altro effetto.

Per i volumi di questo calendario — venti circoli, qualche accesso a settimana —
va bene. È una cosa da rifare il giorno in cui il prodotto smette di essere fra
conoscenti.

#### Perché le notifiche non passano per email

**Ci hanno provato, e non si può senza un dominio.** Mandare email a destinatari
arbitrari richiede SPF e DKIM, cioè due record DNS su un dominio proprio: non è
una politica di un fornitore, è il modo in cui oggi si dimostra di essere
autorizzati a scrivere a nome di qualcuno. Il mittente condiviso di Resend
consegna solo all'indirizzo con cui ci si registra; il piano gratuito di
Cloudflare Email Service solo a indirizzi verificati uno per uno.

Un bot Telegram non chiede domini né record DNS, e gli organizzatori quel canale
ce l'hanno già aperto. Da qui la scelta ([ADR-0039](DECISIONS.md)).

Vale per le **notifiche**. Per l'**invito** la conclusione è diversa e sta in
[ADR-0045](DECISIONS.md): lì il destinatario è uno solo, l'ha scelto chi invita,
e a spedire è Supabase con l'SMTP che manda già i magic link — nessun dominio da
verificare, perché il mittente è la casella del manutentore e non un indirizzo
del progetto.

Se un domani il dominio arriva, l'email torna possibile **anche per le
notifiche**, e ha senso accanto a Telegram e non al suo posto. Costa un file,
`sinks/`.

### Notifiche

Il layer (`src/lib/server/notifications/`) registra **sempre** una riga in
`notifications` e poi prova a consegnare. Le due colonne che contano sono
`consegna_richiesta` e `consegnata_at`: insieme fanno l'elenco delle consegne
dovute e mai riuscite, che `/api/cron/notify` ritenta per tre giorni
([ADR-0036](DECISIONS.md)).

Nessun nome cita il canale, ed è deliberato: in Fase 6 il canale è già cambiato
una volta.

#### Mettere in piedi il bot

1. Su Telegram, apri una chat con **@BotFather** e manda `/newbot`. Scegli un
   nome e uno username che finisca per `bot`.
2. BotFather risponde con un token tipo `8123456789:AAF…`. Va in `.env`, e in
   produzione fra i secret del Worker:

```
TELEGRAM_BOT_TOKEN=8123456789:AAF...
TELEGRAM_BOT_USERNAME=nome_del_bot
```

`TELEGRAM_BOT_USERNAME` serve solo a costruire il link «apri il bot» nelle
impostazioni: senza, il codice di collegamento si copia a mano e funziona
lo stesso.

**Non registrare un webhook su quel bot.** Il collegamento delle chat legge i
messaggi con `getUpdates`, e le due cose si escludono a vicenda
([ADR-0040](DECISIONS.md)).

#### Collegare una chat

Ogni iscritto lo fa una volta, da `/settings/notifications`: preme «Collega
Telegram», apre il bot dal link, preme Avvia, torna e conferma. Il codice vale
mezz'ora.

**Chi non collega la chat non riceve niente fuori dall'applicazione**, e non è
un guasto da riparare: è la condizione predefinita di chiunque non abbia fatto
nulla. Gli avvisi restano nella casella. Il sink salta quei profili senza
segnarli fra i falliti, altrimenti la corsa notturna ritenterebbe per tre
giorni una consegna che non può riuscire.

#### Quando «non mi arriva niente»

In quest'ordine:

```sql
-- 1. La riga è stata scritta? Se no, il problema è a monte del layer.
select kind, created_at, consegna_richiesta, consegnata_at, errore_consegna
from notifications where profile_id = '...' order by created_at desc limit 20;

-- 2. La chat è collegata, e quell'avviso è acceso?
select telegram_chat_id, avvisa_conflitti, avvisa_digest, avvisa_solleciti
from notification_prefs where profile_id = '...';
```

- `telegram_chat_id` a `NULL` → non ha collegato la chat. È il caso più comune.
- `consegna_richiesta` a `false` con le preferenze accese → quel genere di
  avviso non esce comunque: il conflitto **risolto** resta in pagina e basta.
- `errore_consegna` valorizzato → la descrizione arriva da Telegram ed è quasi
  sempre leggibile. `bot was blocked by the user` significa che quella persona
  ha bloccato il bot, e non c'è niente da sistemare lato server.

E un caso che **non è un guasto**: un conflitto si racconta a un'organizzazione
solo nella misura in cui il dato che lo produce le è già visibile. Se una band è
in cartellone da entrambe ma l'ha annunciata una sola, all'organizzazione che
l'ha annunciata non arriva niente, perché riceverlo le direbbe che la
controparte l'ha ingaggiata ([ADR-0035](DECISIONS.md)).

### Il registro e la metrica

`/audit` mostra chi ha cambiato cosa nelle proprie organizzazioni, e sopra il
registro la **metrica di successo** di `ARCHITECTURE.md` §1: la quota di date
che passano da `hold` prima di arrivare a `confirmed`. È la cifra che dice se
il prodotto sta facendo il suo lavoro o se è diventato un archivio di annunci
già fatti — che è un uso legittimo, ma non quello per cui è stato costruito. Se
la seconda cifra prevale, l'assunzione di [ADR-0023](DECISIONS.md) è
sbagliata e va riaperta.

Il registro lo vede **solo la propria organizzazione**, platform admin
compreso: conserva i valori precedenti dei campi, titolo incluso, e mostrarlo
altrove racconterebbe il titolo che una data aveva quando era ancora opzionata.

### Rate limit

Tre endpoint hanno un limite, e sono contati in due modi diversi perché due di
loro non avevano niente da contare:

| Endpoint           | Limite                 | Contato da               |
| ------------------ | ---------------------- | ------------------------ |
| `/api/parse`       | 20 all'ora per profilo | le righe di `parse_jobs` |
| `/api/geocode`     | 60 all'ora per profilo | la tabella `rate_limits` |
| `/api/ics/[token]` | 24 all'ora per token   | la tabella `rate_limits` |

La finestra è fissa di un'ora e sta dentro la chiave (`risorsa:identità:inizio`).
Le righe scadute le porta via `/api/cron/purge`
([ADR-0037](DECISIONS.md)).

Due comportamenti da conoscere prima di dare la colpa al limite:

- **se il contatore non risponde, si lascia passare.** Un limite mancato è un
  rischio più piccolo di un feed sottoscritto che smette di aggiornarsi perché
  una tabella accessoria ha un problema;
- **il feed rifiutato risponde 429, mai un 200 vuoto.** Un calendario vuoto
  servito a Google cancella tutte le date già importate.

Per vedere chi sta consumando cosa:

```sql
select bucket, hits from rate_limits order by hits desc limit 20;
```

### PWA

Il manifest è `static/manifest.webmanifest`, le icone stanno in `static/icons/`
e si rigenerano con:

```bash
node scripts/genera-icone.mjs
```

Lo script non ha dipendenze e scrive i PNG a mano: un binario committato senza
il modo di rifarlo è un file che nessuno osa toccare.

Il service worker è `src/service-worker.ts` e SvelteKit lo registra da sé nella
build di produzione — **in sviluppo non gira**, quindi il guscio offline si
prova solo su una build servita in HTTPS.

**La regola che conta è una sola: qui dentro non va in cache nessuna risposta
che contenga dati di dominio.** Una cache nel browser è l'unico posto
dell'architettura dove una risposta sopravvive al contesto che l'ha prodotta, e
quel contesto è ciò su cui si regge tutta la matrice di visibilità. In cache ci
va solo ciò che è uguale per tutti: i file della build, gli asset di `static/`
e la pagina `/offline`. Se un giorno servisse far funzionare qualcosa senza
rete, la risposta non è allargare questa lista.

La PWA è anche l'unico contesto in cui il layout mobile non è un ripiego ma
l'unica cosa che si vede: sta in `MobileHeader.svelte` e `MobileTabBar.svelte`,
e la barra in basso riserva `env(safe-area-inset-bottom)` sotto di sé. Oggi
quel valore è 0, perché il viewport non è `viewport-fit=cover`: è scritto per il
giorno in cui lo diventasse, e nel frattempo non costa niente
([ADR-0042](DECISIONS.md)).

### Informativa privacy

Sta in `src/routes/privacy/+page.svelte`, fuori dal gruppo `(app)` perché va
letta **prima** di digitare la propria email nel form di accesso. Il titolare è
il manutentore a titolo personale ([ADR-0043](DECISIONS.md)).

**È una pagina che invecchia in silenzio**, e sono tre le modifiche che la
rendono falsa senza rompere niente:

1. **Cambiare una scadenza di conservazione.** La pagina dichiara novanta giorni
   per il testo incollato e centottanta per gli avvisi, che sono
   `GIORNI_CONSERVAZIONE` in `parse/retention.ts` e
   `GIORNI_CONSERVAZIONE_NOTIFICHE` in `notifications/service.ts`. Toccare una
   costante senza toccare la pagina significa dichiarare una conservazione
   diversa da quella applicata.
2. **Aggiungere un fornitore che vede dati personali.** Va aggiunta una riga alla
   tabella dei fornitori, e va aggiunta **prima** di attivarlo. Il caso già
   scritto è il modello linguistico dell'import da testo libero: la pagina lo
   dichiara come non attivo, perché `LLM_API_KEY` non è configurata in
   produzione. Configurarla senza aggiornare la pagina manda testo di terzi a un
   fornitore non dichiarato.
3. **Cominciare a leggere l'indirizzo IP.** Oggi la pagina afferma che non lo
   facciamo, ed è vero: `getClientAddress()` non compare da nessuna parte, e i
   contatori di rate limit usano l'identificativo del profilo o del token. È
   un'affermazione forte e va difesa.

Le richieste degli interessati arrivano all'indirizzo pubblicato nella pagina e
vanno evase entro un mese. Per l'accesso e la portabilità l'applicazione fa già
quasi tutto: `/api/export?format=json|csv` restituisce ciò che quel profilo può
vedere.

### Riprodurre in locale un difetto che si vede solo in produzione

`npm run dev` gira su Node. Il Worker gira su **workerd**, che ha regole
diverse — la più importante: un socket aperto nel contesto di una richiesta non
è utilizzabile da un'altra. Sei fasi di sviluppo su Node non hanno mai potuto
vedere quel vincolo, e al primo deploy l'applicazione rispondeva un 500 sì e
uno no ([ADR-0041](DECISIONS.md)).

**`wrangler dev` esegue lo stesso runtime in locale**, e riproduce quella
classe di guasti senza deployare niente.

Serve un file `.dev.vars` accanto a `.env` — stesse variabili, sintassi
`CHIAVE="valore"`. È in `.gitignore` per la stessa ragione di `.env`.

```bash
npm run build
npx wrangler dev --port 8787
```

Due avvertenze che costano un'ora se non si conoscono.

**Usa `http://localhost`, non `http://127.0.0.1`.** I cookie di sessione di
Supabase sono `Secure`: il browser li manda comunque a `localhost`, ma il
contesto di richiesta di Playwright su `127.0.0.1` no, e ogni chiamata
autenticata dei test torna `401`. È un artefatto del banco di prova, non un
difetto del prodotto — in produzione è tutto HTTPS.

**Il guasto delle connessioni si vede solo a raffica.** Una richiesta isolata
passa sempre: è la seconda, sulla stessa istanza, a trovare il socket della
prima. Il modo per farlo saltare fuori è ripetere:

```bash
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code} " -X POST \
    -H "x-cron-secret: $CRON_SECRET" -H 'content-length: 0' \
    http://localhost:8787/api/cron/notify
done
```

Otto `200` vanno bene. Un `200 500 200 500` alternato è quel difetto.

La suite E2E si può puntare lì contro, ed è la verifica più completa che si
possa fare prima di un rilascio:

```bash
E2E_BASE_URL=http://localhost:8787 npm run test:e2e
```

### Smoke test end-to-end

```bash
npm run test:e2e
```

**Girano contro il database vero** e contro un dev server vero: non c'è un
ambiente di prova separato, e crearne uno costerebbe un secondo progetto
Supabase da migrare e seminare a ogni cambio di schema
([ADR-0038](DECISIONS.md)).

Tutto ciò che creano ha il prefisso `e2e-` e viene rimosso da un progetto di
`teardown` di Playwright, **anche quando i test falliscono**. Per controllare
che non sia rimasto niente:

```sql
select count(*) from organizations where slug like 'e2e-%';
select count(*) from profiles where email like 'e2e-%';
```

Servono in `.env` la `SUPABASE_SERVICE_ROLE_KEY` — con quella si creano gli
utenti di prova e si generano i loro token di accesso — e `DATABASE_URL`. Senza,
i test si fermano dicendolo.

**Non girano in CI**, ed è deliberato: metterceli vorrebbe dire mettere la
chiave di servizio fra i secret del repository. Vanno lanciati **prima di un
rilascio**, non a ogni commit.

Se falliscono con uno screenshot di un modulo vuoto, la causa è quasi sempre
l'idratazione: riempire i campi subito dopo il caricamento non funziona, perché
Svelte rimette a ogni input il valore della sua prop. L'helper `apri()` in
`smoke.spec.ts` esiste per questo.

### Paste-to-parse

`POST /api/parse` legge un testo incollato e restituisce **valori da mettere
nel form**. Non scrive nessun evento: l'unica scrittura possibile è la riga di
registro in `parse_jobs`.

Tre strade, scelte da `sniff.ts` prima di ogni altra cosa:

| Incollato                     | Come viene letto                 | Costa               |
| ----------------------------- | -------------------------------- | ------------------- |
| `BEGIN:VCALENDAR…`            | parser `.ics` deterministico     | zero                |
| Tabella con intestazioni note | parser CSV deterministico        | zero                |
| Tutto il resto                | Claude Haiku 4.5, schema forzato | ~0,001 € a chiamata |

**Senza `LLM_API_KEY` le prime due strade funzionano lo stesso.** Il pannello
lo dice invece di offrire un pulsante che non risponde: sono indipendenti, e
una configurazione mancante non deve spegnere ciò che non ne ha bisogno.

Il limite è di **20 riconoscimenti a modello per profilo all'ora**, contato da
`parse_jobs` e non da un contatore in memoria — su Cloudflare gli isolate vanno
e vengono, e un limite che si azzera a ogni risveglio non è un limite. Le due
strade deterministiche non entrano nel conteggio perché non costano niente.

**Se un'estrazione è andata male**, il testo di partenza è in `parse_jobs`
accanto al risultato, per novanta giorni:

```bash
npm run db:studio
```

Il primo rimedio è `LLM_MODEL`, non il codice; il secondo è il prompt, che sta
in `src/lib/server/parse/prompt.ts` senza I/O apposta per poterlo leggere e
provare da solo.

**Quello che il parser non fa, e non è un difetto**
([ADR-0031](DECISIONS.md)): non decide lo stato — la data nasce sempre in
bozza — non marca nessuna band come annunciata, e non collega nessuna riga di
lineup all'anagrafica. Le band riconosciute compaiono come proposte accanto
alla riga, con un pulsante per accettarle. Un `artistId` sbagliato non si
vedrebbe rivedendo il form, perché il nome resterebbe quello giusto, e
falserebbe la regola R2 del motore conflitti.

Un `.ics` con quaranta date, o un CSV con quaranta righe, producono **una**
data: la prima. Il totale viene detto ([ADR-0033](DECISIONS.md)).

### Feed ICS

`GET /api/ics/[token].ics` è **l'unico endpoint pubblico che restituisce dati
di dominio**, ed è pubblico per un motivo che non si può aggirare: nessun
client calendario sa fare login. L'autenticazione è il token nell'URL.

Il feed contiene esattamente ciò che vedrebbe il profilo che lo possiede, mai
un campo di più: è redatto da `serializeEvent()` come qualunque altra uscita.
Le bozze non ci sono in nessun caso ([ADR-0029](DECISIONS.md)).

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
il numero si deriva da lì ([ADR-0028](DECISIONS.md)). È il guasto più
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
calendario: il feed è in sola lettura ([ADR-0011](DECISIONS.md)) e i due
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

### La build o il deploy si fermano dicendo «Stai lavorando da un percorso che è un collegamento»

È un controllo del progetto, non un guasto. Rilancia da dove ti dice:

```powershell
cd C:Users<tu>DocumentsMusicCalendarOverlap
```

Su Windows in italiano `C:Users<tu>Documenti` è una **giunzione di
sistema** che punta a `Documents`. Non è un alias innocuo: Windows le mette una
ACL che **nega l'elenco del contenuto** e lascia solo la traversata. Un percorso
che ci passa dentro apre i file e fallisce appena qualcuno prova a leggere la
cartella.

Senza il controllo si presenta in due modi, in due punti diversi della catena:

```
Could not find file "../../Documenti/…/node_modules/@sveltejs/kit/…" in Vite manifest
```

```
X [ERROR] Cannot read directory "../../Documenti": Accesso negato.
```

Il primo è `vite build`: le chiavi del manifest sono percorsi relativi alla
radice, e con la radice a `Documenti` e i moduli sotto `Documents` quel
percorso risale con `../..` e non corrisponde a niente. Il secondo è
`wrangler deploy`, che prova a leggere quella cartella e viene respinto.

**Perché non capita a tutti**: il `cd` di PowerShell conserva il nome con cui ti
sei spostato e lo passa ai processi figli, Git Bash consegna a Node il percorso
fisico. Stesso comando, stessa cartella, due esiti.

C'è stato un tentativo di aggiustarlo dall'interno con un `process.chdir()` in
`vite.config.ts`. **Era peggio del problema**: gli `import` dei moduli girano
prima, SvelteKit aveva già letto la cwd vecchia, e il risultato era una build
che passava e produceva un artefatto con dentro percorsi illeggibili — cioè il
guasto spostato al deploy, dove costa di più. Ora ci si ferma e basta:
`scripts/controlla-cartella.mjs`.

### `npm run build` fallisce con EPERM su `.svelte-kit/cloudflare`

```
error during build:
Error: EPERM, Permission denied: ....svelte-kitcloudflare
```

Il bundle in realtà è stato prodotto — la riga `✓ built` compare poco sopra.
A fallire è la **pulizia** della cartella di output dell'adapter Cloudflare, che
la rimuove prima di riscriverla.

Causa: **qualcuno sta guardando `.svelte-kit`**, e su Windows una cartella
osservata non si cancella. I due sospetti, in quest'ordine:

- **il dev server acceso.** Vite tiene aperti dei descrittori su quella
  cartella. Ferma `npm run dev` e rilancia;
- **l'editor con il progetto aperto.** Il TypeScript server di VS Code o Cursor
  indicizza i file appena scritti, e con la cartella prodotta un attimo prima
  fa in tempo a trattenerla. Questo caso è **transitorio**: rilanciare la build
  di solito basta.

Se torna, la via sicura è toglierla di mezzo a mano prima di ricompilare:

```powershell
Remove-Item -Recurse -Force .svelte-kitcloudflare
npm run build
```

Su Linux e macOS lo stesso comando passa, quindi in CI non si vede: è un
inciampo solo locale, ma capita esattamente nel momento peggiore, cioè quando
si prova a fare un deploy di fretta.

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
> col pooler in transaction mode: vedi [ADR-0026](DECISIONS.md), il pool
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

La causa nota è `max: 1` col pooler in transaction mode ([ADR-0026](DECISIONS.md)),
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
- Due regole di `src/app.css` stanno **fuori da ogni `@layer`**, ed è
  deliberato: nella cascata degli strati ciò che non sta in nessuno vince su
  ciò che sta dentro uno, utility di Tailwind comprese. Sono i bersagli da 44px
  sotto `pointer: coarse` e i campi a 16px sotto 640px, e servono proprio a
  battere un `h-8` o un `text-sm` scritti in pagina. Spostarle in `@layer base`
  per ordine le renderebbe **inerti senza rompere niente di visibile**: è il
  motivo per cui il commento accanto è lungo (ADR-0042).
- L'elenco delle voci di navigazione è **uno solo**, in
  `src/routes/(app)/+layout.svelte`, e le due barre ne prendono fette diverse:
  intera in alto sopra `md:`, quattro voci in basso e il resto dietro il `☰`
  sotto. Tenerne due significherebbe aggiungere una rotta e scoprire un mese
  dopo che sul telefono non c'è.
- Il pannello laterale del telefono è un `<details>`, non un `<dialog>`: si apre
  **senza JavaScript**. È l'unica strada verso «Esci» e le anagrafiche, e la
  barra da desktop sul telefono è `display:none` — un pannello che dipendesse
  dall'idratazione, dopo un'idratazione fallita, chiuderebbe fuori da tutto.
- La configurazione SvelteKit sta in `vite.config.ts`, non in un
  `svelte.config.js`: è la convenzione dello scaffolding corrente. Alcuni
  strumenti di terze parti cercano ancora `svelte.config.js` — se serve, si
  aggiunge un file minimale senza spostare la configurazione.
