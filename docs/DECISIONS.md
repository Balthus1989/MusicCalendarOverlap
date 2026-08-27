# Registro delle Decisioni

Storico delle decisioni architetturali del progetto. Ogni voce spiega **perché**, non solo cosa: fra sei mesi il "cosa" si legge dal codice, il "perché" no.

**Convenzioni**

- Le decisioni sono numerate progressivamente e **non si cancellano mai**. Se una decisione viene ribaltata, si marca come `Superata da ADR-XXXX` e si scrive una nuova voce.
- Stati: `Accettata` · `Superata` · `Rifiutata` · `Provvisoria` (da riconfermare a una certa fase)
- Va aggiornato **nello stesso commit** che implementa la decisione, non dopo.
- Se una decisione emerge durante una sessione di Claude Code, va scritta qui prima di chiudere la sessione.

---

## ADR-0001 — TypeScript full-stack invece di Python/FastAPI

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Il manutentore ha un background Python (data science) e la preferenza iniziale era FastAPI con frontend separato. Il progetto è però al 90% UI e CRUD: l'unica logica non banale è il rilevamento conflitti, che sono poche decine di righe in qualsiasi linguaggio. Nessun carico di ML, nessuna dipendenza dall'ecosistema scientifico.

**Decisione.** SvelteKit 2 + TypeScript come monolite full-stack.

**Motivazioni.**

- Uno schema invece di due: Zod + Drizzle danno validazione client, server e tipi DB da un'unica definizione. Su un form da 30+ campi con lineup dinamica è la differenza più concreta.
- Un deploy invece di due: nessun CORS, nessuna sincronizzazione di contratto tra due progetti.
- Il free tier per JS su Cloudflare/Vercel è reale; per Python persistente richiede compromessi (cold start di 30-60s su Render, free tier chiuso su Railway).
- Lo sviluppo è delegato a Claude Code: la familiarità personale con Python pesa meno del solito, mentre la densità di pattern consolidati dell'ecosistema SvelteKit/Drizzle migliora l'affidabilità dell'agente.

**Alternative scartate.**

- _FastAPI + React separati_: preferenza personale del manutentore, ma raddoppia i punti di rottura senza benefici sul dominio.
- _Next.js_: equivalente e con ancora più materiale di training per gli agenti. SvelteKit scelto per minor cerimonia e bundle più leggero. Se emergessero problemi di affidabilità dell'agente, Next.js è il fallback naturale.

**Conseguenze.** Il manutentore lavora su uno stack che conosce meno: il debugging autonomo è più lento. Mitigazione: test unitari fitti sulle parti di dominio, dove i bug sono costosi.

**Da rivedere se.** Il progetto acquisisce carichi analitici veri (clustering geografico delle date, previsioni di saturazione). In quel caso l'analisi si fa comunque su dati esportati in notebook, non spostando il backend.

---

## ADR-0002 — Supabase come database, auth e storage

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Vincolo di budget: solo free tier. Serve Postgres, autenticazione e storage per le locandine.

**Decisione.** Supabase free tier, in una region dell'Unione Europea. Auth con magic link.

> **Precisazione (2026-08-19).** La stesura originale diceva "Frankfurt". Il vincolo che conta è **l'hosting nell'UE**, non il datacenter specifico: il progetto reale è su `eu-west-3` (Parigi) e soddisfa la decisione allo stesso modo. La region **non è modificabile dopo la creazione del progetto**: va verificata prima di caricare dati.

**Motivazioni.** È Postgres standard, non un'astrazione proprietaria: la migrazione altrove è un `pg_dump`. Scrivere l'autenticazione a mano sarebbe stato il rischio più alto del progetto (sessioni, reset password, enumeration) per zero valore di dominio. Hosting EU semplifica la posizione GDPR.

**Conseguenze.**

- In ambiente serverless serve il pooler Supavisor (porta 6543, transaction mode, `prepare: false`). Le migrazioni girano sulla connessione diretta (5432).
- Il free tier **non garantisce backup utilizzabili**: `pg_dump` settimanale via GitHub Actions è obbligatorio, in Fase 0.
- L'unico componente non banalmente sostituibile è Supabase Auth. Accettato: è sostituibile con lavoro contenuto se necessario.

---

## ADR-0003 — Il browser non accede mai direttamente al database

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Supabase permetterebbe query dirette dal client con RLS come guardia. Il modello di visibilità di questo prodotto (ADR-0005) è però più articolato di ciò che si esprime comodamente in policy RLS: richiede **redazione parziale dei campi**, non solo permesso/negato per riga.

**Decisione.** Solo l'autenticazione passa dal client. Tutti i dati di dominio passano dal server SvelteKit. RLS abilitata con policy `deny all` su tutte le tabelle come difesa in profondità.

**Motivazioni.** Un unico punto in cui la logica di visibilità è implementata e testabile. RLS resta attiva così che un eventuale leak della chiave anon sia innocuo.

**Conseguenze.** Nessuna sottoscrizione realtime lato client senza lavoro aggiuntivo. Accettato: non serve a questo prodotto.

---

## ADR-0004 — Registrazione solo su invito

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Serviva un modo per garantire che chi si iscrive rappresenti realmente l'organizzazione che dichiara. Le opzioni erano: iscrizione aperta con verifica manuale, verifica via dominio email, o invito.

**Decisione.** Codici di invito generati dai platform admin. Un invito può creare una nuova organizzazione o aggiungere un membro a una esistente.

**Motivazioni.** Con meno di 20 organizzazioni in un contesto di alta fiducia, l'invito risolve il problema di verifica a costo zero e non richiede moderazione continua. La verifica via dominio email non è praticabile: le associazioni usano in larga parte Gmail.

**Da rivedere se.** Il calendario cresce oltre la cerchia di conoscenza diretta. A quel punto serve un flusso di richiesta con approvazione e, probabilmente, un ruolo di moderatore.

---

## ADR-0005 — Stato `hold` con visibilità ridotta

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** La decisione più importante del prodotto. Nessun organizzatore carica una lineup non annunciata su un calendario che vedono i concorrenti: il rischio è farsi bruciare l'annuncio o l'esclusiva. Ma se le date si caricano solo _dopo_ l'annuncio, il rilevamento conflitti arriva quando è troppo tardi e il prodotto è inutile.

**Decisione.** Quattro stati: `draft` (privato all'organizzazione), `hold` (visibile alle altre solo come giorno + città/provincia + genere primario + organizzazione e contatto), `confirmed` (tutto visibile), `cancelled` (visibile, con badge). Matrice completa in `ARCHITECTURE.md` §5, implementata da `serializeEvent()` e coperta da un test per cella.

**Motivazioni.** È il minimo che fa scattare la telefonata tra due organizzatori senza rivelare informazione commercialmente sensibile.

**Conseguenze.** Ogni feature che espone dati eventi — calendario, dettaglio, feed ICS, export, email di notifica, messaggi di conflitto — deve passare dal serializzatore. È un vincolo permanente, non una fase.

**Rischio noto.** La regola di conflitto sugli artisti può rivelare indirettamente una lineup in `hold` (vedi ADR-0009).

**Da rivedere se.** Gli organizzatori non si fidano nemmeno di così. In tal caso l'unica opzione ulteriore sarebbe nascondere anche la data, che però svuoterebbe il senso del calendario: sarebbe il segnale che il problema è di fiducia tra le persone, non di software.

---

## ADR-0006 — Artisti e venue come entità globali condivise

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Le band potevano essere testo libero per evento (semplice, zero manutenzione) oppure entità in anagrafica condivisa (più potente, ma con problema duplicati).

**Decisione.** Anagrafica condivisa per artisti e venue. Deduplicazione via MusicBrainz ID quando disponibile, con autocomplete da MusicBrainz in fase di inserimento, più indice unico su nome normalizzato per i casi senza MBID. La lineup ammette `artist_name_raw` per band non ancora in anagrafica e per "TBA".

**Motivazioni.** Senza entità artista non si può implementare il rilevamento di sovrapposizione band (ADR-0009), che è uno dei conflitti più rilevanti nella pratica. In più l'anagrafica diventa un bene comune del gruppo: contatti booking, link, generi.

**Conseguenze.** Serve curation minima contro i duplicati. Il flag `is_verified` esiste per questo. Se emergono duplicati in quantità, servirà un ruolo di moderatore e uno strumento di merge — non previsto in v1.

> **Aggiornamento (2026-08-19).** Il ruolo di moderatore è stato anticipato alla v1: vedi [ADR-0016](#adr-0016--il-ruolo-moderator-esiste-dalla-v1-ed-è-trasversale-alle-organizzazioni). Lo strumento di merge resta fuori dalla v1, come scritto qui.

---

## ADR-0007 — Tassonomia generi chiusa e gerarchica

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Tag liberi (flessibili, ma inutilizzabili in logica) contro tassonomia chiusa (rigida, ma computabile).

**Decisione.** Tassonomia gerarchica chiusa, gestita solo dai platform admin, con `path` materializzato (`metal.death-metal.tech-death`) e `parent_id`.

**Motivazioni.** Il genere entra direttamente nel calcolo dei conflitti tramite l'affinità basata su prefisso comune. Con tag liberi, "death metal" e "Death Metal " sarebbero generi diversi e la regola R3 non funzionerebbe.

**Perché `path` materializzato e non `ltree`.** Nessuna extension Postgres da installare, portabilità totale, prefix matching con un indice `text_pattern_ops`. La tassonomia cambia raramente: non serve ottimizzare la scrittura.

**Conseguenze.** Aggiungere un sottogenere richiede un intervento admin. Accettabile: il seed iniziale copre i generi rilevanti e le richieste saranno rare.

---

## ADR-0008 — Nessun PostGIS: lat/lon denormalizzati sugli eventi

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** I conflitti richiedono calcoli di distanza. PostGIS sarebbe la soluzione canonica.

**Decisione.** Colonne `lat`/`lon` in doppia precisione su `venues` **e su `events`**. Prefiltro con bounding box in SQL, poi haversine esatto in codice.

**Motivazioni.**

- Con qualche migliaio di eventi la differenza di prestazioni è irrilevante.
- La denormalizzazione su `events` è **necessaria**, non un'ottimizzazione: un evento in `hold` può non avere ancora un venue, ma la città è nota e il conflitto geografico va calcolato comunque.
- Meno superficie di dipendenza, e il codice haversine è testabile in isolamento.

**Conseguenze.** `events.lat`/`lon` va risincronizzato quando cambia il venue o la città. Va fatto nel medesimo punto di scrittura, non con un trigger nascosto.

---

## ADR-0009 — Conflitti persistiti, warning non bloccanti

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** I conflitti potevano essere calcolati a volo a ogni visualizzazione, oppure persistiti. E potevano bloccare il salvataggio o solo avvisare.

**Decisione.** Tabella `conflicts` con stato (`open`/`acknowledged`/`resolved`/`dismissed`) e ricalcolo con riconciliazione a ogni modifica rilevante. I conflitti risolti non vengono cancellati. I warning **non bloccano mai** il salvataggio.

**Motivazioni.**

- La persistenza serve per notifiche, dashboard, e per ricordare che due organizzatori si sono già parlati di quella data: senza storico, l'alert riappare in eterno.
- Il non-blocco è una scelta di prodotto: lo strumento serve a informare due pari, non a dare a uno il potere di veto sull'altro. Un blocco farebbe abbandonare lo strumento.

**Rischio noto — leak informativo.** La regola sugli artisti condivisi (R2) può rivelare una lineup in `hold`: dire "conflitto con gli Opeth" espone esattamente ciò che ADR-0005 protegge. Il messaggio deve restare anonimo sulla band quando la controparte è in `hold`. È un caso di test obbligatorio, non una raccomandazione.

---

## ADR-0010 — Nessun import da Facebook/Instagram: paste-to-parse

**Data:** 2026-08-19 · **Stato:** Accettata — riconfermata il 2026-08-24, vedi [ADR-0030](#adr-0030--le-api-meta-riverificate-limport-da-facebook-e-instagram-continua-a-non-esistere)

**Contesto.** L'import da FB/IG era un requisito iniziale esplicito. Meta ha però deprecato la lettura pubblica degli eventi delle Pagine e Instagram non modella affatto il concetto di evento. Lo scraping è fragile e contro i ToS.

**Decisione.** L'utente incolla il testo del post, un LLM lo struttura secondo lo schema Zod del form, il risultato **pre-compila il form** senza mai creare l'evento automaticamente. In parallelo, import deterministico da ICS e CSV, da preferire quando la fonte lo permette.

**Motivazioni.** Copre il bisogno reale (non ridigitare tutto) senza dipendere da un'API che non esiste e senza costruire uno scraper che si rompe di sabato sera.

**Conseguenze.** Unico costo variabile del progetto: trascurabile a questi volumi (ordine di 1-2 € l'anno con un modello economico). Il fallimento del parser non blocca mai l'inserimento manuale.

**Perché era provvisoria.** Lo stato delle API Meta andava riconfermato al momento dell'implementazione, non dato per assodato sulla base di questa nota.

> **Riconferma (2026-08-24, Fase 5).** Fatta, e la conclusione regge — con una motivazione un po' diversa da quella scritta qui: non è una deprecazione, è che leggere gli eventi di Utenti e Pagine è riservato ai Facebook Marketing Partner. Su Instagram non c'era niente da riverificare, perché non esiste un oggetto evento da leggere. Vedi [ADR-0030](#adr-0030--le-api-meta-riverificate-limport-da-facebook-e-instagram-continua-a-non-esistere), che chiude anche il punto aperto #5 di `ARCHITECTURE.md` §17.

---

## ADR-0011 — Feed ICS in sola lettura, nessun sync bidirezionale

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** L'integrazione con Google Calendar e Apple Calendar poteva essere sync bidirezionale via OAuth, oppure feed ICS sottoscrivibile.

**Decisione.** Feed ICS con token segreto nell'URL, filtrabile, con `REFRESH-INTERVAL`, `SEQUENCE` incrementale e `STATUS` mappato sugli stati evento. Più download ICS singolo e link "aggiungi al calendario".

**Motivazioni.** Copre praticamente tutto il bisogno reale con una frazione del lavoro: un endpoint contro OAuth, refresh token, webhook e gestione delle revoche. Funziona su Google, Apple e Outlook senza codice specifico per piattaforma.

**Conseguenze.**

- Il token è un segreto in un URL su endpoint pubblico (i client calendario non fanno login): il contenuto del feed **deve** passare dal serializzatore di visibilità, il token deve essere revocabile, la risposta non indicizzabile.
- `SEQUENCE` va incrementato a ogni modifica, altrimenti Google non aggiorna mai l'evento. È l'errore classico di questa integrazione.

---

## ADR-0012 — Nessuna pubblicazione automatica sui social

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Requisito iniziale: esportare gli eventi per pubblicarli su altre piattaforme social.

**Decisione.** Generatore di copy pre-formattato per piattaforma (testo, lineup, orari, prezzi, hashtag dai generi, link), da copiare a mano. Più export JSON, CSV e JSON-LD `schema.org/MusicEvent`.

**Motivazioni.** La creazione programmatica di eventi su Meta non è disponibile. Questa è la sostituzione onesta: elimina il lavoro di riscrittura, che è il vero costo, senza promettere un'automazione impossibile.

---

## ADR-0013 — Monolite, nessuna coda, nessun servizio accessorio

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** Ricalcolo conflitti, invio email e parsing LLM sono candidati naturali a un worker asincrono.

**Decisione.** Tutto sincrono nel monolite. I job periodici (ricalcolo notturno, digest settimanale) sono GitHub Actions schedulati che chiamano endpoint protetti da secret.

**Motivazioni.** Un manutentore part-time, meno di 20 organizzazioni. Redis, Celery o una coda gestita aggiungerebbero un servizio da monitorare e pagare per carichi che si misurano in decine di operazioni al giorno. GitHub Actions come scheduler è gratuito e non richiede processi attivi.

**Da rivedere se.** Il parsing LLM in linea inizia a superare i limiti di CPU per richiesta di Cloudflare Workers. Prima soluzione: spostare solo quell'endpoint, non l'architettura.

---

## ADR-0014 — Fuori scope dichiarato per la v1

**Data:** 2026-08-19 · **Stato:** Accettata

Elencati qui perché "non farlo" è una decisione, e va ricordato che è stata presa consapevolmente: sync bidirezionale con i calendari, pubblicazione automatica sui social, scraping di qualunque piattaforma, vista pubblica per il pubblico dei concerti, biglietteria e pagamenti, gestione ospitalità e rider, app nativa, multilingua, notifiche push.

La vista pubblica è la più probabile candidata alla v2: il serializzatore di visibilità esiste già, servirebbe una rotta read-only.

---

## ADR-0015 — Lo schema `auth` di Supabase è dichiarato in Drizzle, ma la sua creazione è saltata in migrazione

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** `profiles.id` è una foreign key verso `auth.users.id`, tabella creata e gestita da Supabase. Perché Drizzle possa esprimere quella foreign key, `auth.users` va dichiarata nello schema TypeScript. Ma `drizzle-kit generate` non distingue fra "tabella che possiedo" e "tabella che referenzio": emette un `CREATE TABLE "auth"."users"` che su Supabase fallirebbe, perché quella tabella esiste già. `schemaFilter: ['public']` non risolve: agisce sull'introspezione, non sulla generazione.

**Decisione.** Si dichiara `auth.users` come `pgSchema('auth').table(...)` con la sola colonna `id`, e nella migrazione si sostituisce a mano la creazione con un blocco che la **salta del tutto** quando la tabella esiste:

```sql
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
	) THEN
		CREATE SCHEMA IF NOT EXISTS "auth";
		CREATE TABLE "auth"."users" ("id" uuid PRIMARY KEY NOT NULL);
	END IF;
END $$;
```

> **Correzione (2026-08-19, alla prima applicazione reale).** La stesura originale di questo ADR usava `CREATE TABLE IF NOT EXISTS "auth"."users"`, dando per scontato che su Supabase fosse un no-op. Non lo è: lo schema `auth` appartiene a `supabase_auth_admin`, non al ruolo `postgres` con cui girano le migrazioni, e `IF NOT EXISTS` **verifica comunque il permesso di creazione** prima di accorgersi che la tabella c'è già. Il risultato era `42501 permission denied for schema auth`, con drizzle-kit che faceva rollback **senza stampare l'errore**: il database restava vuoto e il comando sembrava non fare nulla. Serve un salto esplicito, non l'idempotenza.

**Motivazioni.** Su Supabase il blocco non esegue nulla e la migrazione passa. Su un Postgres vuoto — un database di scarto per provare un ripristino, o un'istanza locale — la foreign key resta creabile invece di far fallire l'intera catena di migrazioni. L'alternativa, rinunciare al `.references()` e scrivere il vincolo in SQL grezzo, toglierebbe a Drizzle la conoscenza della relazione senza guadagnare nulla.

**Alternative scartate.**

- _Nessuna foreign key verso `auth.users`_: l'integrità fra profilo e utente è esattamente ciò che rende `profiles` uno specchio affidabile. Rinunciarvi significherebbe accettare profili orfani.
- _Migrazione scritta interamente a mano_: perde il vantaggio principale di Drizzle, cioè lo schema come unica fonte di verità.

**Conseguenze.** Il blocco va **ricontrollato a ogni `npm run db:generate`**: drizzle-kit può riemettere la creazione non condizionata, e la migrazione si scoprirebbe rotta solo al deploy. È annotato nel file di migrazione e nel [runbook](RUNBOOK.md). Vale solo per la prima migrazione: dallo snapshot in poi la tabella risulta già esistente.

**Da rivedere se.** Drizzle introduce un modo esplicito di marcare una tabella come "esterna, non gestita". A quel punto la nota va rimossa e la dichiarazione semplificata.

---

## ADR-0016 — Il ruolo `moderator` esiste dalla v1, ed è trasversale alle organizzazioni

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** ADR-0006 rende artisti e venue **anagrafiche condivise**, e prevede che serva "un ruolo di moderatore e uno strumento di merge" quando i doppioni si accumulano, rimandandolo fuori dalla v1. La questione era però anche la decisione aperta #3 del registro, in scadenza in Fase 1 — cioè adesso, perché è in Fase 1 che si scrive l'enum `member_role` in una migrazione, e le migrazioni committate non si modificano.

Il nodo che ha fatto propendere per il sì: una scheda artista o venue **non appartiene a nessuna organizzazione**. Senza un ruolo dedicato, l'unico che può correggere la scheda inserita male da un altro è il platform admin, cioè il manutentore part-time. Il costo non è "un ruolo in più", è che ogni refuso diventa una richiesta via Telegram al manutentore.

**Decisione.** `member_role` è `owner | admin | moderator | member`. Il moderatore può correggere, verificare (`is_verified`) e unire le schede di artisti e venue **di tutto il calendario**. Non guadagna nessun potere sull'organizzazione a cui appartiene: lì conta come un membro qualunque.

**Motivazioni.** Le due cose sono assi indipendenti. Il potere sull'organizzazione deriva dall'appartenenza; il potere sulle anagrafiche condivise no, perché quelle non sono di nessuno. Legarlo a `owner` sarebbe stato sbagliato in entrambe le direzioni: darebbe a ogni titolare di circolo il diritto di riscrivere le schede altrui, e non permetterebbe di nominare moderatore chi cura bene l'anagrafica ma non governa la propria associazione.

Aggiungerlo ora costa un valore in più nell'enum. Aggiungerlo dopo costa un `ALTER TYPE` in una migrazione a parte, più il travaso dei controlli di permesso già scritti. È una di quelle scelte in cui la versione difficile da annullare è quella di non farla.

**Alternative scartate.**

- _Nessun ruolo, solo `is_platform_admin`_: è ADR-0006 alla lettera. Scartata perché concentra sul manutentore un lavoro di manutenzione ordinaria che cresce col numero di schede.
- _Moderazione derivata da `owner`_: confonde il governo dell'organizzazione con la cura di un bene comune, e i due insiemi di persone non coincidono.
- _Moderazione per organizzazione_: non ha senso su entità che non appartengono a un'organizzazione. Un moderatore lo è per tutto il calendario o non lo è.

**Conseguenze.**

- Tutti i controlli di permesso stanno in `src/lib/server/auth/permissions.ts` e sono coperti da test, incluso il caso "il moderatore non guadagna niente dentro l'organizzazione".
- Una scheda `is_verified` diventa modificabile solo dai moderatori: è il meccanismo con cui la curatela regge nel tempo.
- Lo **strumento di merge** vero e proprio non c'è ancora: `canMergeCatalogEntries()` esiste e i permessi sono al loro posto, ma l'operazione di unione di due schede arriva quando servirà davvero. Il ruolo senza il merge è comunque utile: correzione e verifica coprono la gran parte dei casi.
- Il ruolo si assegna dal titolare dell'organizzazione, in `/org`, oppure con un invito.

**Da rivedere se.** I moderatori non vengono mai nominati da nessuno, o i doppioni restano rari: in quel caso il ruolo è peso morto e va tolto, non lasciato a decorare l'interfaccia.

---

## ADR-0017 — Form action e Zod a mano, senza superforms

**Data:** 2026-08-20 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §3 e il piano di Fase 2 prevedevano `sveltekit-superforms` per il form evento, che è il più lungo del prodotto: una trentina di campi, lineup dinamica, link ripetuti. In Fase 1, però, i form di organizzazione, locale e artista sono stati scritti come form action normali con validazione Zod esplicita (`formValues()` + `schema.safeParse()`), e superforms è rimasto in `package.json` senza mai essere importato.

Arrivati al form evento la scelta andava fatta davvero: adottare superforms qui avrebbe significato avere due modi diversi di scrivere un form nella stessa applicazione, oppure riscrivere anche i tre form esistenti.

**Decisione.** Form action con validazione Zod esplicita, come già fa tutto il resto. La lineup dinamica usa campi con nomi indicizzati (`lineup.0.artistName`), letti sul server da `righeIndicizzate()`. `sveltekit-superforms` viene rimosso dalle dipendenze.

**Motivazioni.**

- Un solo modo di fare la stessa cosa. Il vantaggio principale di superforms — non riscrivere la gestione degli errori a ogni form — vale se lo si usa ovunque; usato in un form su quattro è solo una cosa in più da conoscere per chi legge il codice.
- I nomi indicizzati mantengono il form un form HTML vero. Il salvataggio funziona anche senza JavaScript: si perde l'aggiunta dinamica delle righe, non l'inserimento della data.
- Lo schema Zod resta l'unica fonte di verità della validazione in entrambe le soluzioni: è quello il vincolo che conta di ADR-0001, e non cambia.

**Alternative scartate.**

- _Adottare superforms solo nel form evento_: due dialetti nello stesso repo, per un manutentore part-time che ci torna ogni tanto.
- _Riscrivere anche i form di Fase 1_: lavoro reale su codice che funziona, per un beneficio che nessuno ha chiesto.

**Conseguenze.** La gestione degli errori è a carico nostro: `validaEvento()` appiattisce le issue Zod in `campo → messaggio`, dove la chiave è il `name` dell'input (`lineup.2.artistName`), così l'errore si può mostrare accanto alla riga giusta. Dopo un salvataggio fallito i valori digitati tornano al form tramite `valoriDaForm()`: su trenta campi, ripresentarne il form vuoto sarebbe il modo più rapido di far smettere qualcuno di usare il prodotto.

**Da rivedere se.** I form diventano molti di più e la gestione manuale degli errori inizia a divergere fra l'uno e l'altro. In quel caso si adotta superforms **ovunque**, in un intervento solo, non un form alla volta.

---

## ADR-0018 — Da `draft` si esce e non si rientra

**Data:** 2026-08-20 · **Stato:** Accettata

**Contesto.** Scritta la macchina a stati di Fase 2 andava deciso quali transizioni ammettere. Quella dubbia è il ritorno indietro: da `hold` o `confirmed` verso `draft`.

**Decisione.** Le transizioni ammesse sono:

| Da          | A                              |
| ----------- | ------------------------------ |
| `draft`     | `hold`, `confirmed`, `cancelled` |
| `hold`      | `confirmed`, `cancelled`       |
| `confirmed` | `hold`, `cancelled`            |
| `cancelled` | `hold`, `confirmed`            |

Nessuno stato torna a `draft`.

**Motivazioni.** `draft` non è un livello di visibilità come gli altri: è l'affermazione "nessun altro l'ha mai vista". Appena una data passa a `hold`, quell'affermazione smette di essere vera **per sempre** — qualcuno l'ha già letta nel proprio calendario, magari ci ha già ragionato sopra. Un ritorno in bozza darebbe l'illusione di aver ritirato un'informazione che è già uscita: l'interfaccia direbbe "privata" di una cosa che privata non è più.

Per togliere una data dal calendario degli altri esiste `cancelled`, che è onesto: dice che quella serata non si fa, e libera lo slot — che è esattamente l'informazione che agli altri interessa (ADR-0005).

Le transizioni all'indietro fra gli stati *visibili* restano invece ammesse, perché corrispondono a cose che succedono davvero: `confirmed → hold` è l'annuncio ritirato, `cancelled → confirmed` è la data recuperata.

**Alternative scartate.**

- _Ammettere il ritorno in bozza ai soli `owner`_: il problema non è chi lo fa, è che l'informazione è già uscita. Nessun ruolo può disfare una cosa già letta da altri.
- _Nessun vincolo, qualunque transizione_: lascia costruire un'interfaccia che mente.

**Conseguenze.** `motiviCheImpediscono()` è l'unico punto del prodotto in cui qualcosa viene **bloccato**, ed è deliberato: confermare senza locale non è una scelta strategica come ignorare un conflitto (ADR-0009), è un campo dimenticato, e chi legge quella data nel proprio calendario non saprebbe dove andare. Il messaggio d'errore propone l'alternativa giusta invece di dire solo di no.

---

## ADR-0019 — Il platform admin non vede le date altrui

**Data:** 2026-08-20 · **Stato:** Accettata

**Contesto.** `hasOrgRole()` concede al platform admin qualunque permesso dentro qualunque organizzazione: è comodo per inviti e tassonomie, dove il manutentore fa da amministratore di sistema. Scrivendo `serializeEvent()` e i permessi sugli eventi bisognava decidere se quella scorciatoia valesse anche per le date.

**Decisione.** No. Sugli eventi il platform admin è un estraneo come un altro: non vede le bozze altrui, vede un `hold` altrui ridotto come chiunque, non legge le note interne, non crea né modifica né cancella date di organizzazioni di cui non è membro. I controlli sugli eventi non passano da `hasOrgRole()` ma dalla sola appartenenza.

**Motivazioni.** ADR-0005 promette agli organizzatori che le loro date non annunciate restano loro. Una promessa che vale contro i concorrenti ma non contro chi amministra il server è un'altra promessa, e non è quella che si è fatta. Amministrare inviti e tassonomie non è amministrare il cartellone di un'associazione: sono due poteri diversi e non c'è motivo che il primo implichi il secondo.

C'è anche un argomento pratico: il manutentore è, con ogni probabilità, anche uno degli organizzatori. Dargli visibilità totale sulle date degli altri lo mette in una posizione imbarazzante di cui nessuno ha bisogno.

**Alternative scartate.**

- _Accesso completo con registrazione in audit_: sposta il problema dalla capacità alla sorveglianza, e comunque lascia il potere dov'era.
- _Accesso completo solo su richiesta esplicita di supporto_: sensato in astratto, ma richiede un meccanismo di richiesta e revoca che a questa scala non si giustifica. Se serve leggere una riga per aiutare qualcuno, esiste `db:studio`, che è un'operazione manuale e consapevole.

**Conseguenze.** Un platform admin senza organizzazioni vede un calendario in cui compaiono solo `hold`, `confirmed` e `cancelled` altrui, ridotti secondo la matrice. È il comportamento giusto e ha i suoi test, sia in `visibility.test.ts` sia in `permissions.test.ts`.

---

## ADR-0020 — Una lineup mai annunciata resta nascosta anche a data annullata

**Data:** 2026-08-20 · **Stato:** Accettata

**Contesto.** La matrice di `ARCHITECTURE.md` §5 segna la lineup come pienamente visibile nella colonna `cancelled` di un'altra organizzazione, mentre per `confirmed` la limita alle voci con `is_announced = true`. Implementando `serializeEvent()` la differenza è saltata all'occhio: una data passata da `hold` a `cancelled` avrebbe rivelato di colpo l'intera lineup che `hold` aveva protetto fino a un istante prima.

**Decisione.** Fuori dall'organizzazione proprietaria si vedono **solo** le voci di lineup con `is_announced = true`, in qualunque stato, `cancelled` incluso. La cella della matrice è stata corretta di conseguenza, con rimando a questa voce.

**Motivazioni.** Il senso di `is_announced` è la rivelazione progressiva: una band esce quando chi la porta decide di annunciarla. L'annullamento della serata non è quella decisione — anzi, è il caso in cui l'annuncio non arriverà mai, e sapere chi si stava trattando resta un'informazione commercialmente sensibile. La lettura opposta renderebbe l'annullamento un modo per far uscire ciò che `hold` teneva dentro, cioè esattamente il contrario di ADR-0005.

Che nella matrice ci fosse una spunta piena si spiega meglio come scorciatoia di scrittura — "`cancelled` si comporta come `confirmed`" — che come intenzione.

**Alternative scartate.**

- _Seguire la matrice alla lettera_: fedeltà al documento contro il principio che il documento serviva a proteggere. Fra i due, il documento è la parte che si corregge.
- _Rendere la cosa configurabile_: un'opzione in più su una decisione che non ha una risposta ragionevole diversa.

**Conseguenze.** `ARCHITECTURE.md` §5 è stato aggiornato. Il test corrispondente in `visibility.test.ts` è scritto con la motivazione accanto, perché chi in futuro rileggerà la matrice originale penserà a un bug.

---

## ADR-0021 — La sovrapposizione fra artisti si misura in giorni, non in due settimane

**Data:** 2026-08-21 · **Stato:** Accettata

**Contesto.** Erano le decisioni #1 e #2 del registro, in scadenza con la Fase 3, e andavano chiuse parlando con chi organizza le serate — non a tavolino. La stesura originale fissava per la regola R2 una finestra di ±14 giorni, con la motivazione che "una band non suona due volte a 50 km di distanza a due settimane di distanza". Il numero però veniva dalle clausole di esclusiva dei contratti di booking, che sono una cosa diversa dal problema che questo prodotto affronta: R2 non serve a far rispettare un contratto, serve ad avvisare due organizzatori che si stanno contendendo lo stesso pubblico.

**Decisione.**

1. Il **raggio di conflitto predefinito resta 60 km**, confermato: chiude la decisione #1.
2. La finestra della regola R2 scende da ±14 a **±7 giorni civili**, con severity **graduata** invece che fissa a `high`. Oltre i sette giorni non c'è conflitto: due date non si danno più fastidio.

| Giorni di distanza | Severity |
| ------------------ | -------- |
| 0 (stesso giorno)  | `high`   |
| 1–2                | `high`   |
| 3–5                | `medium` |
| 6–7                | `low`    |
| oltre 7            | nessun conflitto |

Il vincolo di distanza ≤ 200 km resta invariato e continua a fare da soglia: la gradazione riguarda i giorni, non i chilometri.

**Motivazioni.** "Sovrapposizione", per un organizzatore, vuol dire anzitutto **stesso giorno**: è quello il caso in cui il pubblico deve scegliere. Da lì l'effetto sfuma man mano che le date si allontanano, e dopo una settimana è finito — chi è andato a un concerto sabato non è impedito ad andare a un altro il sabato dopo. Una finestra di due settimane trattata tutta con la stessa gravità produce avvisi che gli organizzatori imparano a ignorare, e un avviso ignorato è peggio di un avviso assente, perché toglie credibilità anche a quelli veri.

**Lo stesso giorno merita un discorso a parte.** Se la stessa band risulta ingaggiata da due organizzazioni diverse nella stessa data, quello non è un conflitto strategico: è un **errore materiale**, come il `venue_clash` della regola R1. O c'è un doppio ingaggio, o uno dei due ha inserito la data sbagliata. Il messaggio dovrà dirlo con parole diverse dagli altri casi — non "attenzione, vi contendete il pubblico" ma "questa band risulta impegnata altrove quella sera".

**Alternative scartate.**

- _Tenere ±14 giorni con severity fissa_: è la stesura originale, e produce la classe di avvisi che nessuno legge.
- _Una formula continua sui giorni_ (severity che decresce linearmente): più elegante da scrivere, impossibile da spiegare a chi riceve l'avviso. Le fasce si raccontano in una riga.
- _Graduare anche sulla distanza_: raddoppia i casi da spiegare e da testare per un guadagno che nessuno ha chiesto. I 200 km restano una soglia netta.

**Conseguenze.**

- La finestra di selezione dei candidati in §6.1 scende da ±21 a ±10 giorni: sette più tre di margine, perché il confronto avviene su giorni civili in `Europe/Rome` mentre il filtro SQL lavora su istanti.
- La tabella delle fasce va coperta dai test caso per caso, inclusi i bordi a 7 e 8 giorni, e con una data a cavallo del cambio d'ora: il "giorno di distanza" si conta fra giorni civili, non dividendo millisecondi per 86.400.000.
- Il rischio di leak di ADR-0009 non cambia e non va allentato: la gradazione riguarda la gravità, non quanto si rivela. Una band non annunciata resta senza nome in tutte le fasce.

**Da rivedere se.** Gli organizzatori riferiscono di essersi pestati i piedi a otto o dieci giorni di distanza, oppure che gli avvisi a 6–7 giorni sono rumore. Sono i due bordi che questa decisione fissa a occhio, ed è su quelli che tornerà l'evidenza.

---

## ADR-0022 — Una data si conferma anche con un conflitto aperto

**Data:** 2026-08-21 · **Stato:** Accettata

**Contesto.** ADR-0009 stabilisce che un avviso di conflitto non blocca mai il **salvataggio**. Non diceva però niente sul passaggio a `confirmed` di una data che ha un conflitto ancora `open`, ed è un punto diverso: confermare significa annunciare, cioè rendere definitivo proprio lo scontro che l'avviso segnalava. La macchina a stati ha già un punto in cui qualcosa viene bloccato (`motiviCheImpediscono`, che pretende un locale per confermare), quindi il gancio per aggiungere un cancello esisteva già ed era comodo.

**Decisione.** Nessun cancello. Un conflitto aperto **non** impedisce di passare a `confirmed`, e nemmeno richiede di prenderne atto prima. Lo strumento segnala, i due organizzatori si parlano, e se scelgono di confermare entrambi le rispettive date è una loro decisione — comprese le conseguenze.

**Motivazioni.** È la stessa ragione di ADR-0009, applicata al momento in cui la tentazione di intervenire è più forte. Il calendario mette in contatto due pari: non ha titolo per decidere quale delle due serate ha diritto a quella data, e non ha modo di sapere se si sono già parlati e hanno concluso che va bene così. Due date dello stesso genere a quaranta chilometri possono coesistere benissimo se i pubblici sono diversi, e chi lo sa sono loro, non il software.

Anche un cancello morbido — "spunta questa casella per confermare lo stesso" — sposterebbe il messaggio da *"guarda che c'è questo"* a *"ti autorizzo a procedere"*. È una postura che questo prodotto non deve avere: il primo organizzatore che si sente messo sotto tutela smette di caricare le date in anticipo, e a quel punto il calendario non serve più a niente.

**Alternative scartate.**

- _Richiedere un acknowledge prima di confermare_: sembra innocuo, ma introduce un passaggio obbligato per un problema che nella gran parte dei casi è già stato risolto al telefono.
- _Bloccare solo i conflitti `high`_: la severity dice quanto è probabile che due serate si diano fastidio, non chi ha ragione. Nemmeno un `high` autorizza il software a decidere.

**Conseguenze.**

- `motiviCheImpediscono` resta l'unico punto che blocca qualcosa, e continua a occuparsi solo di dati mancanti — un locale, una città — mai di conflitti.
- La responsabilità di una sovrapposizione confermata è degli organizzatori che non si sono contattati. Perché sia una responsabilità reale e non una scusa, l'avviso deve essere impossibile da non vedere al momento della conferma: è un requisito di interfaccia della Fase 3, non un dettaglio grafico.
- Lo storico dei conflitti (`status`, `acknowledged_by_a/b`, `resolution_note`) resta il posto dove si legge se una conversazione c'è stata. Serve a ricostruire, non a impedire.

**Da rivedere se.** Compaiono sovrapposizioni confermate che nessuno aveva notato. In quel caso il problema è che l'avviso non si vedeva abbastanza, e si interviene sull'interfaccia — non aggiungendo un blocco.

---

## ADR-0023 — La fiducia nello stato `hold` è assunta, non verificata

**Data:** 2026-08-21 · **Stato:** Provvisoria — da confermare con i dati d'uso

**Contesto.** Era la decisione #4 del registro, in scadenza con la Fase 2: *la visibilità ridotta in `hold` è sufficiente a far fidare gli organizzatori?* Il registro prescriveva di chiuderla **parlando con loro**, perché è una previsione sul comportamento di altre persone. La Fase 2 si è chiusa senza che quella conversazione avvenisse.

**Decisione.** Si assume di sì, e si procede. La Fase 3 viene costruita dando per buono che gli organizzatori carichino le date non ancora annunciate.

**Motivazioni.** È la convinzione del manutentore, che conosce le persone coinvolte: la prospettiva di gestire un conflitto in anticipo vale più del rischio percepito di esporre una data. Aspettare la conferma empirica bloccherebbe la fase più importante del prodotto in attesa di una telefonata che può arrivare in qualunque momento, e nulla di ciò che si scrive in Fase 3 andrebbe buttato se l'assunzione si rivelasse sbagliata: cambierebbe il valore del prodotto, non il codice del motore.

**Perché provvisoria.** Nessuno l'ha verificata. È l'assunzione su cui poggia l'intero prodotto — `ARCHITECTURE.md` §1 la enuncia come metrica di successo: *"gli organizzatori inseriscono le date in stato provvisorio prima di confermarle. Se lo usano solo dopo l'annuncio, il prodotto ha fallito il suo scopo"*.

**Come si scopre di aver sbagliato.** Il segnale è misurabile e i dati per misurarlo esistono già, perché `audit_log` registra ogni cambio di stato: **la quota di eventi che passano da `hold` prima di arrivare a `confirmed`**, contro quelli che nascono già confermati. Se dopo qualche mese la gran parte delle date compare direttamente in `confirmed`, l'assunzione è falsa — e non serve chiederlo a nessuno, si legge dal registro.

Se succede, la domanda successiva non è tecnica: è se il problema sia la fiducia nello strumento (e allora si può ridurre ancora ciò che `hold` mostra — la sola provincia invece della città, per esempio) o la fiducia fra le persone, che il software non risolve.

---

## ADR-0024 — I conflitti si rilevano sui dati interi e si redigono in uscita

**Data:** 2026-08-21 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §6.2, per la regola R2, prescrive di considerare «solo lineup con `is_announced = true` oppure appartenenti alla propria organizzazione — altrimenti si rivelerebbe indirettamente una lineup segreta». Implementando il motore, quella prescrizione si è rivelata insieme **impraticabile** e **insufficiente**.

Impraticabile perché non è simmetrica. Il ricalcolo parte da una data alla volta: salvando la data X si confronterebbe la lineup intera di X con le sole voci annunciate delle altre, salvando la data Y si farebbe il contrario. Se X ha una band segreta che Y ha annunciato, salvare X crea il conflitto e salvare Y lo cancella. Le due date si darebbero il cambio a ogni modifica, e la tabella `conflicts` direbbe cose diverse a seconda di chi ha salvato per ultimo.

Insufficiente perché il filtro non chiude il varco che dichiara di chiudere. Se X (opzionata) e Y (confermata) condividono una band annunciata da X ma non da Y, la regola scatterebbe, e l'organizzazione di Y riceverebbe un conflitto «avete una band in comune con la data di X». Y conosce la propria lineup: se ha ingaggiato tre band, deduce quale. Il conflitto stesso, anche senza nomi, **è** l'informazione. Togliere il nome non basta, e nemmeno dire quante sono: il numero di band condivise che non si possono nominare è a sua volta il conteggio delle band segrete della controparte.

**Decisione.** Il motore rileva sui dati **interi**, da entrambi i lati, e la protezione si sposta tutta in uscita, in `redigiConflitto()`, accanto a `serializeEvent`. Il principio, uno solo per tutte e quattro le regole:

> **Un conflitto si racconta a un organizzatore solo nella misura in cui il dato che lo produce gli è già visibile.**

Che si traduce così:

| Regola               | Controparte `confirmed`/`cancelled`      | Controparte `hold`                                                                                        |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `venue_clash`        | visibile, col nome del locale            | **non visibile affatto**: il conflitto *è* il locale, e in `hold` il locale è riservato                     |
| `artist_overlap`     | visibile, coi nomi delle band annunciate | visibile **solo** se almeno una band condivisa è annunciata *dalla controparte*; si nominano solo quelle    |
| `geo_genre_overlap`  | visibile, con il valore di affinità      | visibile, **senza** l'affinità e senza la coppia di generi: sono calcolate anche sui secondari, che `hold` protegge |
| `same_day_proximity` | idem                                     | idem                                                                                                        |

Una condizione resta però **nel motore**, ed è simmetrica: se una band condivisa non è annunciata da nessuna delle due parti, il conflitto non si registra affatto. Nessuno dei due potrebbe mai sentirselo raccontare, quindi sarebbe un dato commercialmente sensibile conservato in database senza che serva a niente.

**Motivazioni.** È la stessa forma di ADR-0003 e ADR-0005 applicata ai conflitti invece che agli eventi: la verità sta in un posto solo, la redazione avviene al confine. Un motore che rileva "a metà" produce risultati che dipendono dall'ordine dei salvataggi, e un risultato che dipende dall'ordine dei salvataggi non si copre con un test.

Sul `venue_clash` in particolare: nascondere il conflitto a una delle due parti sembra una perdita, e non lo è. Chi non lo vede è chi ha davanti una data opzionata altrui; chi lo vede è chi quella data opzionata l'ha creata — cioè l'unico dei due che può ancora spostarla senza rimangiarsi un annuncio pubblico. L'avviso arriva a chi può agire.

**Alternative scartate.**

- _Seguire §6.2 alla lettera_: produce il conflitto che compare e sparisce a seconda di quale data viene salvata per ultima, e lascia comunque aperto il varco su R2.
- _Rilevare sui dati interi e mostrare tutto a entrambi_: renderebbe il motore conflitti il modo più comodo per scoprire le lineup non annunciate degli altri. Il contrario esatto di ADR-0005.
- _Registrare due righe, una per lato, con contenuti diversi_: raddoppia lo stato da tenere allineato per ottenere ciò che una funzione di redazione ottiene senza stato.
- _Mostrare «ci sono N band in comune» senza i nomi_: il numero è già il segreto, vedi sopra. È l'errore che sembra prudente e non lo è.

**Conseguenze.**

- `ARCHITECTURE.md` §6.2 è stato corretto, con rimando a questa voce. Chi rileggesse la stesura originale penserebbe a un bug: per questo la motivazione sta anche accanto al test.
- `details` in `conflicts` contiene, per R2, i flag di annuncio dei **due** lati. È una colonna che non va mai restituita grezza, esattamente come una riga `events`.
- Il conteggio dei conflitti per la navigazione è una **soglia superiore**: si conta prima della redazione, perché contare dopo vorrebbe dire caricare a ogni pagina le due date di ogni conflitto con tutte le relazioni. Per questo la voce di menu mostra un pallino e non una cifra.
- `redigiConflitto()` è condivisa fra la dashboard e l'anteprima nel form: l'avviso che si vede mentre si compila è per costruzione lo stesso che poi arriva in dashboard.
- Le email di conflitto della Fase 6 dovranno passare da qui e non dalla riga grezza. È lo stesso vincolo permanente che ADR-0005 impone al feed ICS e all'export.

**Da rivedere se.** Si aggiunge una quinta regola: la tabella qui sopra ha una riga per regola, e una regola nuova senza la sua riga sarebbe un varco aperto per difetto.

---

## ADR-0025 — Il motore ignora le bozze, le date annullate e quelle senza coordinate

**Data:** 2026-08-21 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §6.1 limita i **candidati** a `status IN ('hold','confirmed')`. Non dice niente sull'altro lato: se la data che si sta salvando è una bozza, o è appena stata annullata, il motore deve girare lo stesso? E che fare di una data senza `lat`/`lon`, caso che ADR-0008 ammette esplicitamente?

**Decisione.** Tre esclusioni, tutte dal lato dell'ingresso al motore.

1. **Solo `hold` e `confirmed` partecipano alla riconciliazione persistita**, da entrambi i lati. Una bozza non genera conflitti; una data che esce da quegli stati vede i propri conflitti aperti passare a `resolved` con nota automatica.
2. **L'anteprima nel form gira invece per qualunque stato**, bozza compresa.
3. **Una data senza coordinate resta fuori da tutte le regole geografiche**, R2 inclusa — quindi da tutte tranne R1.

**Motivazioni.**

Sulle bozze: persistere un conflitto fra una bozza e la data di un altro significherebbe scrivere in `conflicts` una riga che parla di un evento di cui quell'altra organizzazione non ha il diritto di sapere l'esistenza. `serializeConflict` la nasconderebbe, ma sarebbe difesa in profondità usata come difesa unica — e ADR-0005 dice che una bozza *non esiste* per gli altri, non che «esiste ma non si vede». Le date annullate sono il caso opposto e altrettanto semplice: hanno liberato lo slot, che è il contrario di un conflitto.

Sull'anteprima: chi sta ancora decidendo è esattamente la persona a cui l'avviso serve, e mostrarglielo non scrive niente da nessuna parte. L'asimmetria fra le due — l'anteprima guarda le bozze, la riconciliazione no — non è una svista: una legge e l'altra scrive.

Sulle coordinate: R2 sarebbe stata la candidata naturale a un'eccezione, perché la stessa band la stessa sera è un errore materiale indipendentemente da dove. Ma la regola pretende ≤ 200 km, e senza coordinate quella soglia non è verificabile: farla scattare comunque vorrebbe dire segnalare come doppio ingaggio una band a Palermo e una a Bolzano. Una regola sola per tutti e quattro i casi si spiega meglio di tre più un'eccezione, e la rete di sicurezza è a monte — il salvataggio geocodifica la città quando manca il locale, e `motiviCheImpediscono` la città la pretende sempre.

**Alternative scartate.**

- _Riconciliare anche le bozze e fidarsi del serializzatore_: usa la difesa in profondità come difesa unica.
- _Far scattare R2 senza coordinate a zero giorni di distanza_: un'eccezione in più da spiegare a chi riceve l'avviso, per un caso che il geocoding rende raro.
- _Impedire di salvare una data senza coordinate_: aggiungerebbe un secondo punto di blocco al prodotto — ADR-0018 ne ammette uno solo — per un dato che l'utente spesso non conosce.

**Conseguenze.**

- Cambiare stato è un'operazione che **ricalcola**: `cambiaStato` chiama la riconciliazione, non solo `aggiornaEvento`. È il passaggio che sposta di più, perché fa entrare o uscire una data dal motore.
- Una data senza coordinate non compare in nessun avviso, e nessuno se ne accorgerebbe. L'anteprima nel form lo dice esplicitamente — «il luogo non è ancora risolto in coordinate» — perché «nessun conflitto» e «non ho potuto controllare» si leggono in modo molto diverso sotto un form.
- Il ricalcolo notturno riconcilia solo `hold` e `confirmed`: una bozza con conflitti spuri non verrebbe ripulita. Non può averne, perché non ne genera mai.

**Da rivedere se.** Emergono date che restano a lungo senza coordinate. Vorrebbe dire che il geocoding fallisce più di quanto si pensasse, e il problema da risolvere sarebbe quello, non il motore.

---

## ADR-0026 — Il pool ha più di una connessione, perché il pooler non tollera il pipelining

**Data:** 2026-08-22 · **Stato:** Accettata · **Modifica** `ARCHITECTURE.md` §3

**Contesto.** `ARCHITECTURE.md` §3 prescrive `max: 1` sul client `postgres`, con la motivazione «una connessione per isolate: il pooler fa il resto». È il consiglio standard per gli ambienti serverless, e il runbook ci aveva perfino costruito sopra un avvertimento: «una richiesta lenta accoda tutte le successive, quindi provando più volte di seguito si misura la propria coda invece del problema».

Con la Fase 3 le pagine autenticate hanno cominciato a non rispondere. Il sintomo: `/calendar` restava appesa due minuti, poi Postgres uccideva una query — quasi sempre quella su `profiles` in `ensureProfile`, che non c'entrava niente — con `57014, canceling statement due to statement timeout`, e il rifiuto non gestito terminava il processo del dev server.

Le stesse query eseguite da uno script giravano in centinaia di millisecondi, il database non aveva né lock né transazioni appese, e le connessioni erano tredici su sessanta.

**La misura che ha chiuso la questione.** Interrogando `pg_stat_activity` mentre l'applicazione era bloccata, la sessione colpevole risultava `state = active` con `wait_event = ClientRead`: Postgres aveva finito la sua parte e aspettava che il client gli parlasse. Non stava calcolando, stava aspettando. Poi, sullo stesso server:

| Prova | Esito |
| ----- | ----- |
| Una richiesta a `/calendar` | 200 in 870 ms |
| Tre richieste in parallelo | tutte e tre appese oltre 35 s |
| Cinque in parallelo, con `max: 10` | tutte 200, circa 1,4 s |

**Decisione.** `max: 10`, in sviluppo e in produzione.

**Motivazioni.** Con una connessione sola, postgres.js accoda in *pipeline* le query concorrenti sulla medesima connessione. Verso un Postgres diretto è lecito. Verso Supavisor in transaction mode no: il pooler assegna una connessione di servizio **per transazione**, e messaggi di richieste diverse intrecciati sulla stessa connessione client desincronizzano il dialogo. Da lì la sessione ferma in `ClientRead` e la coda che muore per timeout.

La concorrenza non è un caso di punta da cui ci si può difendere andando piano: **SvelteKit esegue in parallelo la `load` del layout e quella della pagina**, e un browser apre più richieste insieme. Ogni pagina autenticata la produce, sempre. Con `max: 1` il guasto non era eccezionale, era garantito — e passava inosservato solo finché lo si provava con una richiesta alla volta, che è precisamente l'errore di misura che il runbook consigliava di commettere.

`max: 1` risolveva un problema che qui non esiste. Serve dove ogni isolate è effimero e i client sono migliaia; qui i client sono un dev server e un Worker, e moltiplicare le connessioni client su poche di servizio è il mestiere del pooler.

**Alternative scartate.**

- _Tenere `max: 1` e serializzare le query applicative_: impossibile: il parallelismo lo introduce SvelteKit fra `load` del layout e della pagina, non il nostro codice.
- _Passare al pooler in session mode (5432) a runtime_: rinuncia al multiplexing proprio dove serve, cioè in produzione su Worker, e contraddice ADR-0002 senza guadagno.
- _Un timeout lato client come rete di sicurezza_: verificato che non è disponibile — `connection: { statement_timeout }` attraverso Supavisor viene **ignorato in silenzio**: un `pg_sleep(9)` con timeout dichiarato a 5 secondi gira per intero.
- _Alzare `max` solo in sviluppo_: il parallelismo delle `load` esiste identico in produzione. Un guasto che si manifesta solo là dove non lo si può osservare è la versione peggiore di questo stesso problema.

**Conseguenze.**

- `ARCHITECTURE.md` §3 è stato corretto: la riga sul driver diceva `max: 1` come vincolo.
- La nota del runbook sulla coda («una richiesta lenta accoda tutte le successive») non vale più, e va tolta: consigliava di misurare in un modo che nascondeva proprio questo guasto.
- Resta vero che il numero di connessioni non è gratis. Dieci per client è un tetto, non un obiettivo: `idle_timeout` le chiude quando non servono.
- Il rifiuto non gestito che termina il processo non è stato affrontato. Con questa correzione non dovrebbe più scattare, ma è una fragilità indipendente: una query che fallisce non dovrebbe poter abbattere il server.

**Da rivedere se.** Supabase segnala saturazione del pooler, o si passa a un runtime dove ogni richiesta ha il proprio isolate e le connessioni non si condividono. In quel caso la domanda giusta non è «quante connessioni» ma «postgres.js è il driver adatto a un pooler in transaction mode».

---

## ADR-0027 — Una data che rientra in cartellone riapre i conflitti già risolti

**Data:** 2026-08-22 · **Stato:** Accettata

**Contesto.** La riconciliazione riapriva un conflitto `resolved` solo se a chiuderlo era stato il ricalcolo (`resolved_by is null`). Una chiusura scritta da una persona restava chiusa per sempre, sul principio — giusto — che quella persona sapeva qualcosa che il software non sa, e che ripresentarle un avviso già discusso è il modo migliore per farle ignorare anche quelli veri (ADR-0009, ADR-0021).

Provando la Fase 3 è emerso il caso che quel principio non copre. Una data era stata chiusa con la nota «sentiti al telefono, loro spostano»; poi è stata annullata; poi rimessa in opzione sulla stessa sera. Il conflitto esisteva di nuovo, materialmente — due date opzionate, stessa sera, otto chilometri — e **non compariva da nessuna parte**: né in dashboard, che mostra solo gli aperti, né sulla pagina della data, che chiede gli stessi stati.

Il che stride con ADR-0022, che in cambio del non mettere cancelli davanti alla conferma ha assunto un impegno preciso: che l'avviso sia impossibile da non vedere proprio lì.

**Decisione.** Quando una data **rientra in cartellone** — arriva in `hold` o `confirmed` venendo da uno stato diverso — i conflitti che la riguardano e che risultano `resolved` tornano `open`, **anche se a chiuderli era stata una persona**.

Rientrare in cartellone copre tre movimenti: una data annullata che si recupera, una bozza che viene opzionata, e un'opzione che viene confermata. Restare fermi nello stesso stato non è un rientro: salvare una modifica alla descrizione non riapre niente.

Alla riapertura la nota di chi aveva chiuso **si conserva**, e l'interfaccia la presenta per quello che è — «l'avevate chiuso così, ed è tornato». Si azzerano invece `resolved_by` e le due prese d'atto: si riferivano alla situazione precedente.

`dismissed` non si tocca mai. Significa «lo sappiamo e va bene così», ed è una decisione presa proprio sul conflitto che continua a esistere: riaprirla sarebbe contraddirla.

**Motivazioni.** Una nota di risoluzione descrive una situazione, non una data. «Loro spostano» era vero al momento in cui è stato scritto; dopo un annullamento e una riopzione quella frase non descrive più niente di verificabile, e lasciarla a tenere chiuso un conflitto reale trasforma lo storico in un modo per farlo sparire.

Il caso che conta di più è però il terzo. **Confermare significa annunciare**: è il momento in cui una sovrapposizione diventa definitiva, e in cui ADR-0022 pretende che chi conferma abbia visto l'avviso. Un conflitto chiuso settimane prima, in una situazione diversa, non può coprire quel momento.

**Alternative scartate.**

- _Lasciare tutto com'era e mostrare i conflitti chiusi sulla pagina della data_, in tono minore. Risolveva il requisito di interfaccia senza toccare la logica, ed era la proposta iniziale. Scartata su indicazione del manutentore: un conflitto che torna a esistere è un conflitto aperto, e chiamarlo diversamente per non disturbare è la stessa reticenza che questo prodotto evita altrove.
- _Riaprire a ogni ricalcolo_: riporterebbe l'avviso in eterno, che è esattamente ciò che ADR-0009 vuole evitare.
- _Riaprire quando cambia la sostanza_ (giorno, luogo, lineup) invece che allo stato: più preciso in teoria, ma «sostanza» andrebbe definita campo per campo, e il caso che ha fatto emergere il problema — una data tornata identica — non rientrerebbe.

**Conseguenze.**

- `riconciliaConflitti` accetta `rientroInCartellone`. Non può dedurlo: quando gira, la riga dell'evento è già aggiornata e lo stato precedente non esiste più. Lo passano `cambiaStato` e `aggiornaEvento`, che lo conoscono.
- Il ricalcolo notturno **non** riapre niente di chiuso da una persona: non c'è nessun rientro, sta solo ricontrollando. Giusto così.
- Un conflitto riaperto risulta nuovo anche ai fini delle notifiche di Fase 6. È voluto: se torna al momento della conferma, è quello il momento in cui serve saperlo.
- Verificato sui dati reali rifacendo il giro che l'ha fatto emergere: `resolved` chiuso da una persona → annullamento (resta chiuso) → riopzione (`open`, prese d'atto azzerate, nota conservata).

**Da rivedere se.** Gli organizzatori si trovano a richiudere sempre lo stesso conflitto a ogni cambio di stato. Vorrebbe dire che `dismissed` — «lo sappiamo e va bene così» — non è abbastanza visibile come alternativa a `resolved`, e il rimedio sarebbe sull'interfaccia, non su questa regola.

---

## ADR-0028 — Il `SEQUENCE` del feed ICS viene da `updated_at`, e non passa dal serializzatore

**Data:** 2026-08-23 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §8 prescrive un `SEQUENCE` «incrementato ad ogni modifica», e [ADR-0011](#adr-0011--feed-ics-in-sola-lettura-nessun-sync-bidirezionale) lo elenca per nome come **l'errore classico di questa integrazione**: senza un numero che cresce, Google non aggiorna mai un evento già importato. Si può spostare una data di un mese e nei calendari di tutti resta dov'era, senza che nessuno se ne accorga — perché il guasto non produce nessun errore, produce un calendario che sembra a posto.

Nessuno dei due documenti diceva però *da dove* prendere quel numero, e la risposta non era ovvia. Le due possibilità erano una colonna contatore su `events`, incrementata a ogni scrittura, oppure una derivazione da un dato che già cambia.

Ne è emersa una seconda, meno visibile: qualunque sia la fonte, quel numero deve arrivare fino al costruttore ICS, che lavora su `EventoSerializzato`. Metterlo lì significava aggiungere una riga alla matrice di §5.

**Decisione.** Due cose.

1. `SEQUENCE` si deriva da `events.updated_at`, in **secondi** trascorsi dal 1° gennaio 2026.
2. `updated_at` sta su `EventWithRelations` — la riga grezza — e **non** esce da `serializeEvent()`. Il costruttore ICS lo riceve a parte, accanto all'evento serializzato: `VoceFeed = { evento, aggiornatoIl }`.

**Motivazioni.**

Sulla fonte: `updated_at` cambia già a ogni scrittura che conta. Evento, lineup, generi e link si salvano in una sola transazione, e anche `cambiaStato` passa di lì — cioè esattamente l'insieme di modifiche che un client calendario deve vedere. Un contatore dedicato sarebbe un secondo stato da tenere allineato al primo, con l'unico effetto possibile di divergerne: il giorno in cui qualcuno aggiungesse un percorso di scrittura dimenticandosi di incrementarlo, il guasto sarebbe di nuovo quello silenzioso di ADR-0011.

I secondi e non i millisecondi perché `SEQUENCE` è un intero, e gli interi di iCalendar sono a 32 bit. Contando i millisecondi il tetto arriverebbe in tre settimane; contando i secondi da un'origine recente restano una sessantina d'anni. L'origine è il 2026 e non l'epoca Unix per la stessa ragione: dal 1970 il margine finirebbe nel 2038.

Sul secondo punto: `updated_at` non è un campo dell'evento che si mostra, è **metadato del feed**. Dice "questa riga è cambiata", mai *che cosa* è cambiato. Farlo passare da `serializeEvent` avrebbe voluto dire allargare la matrice di §5 per una necessità tecnica, e le matrici si allargano una cella alla volta finché non proteggono più niente. Passarlo a parte costa una `Map` per id nella rotta del feed e lascia il serializzatore esattamente com'era.

**Alternative scartate.**

- _Una colonna `ics_sequence` incrementata a mano_: vedi sopra. Più stato per meno garanzie.
- _`SEQUENCE` sempre a 0_: è il comportamento predefinito di chi non ci pensa, ed è precisamente il guasto che ADR-0011 dice di evitare.
- _`updated_at` dentro `EventoSerializzato`_: comodo, e per una volta innocuo — l'istante di un'ultima modifica non rivela niente di commercialmente sensibile. Scartata lo stesso, perché la ragione per cui sarebbe entrato non era «la matrice lo permette» ma «serviva al feed», e quella è la ragione sbagliata per aggiungere una cella.
- _Derivare il `SEQUENCE` dal contenuto serializzato_ (un hash): resisterebbe alle modifiche che non cambiano nulla di visibile, ma un hash non è monotòno, e `SEQUENCE` deve **crescere**: un numero che scende viene ignorato dai client.

**Conseguenze.**

- A parità di dati il file ICS è identico byte per byte, perché anche `DTSTAMP` e `LAST-MODIFIED` vengono da `aggiornatoIl`. Lo snapshot di `ics.test.ts` è possibile solo grazie a questo.
- Una modifica alle sole note interne fa crescere il `SEQUENCE` anche per chi le note non le vede. È innocuo: il client rilegge una voce identica.
- `EventWithRelations` ha un campo in più, e le fixture dei test lo dichiarano. Il test che conta è quello che verifica il negativo: `serializeEvent` **non** restituisce `updatedAt`.

**Da rivedere se.** Si scopre che qualche percorso di scrittura non tocca `updated_at`. In quel caso il difetto è lì e va corretto lì: un evento che cambia senza che la riga risulti cambiata è un problema molto più grande di un feed che non si aggiorna.

---

## ADR-0029 — Il feed ICS non contiene le bozze

**Data:** 2026-08-23 · **Stato:** Accettata

**Contesto.** Il feed ICS è redatto con il viewer del profilo che lo possiede: contiene ciò che quella persona vedrebbe entrando nell'applicazione. Applicata alla lettera, quella regola ci fa entrare anche le **sue** bozze — che nell'applicazione vede eccome, sono sue.

Sarebbe pure comodo: avere le date ancora in bozza nel proprio calendario è esattamente il genere di cosa per cui un organizzatore sottoscrive un feed.

**Decisione.** No. `draft` non è fra gli stati che un feed può contenere, e non è nemmeno un'opzione che si possa spuntare: `statoFeed` ammette `hold`, `confirmed` e `cancelled`, e basta.

**Motivazioni.** Un feed vive su un endpoint **pubblico**, autenticato da un segreto in un URL, e quell'URL finisce nei server di Google o di Apple, in una configurazione di calendario che si condivide con un collega senza pensarci, in uno screenshot di supporto.

Per tutti gli altri stati questo è già stato messo in conto: `hold` e `confirmed` sono dati che altre organizzazioni vedono comunque, sia pure ridotti. La bozza no. La bozza è l'unica cosa di cui questo prodotto fa una promessa assoluta — *nessun altro l'ha mai vista* — al punto che [ADR-0018](#adr-0018--da-draft-si-esce-e-non-si-rientra) vieta perfino di rientrarci, perché una volta uscita quell'affermazione non torna vera. Un token in un URL è una difesa perfettamente adeguata per un calendario condiviso fra venti organizzazioni; non è la difesa che quella promessa merita.

C'è anche una ragione più semplice: la comodità è piccola. Chi ha una bozza la sta scrivendo, ed è nell'applicazione mentre lo fa. Il feed serve per le date che stanno ferme.

**Alternative scartate.**

- _Ammettere `draft` come opzione, spiegando il rischio_: sposta su chi compila un modulo una decisione che ha una risposta sola. E le caselle con l'avvertenza accanto si spuntano.
- _Un feed separato per le bozze, con un token a scadenza_: risolverebbe davvero il problema, ma aggiunge un secondo tipo di feed e una scadenza da gestire per una funzione che nessuno ha chiesto.

**Conseguenze.**

- La scelta è espressa **nello schema**, non in un `if` dentro la rotta: `filtriFeed` rifiuta `draft`, quindi non c'è nessun percorso — nemmeno una riga scritta a mano in `calendar_feeds.filters` — che possa farlo entrare. Il test corrispondente sta in `feeds.test.ts`.
- Vale solo per il feed. L'export e il download `.ics` di una singola data restano dietro la sessione, e lì la bozza propria si porta via come tutto il resto: chi ha fatto login è già chi la può vedere.
- Il modulo di creazione lo dice esplicitamente, invece di limitarsi a non mostrare la casella: una funzione assente senza spiegazione si legge come una dimenticanza.

**Da rivedere se.** Gli organizzatori chiedono di vedere le proprie bozze nel calendario del telefono. La risposta giusta a quel punto non è allentare questa regola, è il feed separato scartato qui sopra.

---

## ADR-0030 — Le API Meta, riverificate: l'import da Facebook e Instagram continua a non esistere

**Data:** 2026-08-24 · **Stato:** Accettata · **Conferma** [ADR-0010](#adr-0010--nessun-import-da-facebookinstagram-paste-to-parse)

**Contesto.** [ADR-0010](#adr-0010--nessun-import-da-facebookinstagram-paste-to-parse) è nato `Provvisorio` con una clausola precisa: «Lo stato delle API Meta va riconfermato al momento dell'implementazione, non dato per assodato sulla base di questa nota». Era anche il punto aperto #5 di `ARCHITECTURE.md` §17, in scadenza con questa fase. L'import da Facebook e Instagram era un **requisito iniziale esplicito** del manutentore: rinunciarci sulla base di una nota scritta cinque giorni prima, senza ricontrollare, sarebbe stato il modo di trasformare una ricerca in un pregiudizio.

**Decisione.** La conclusione regge, e ADR-0010 passa ad `Accettata`. Nessun import automatico. Il paste-to-parse resta la sostituzione.

**Che cosa dice oggi la documentazione Meta.** La reference dell'oggetto `Event` limita l'accesso in modo esplicito: leggere gli eventi di **Utenti e Pagine** è riservato ai Facebook Marketing Partner. Un'app terza può leggere solo gli eventi che ha creato lei stessa, con un token applicativo, e quelli di un Gruppo di cui chi chiede è amministratore, previa approvazione della Groups API. Nessuna delle tre strade serve al nostro caso, che è «leggere gli eventi che un'associazione ha pubblicato sulla propria Pagina».

**La motivazione è cambiata, la conclusione no.** ADR-0010 diceva «Meta ha deprecato la lettura pubblica degli eventi delle Pagine». Non è propriamente una deprecazione: l'endpoint esiste e funziona, ma dietro un programma di partnership commerciale a cui un calendario di venti circoli non accede. La differenza conta per una ragione sola, ed è che i due fatti scadono in modo diverso: una deprecazione non si annulla, una restrizione di accesso sì. Se un giorno il gruppo passasse da una struttura che è già Marketing Partner, la domanda si riaprirebbe — e si riaprirebbe comunque solo su Facebook.

Su Instagram non c'è niente da riverificare, ed è il punto più solido dei due: Instagram **non modella affatto** il concetto di evento. Non c'è un endpoint da chiedere, perché non c'è un oggetto da leggere. Un annuncio di concerto su Instagram è la didascalia di una foto, e l'unica cosa che si può farne è leggerla — che è precisamente ciò che fa il paste-to-parse.

**Alternative scartate.** Le stesse di ADR-0010, con un anno in meno di illusioni: lo scraping resta fragile e contro i ToS, e non è diventato meno fragile. Va aggiunta una alternativa che oggi esiste e allora no — **chiedere l'ingresso al programma Marketing Partner** — scartata senza esitazione: è un rapporto commerciale con Meta per un'associazione senza scopo di lucro, e metterebbe una dipendenza da un'approvazione discrezionale nel percorso critico di un prodotto costruito apposta per non averne (principio 4, «niente integrazioni fragili»).

**Conseguenze.** Il punto aperto #5 di §17 si chiude. ADR-0010 non è più provvisorio, quindi la Fase 5 può poggiarci sopra senza riserve.

**Da rivedere se.** Il gruppo si dota di una struttura che è già Marketing Partner, o Meta riapre la lettura pubblica degli eventi delle Pagine. Anche allora il guadagno sarebbe parziale: coprirebbe Facebook e non Instagram, e resterebbe una dipendenza da un'API che può richiudersi. Il paste-to-parse funzionerebbe comunque.

---

## ADR-0031 — L'import compila il form, e le tre cose che non decide

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §9 punto 3 dice che il risultato del parser «**pre-compila il form**, non crea l'evento. L'utente rivede e conferma sempre». È una frase chiara su *una* cosa — non si crea l'evento — e muta su tutto il resto. Scrivendo la mappatura verso il form sono emerse tre decisioni che un parser può prendere senza che nessuno se ne accorga, e che nessuna delle tre è sua:

1. **Lo stato.** Un post pubblico descrive una data annunciata. La lettura letterale sarebbe farla nascere `confirmed`.
2. **L'annuncio delle band.** Stessa logica: se il nome di una band è scritto in un post pubblico, quella band *è* annunciata, quindi `is_announced` dovrebbe essere vero.
3. **Il collegamento all'anagrafica.** Il parser legge «Bassa Marea»; in anagrafica c'è una scheda che si chiama esattamente così. Collegarla sembra ovvio.

Tutte e tre sono difendibili in astratto. Tutte e tre, sbagliando, non fanno rumore.

**Decisione.** Nessuna delle tre. Il bersaglio del parser (`$lib/schemas/parse.ts`) **non contiene affatto** i campi `status` e `isAnnounced`, e `versoIlForm()` lascia `artistId` vuoto su ogni riga di lineup. Le band riconosciute in anagrafica tornano a parte, come **proposte** accanto alla riga, con un pulsante per accettarle e uno per rifiutarle.

Che il campo non esista nello schema, invece di esistere e valere sempre `null`, non è una sottigliezza: è la differenza fra una regola e una consuetudine. Un campo che c'è viene prima o poi riempito da qualcuno che ha una buona ragione.

**Motivazioni.**

Sullo stato: **confermare significa annunciare**, ed è il momento che [ADR-0022](#adr-0022--una-data-si-conferma-anche-con-un-conflitto-aperto) protegge più di ogni altro — in cambio del non mettere cancelli davanti alla conferma, quell'ADR ha assunto l'impegno che chi conferma abbia visto l'avviso di conflitto. Una data che nasce già confermata da un incolla attraversa quel momento senza che nessuno ci sia passato. E il testo non è nemmeno una fonte attendibile su questo: un post promozionale scritto tre mesi prima non dice se la data è ancora in piedi oggi.

Sull'annuncio: `is_announced` è la rivelazione progressiva di [ADR-0005](#adr-0005--stato-hold-con-visibilità-ridotta), e la decide **chi porta la band**. Il fatto che un post altrui la nomini non è quella decisione. Il caso che chiarisce tutto è quello in cui l'incolla *non* è il proprio: un organizzatore che si copia negli appunti la locandina di un collega, per tenersi la data, non ha nessun titolo per marcare come annunciate quelle band nel proprio calendario. Al primo salvataggio quei nomi uscirebbero verso tutti — e non c'è nessun modo di rimetterli dentro.

Sul collegamento: è il più insidioso dei tre, perché è l'unico che sbaglia **in modo invisibile**. Se il parser collega «Fossa» alla scheda sbagliata fra due omonimi, il campo a schermo mostra comunque «Fossa»: non c'è niente da notare rivedendo il form. Il danno arriva dopo, nel motore conflitti, che confronta gli `artist_id` e non i nomi ([ADR-0006](#adr-0006--artisti-e-venue-come-entità-globali-condivise)) — o non fa scattare un doppio ingaggio vero, o ne segnala uno che non c'è. §9 punto 4 lo prescriveva già con parole diverse: «ogni match richiede conferma esplicita».

**Il criterio generale**, che vale anche per la quinta decisione che si presenterà: *il parser riempie i campi che una persona può verificare guardandoli; non tocca i campi il cui errore non si vede.* Il titolo sbagliato salta all'occhio. Un `artistId` sbagliato no.

**Un'eccezione apparente, che non lo è.** `venueId` **viene** riempito, ma solo su un nome identico a meno di accenti e punteggiatura, e solo se il candidato è uno solo. La somiglianza non basta di proposito: fra «Circolo Arci Lupo Bianco» e «Circolo Arci Lupo Grigio» la distanza di edit è minima e i due posti sono in due paesi diversi. La differenza con `artistId` è che il locale scelto **si vede nel form**, in un menù a tendina con il nome scritto sopra: è verificabile guardandolo, e rientra quindi nel criterio.

**Alternative scartate.**

- _Dedurre lo stato dal testo_ («è scritto "confermato"»): fa dipendere una transizione di stato dalla retorica di un post promozionale.
- _Riempire tutto e segnare i campi come «da rivedere»_: è la proposta che sembra prudente. Non lo è, per la stessa ragione per cui una casella con l'avvertenza accanto si spunta ([ADR-0029](#adr-0029--il-feed-ics-non-contiene-le-bozze)): un campo pre-compilato si conferma, e più il form è lungo — trenta campi — più si conferma in blocco.
- _Collegare le band con un solo candidato e proporre solo gli ambigui_: è esattamente il caso in cui il collegamento è più difficile da mettere in dubbio, e in cui un omonimo non ancora in anagrafica produrrebbe un collegamento sbagliato senza nessun segnale.
- _Marcare `is_announced` quando l'incolla è del proprio evento_: richiederebbe di sapere di chi è il post, che è precisamente ciò che un testo incollato non dice.

**Conseguenze.**

- `bersaglioParse` non ha i campi `status` e `isAnnounced`, e non deve acquisirli. È il posto dove la decisione è espressa in modo che non si possa aggirare distrattamente, come `filtriFeed` lo è per [ADR-0029](#adr-0029--il-feed-ics-non-contiene-le-bozze).
- I test in `parse-to-form.test.ts` hanno una sezione apposta, «ciò che resta di una persona», con una asserzione per ciascuna delle tre. Sono i test che vanno letti per primi se un giorno qualcuno si chiederà perché l'import «non finisce il lavoro».
- Il pannello dell'incolla elenca **che cosa ha riempito** e **che cosa non ha saputo collocare**. La seconda metà conta più della prima: un campo lasciato vuoto senza dirlo si legge come «nel testo non c'era», e chi rivede non va a ricontrollare.
- Il collegamento all'anagrafica resta un'operazione a due clic. È il costo che questa decisione ha, e si paga una volta per band.

**Da rivedere se.** Gli organizzatori collegano *sempre* la prima proposta senza guardare. Vorrebbe dire che la conferma esplicita è diventata un rituale, e a quel punto il rimedio non è collegare da soli — è capire perché le proposte sono così scontate, e semmai mostrarne di meno.

---

## ADR-0032 — Il testo incollato ha una scadenza

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §9 punto 5 prescrive che «il job resta in `parse_jobs` per debug e per misurare la qualità dell'estrazione», e §4.6 dà alla tabella una colonna `raw_text`. Nessuno dei due dice per quanto.

Il punto è che `raw_text` non è un dato che questo prodotto raccoglie: è un dato che gli **arriva addosso**. Un annuncio di concerto contiene con regolarità dati personali di terzi — il numero di chi prende le prenotazioni, il nome di chi ospita il gruppo per la notte, ogni tanto un indirizzo di casa — e nessuna di quelle persone ha idea che un calendario di circoli ne stia tenendo copia. §16 impone «dati personali minimi», e una tabella che cresce per sempre non è il minimo di niente.

**Decisione.** I job vivono **90 giorni**, poi vengono cancellati per intero, riga compresa. La pulizia la fa `POST /api/cron/purge`, chiamato dalla stessa GitHub Action notturna che ricalcola i conflitti.

**Motivazioni.** I due usi previsti da §9 hanno entrambi una vita breve. Il debug serve quando qualcuno dice «me l'ha compilato male», e lo dice nei giorni successivi, non l'anno dopo. La misura della qualità è una tendenza, e un trimestre di storico basta a vederla: se l'estrazione peggiora perché è cambiato il modello, si vede in settimane. A 90 giorni quel testo non serve più a nessuno dei due scopi e resta soltanto un rischio.

**Perché si cancella la riga e non solo il testo.** Svuotare `raw_text` e tenere il resto sembra il compromesso: si conserverebbero le statistiche. Ma senza il testo di partenza un job non dice più niente di utile — «un'estrazione con questo modello è andata bene» non è un dato su cui si decida qualcosa — e una tabella di gusci vuoti è un modo di non prendere la decisione invece che di prenderla. Se un giorno serviranno metriche a lungo termine, la cosa da tenere è un conteggio aggregato, che non contiene testo di nessuno.

**Perché un endpoint a parte e non dentro `/api/cron/recompute`.** Un endpoint che si chiama «ricalcola» e che cancella righe è la sorpresa che qualcuno troverà fra sei mesi leggendo il codice per un altro motivo. Due endpoint distinti costano un secondo `curl` nello stesso workflow; **non** costano un secondo scheduler, il che li tiene dentro [ADR-0013](#adr-0013--monolite-nessuna-coda-nessun-servizio-accessorio).

**Alternative scartate.**

- _Nessuna scadenza_: è ciò che succede se non si decide, ed è la risposta sbagliata per una tabella che contiene testo altrui.
- _Cancellare subito dopo aver compilato il form_: toglie di mezzo il debug, che è il primo dei due usi che §9 chiede.
- _Chiedere il consenso a chi incolla_: sposta su un modulo una decisione che ha una risposta sola, e comunque non è la persona incollata a firmarlo.
- _Trenta giorni_: coprirebbe il debug ma non la tendenza, e il primo mese di un parser nuovo è quello meno rappresentativo di tutti.

**Conseguenze.**

- I job si registrano per **tutte e tre** le sorgenti, non solo per il testo libero: un `.ics` letto male è un difetto del nostro codice, e senza il file di partenza non si riproduce. La scadenza vale per tutti allo stesso modo.
- La GitHub Action notturna ora fa due chiamate, e il file `recompute-conflicts.yml` si chiama ancora così pur descrivendo una manutenzione più larga. Rinominarlo perderebbe lo storico delle esecuzioni su GitHub; l'intestazione del file lo dice.
- `parse_jobs` ha l'indice `(profile_id, created_at)`, che serve a due cose insieme: la cancellazione per data e il conteggio del limite orario di ADR-0034.

**Da rivedere se.** Serve ricostruire un caso più vecchio di tre mesi. Sarebbe successo qualcosa di abbastanza grave da giustificare la domanda opposta — e la risposta giusta a quel punto non è allungare la conservazione, è capire perché non ce ne si è accorti prima.

---

## ADR-0033 — Un incolla, una data

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** Un `.ics` contiene quasi sempre più di un `VEVENT`, e un CSV più di una riga — a partire dal nostro export, che ne scrive una per evento in tutta la finestra richiesta. La domanda si è posta scrivendo i due parser deterministici: che cosa fare del secondo, del terzo, del quarantesimo.

La tentazione dell'import massivo è forte proprio qui, perché è il caso in cui i dati sono **puliti**: da un `.ics` non c'è niente da indovinare, i campi sono già separati, e creare quaranta date in un colpo sarebbe evidentemente comodo.

**Decisione.** Si legge il **primo** evento del file, o la **prima** riga di dati, e basta. Il totale viene contato e **detto**: «il file conteneva 12 date: qui c'è solo la prima».

**Motivazioni.** Un import massivo è, per definizione, la creazione di eventi che nessuno ha guardato uno per uno. È esattamente ciò che §9 punto 3 esclude — «l'utente rivede e conferma sempre» — e la pulizia dei dati non è un argomento contro: [ADR-0031](#adr-0031--limport-compila-il-form-e-le-tre-cose-che-non-decide) mostra che le decisioni che il parser non deve prendere non riguardano la qualità dell'estrazione, riguardano *chi decide*. Uno stato, un annuncio di band, un collegamento all'anagrafica sono da rivedere anche quando i campi sono perfetti. Moltiplicarli per quaranta li rende quaranta volte meno rivedibili.

Il caso concreto che chiude la questione: quaranta date importate in blocco entrano tutte insieme nel motore conflitti, e ogni conflitto che ne esce arriva a **un'altra organizzazione** sotto forma di avviso. Un import sbagliato non produce solo righe sbagliate nel proprio calendario — manda avvisi falsi a persone che non hanno incollato niente. È il modo più rapido di far smettere agli altri di leggere gli avvisi ([ADR-0021](#adr-0021--la-sovrapposizione-fra-artisti-si-misura-in-giorni-non-in-due-settimane)).

**Perché la prima e non un'altra.** «La prima del file» è arbitraria e prevedibile; «la prima in ordine di data» o «la più vicina a oggi» sarebbero meno arbitrarie e meno prevedibili. Fra le due proprietà, per un'operazione che si ripete, vince la prevedibilità: chi importa un file di dieci date incollandolo dieci volte deve poter sapere quale ottiene, senza ragionarci.

**Perché il conteggio va detto.** Un file con dieci date di cui ne compare una, senza spiegazione, non si legge come una scelta: si legge come un parser rotto. È la stessa ragione per cui l'anteprima dei conflitti distingue «nessun conflitto» da «non ho potuto controllare» ([ADR-0025](#adr-0025--il-motore-ignora-le-bozze-le-date-annullate-e-quelle-senza-coordinate)).

**Alternative scartate.**

- _Creare tutte le date del file_: import massivo senza revisione, vedi sopra.
- _Mostrare un elenco e far scegliere quali importare_: è l'import massivo con un passaggio in più, e il passaggio in più è una spunta — che si dà in blocco.
- _Importare la prima e tenere le altre in coda per il salvataggio successivo_: comodo, ma richiede di conservare da qualche parte lo stato di un import a metà, e un import a metà abbandonato è una cosa che nessuno ricorda di aver lasciato aperta.
- _Rifiutare i file con più di un evento_: onesto ma inutilmente rigido, e costringerebbe a ritagliare a mano un `.ics`, che è esattamente il lavoro che questa funzione doveva togliere.

**Conseguenze.**

- `leggiIcs()` e `leggiCsv()` restituiscono un totale accanto al bersaglio. È l'unica ragione per cui non restituiscono soltanto il bersaglio.
- Chi ha davvero dieci date da caricare le carica in dieci volte. È lento, e va bene che lo sia: dieci date nuove in un calendario condiviso sono dieci notizie per gli altri iscritti.

**Da rivedere se.** Qualcuno arriva con un archivio storico vero da caricare — una stagione intera già passata, per avere lo storico nel calendario. È un caso diverso da questo: sono date **passate**, che non generano conflitti e non avvisano nessuno. Meriterebbe uno strumento suo, non un allentamento di questa regola.

---

## ADR-0034 — Claude Haiku con schema forzato dall'API; MusicBrainz resta fuori dall'incolla

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §9 fissa i vincoli del parser — «modello economico (classe Haiku/Flash), timeout 20 s, rate limit per profilo, il fallimento non blocca mai l'inserimento manuale», costo dell'ordine di 1-2 € l'anno — e §14 dichiara `LLM_API_KEY` e `LLM_MODEL` senza nominare nessun fornitore. Restavano da decidere il fornitore, il modo di ottenere un JSON conforme allo schema, e che fare del punto 4 di §9, che prescrive di cercare le band «in anagrafica **e in MusicBrainz**».

**Decisione.**

1. **Claude Haiku 4.5** tramite l'SDK ufficiale `@anthropic-ai/sdk`, con `LLM_MODEL` che resta l'unica cosa da cambiare per usarne un altro.
2. Lo schema è **forzato dall'API** (`output_config.format` costruito da `bersaglioParse` con `zodOutputFormat`), non chiesto nel prompt.
3. **MusicBrainz non entra nell'incolla.** Le band si cercano nella sola anagrafica locale.
4. Il rate limit di §16 si legge da `parse_jobs`: 20 riconoscimenti a modello per profilo all'ora.

**Motivazioni.**

Sul modello: `$1/$5` per milione di token, su un post di duemila caratteri, tiene la stima di §9 dove sta. È la lettura letterale di «classe Haiku», e la scelta è stata confermata dal manutentore quando gli è stata riproposta insieme all'alternativa più capace. Che resti in una variabile d'ambiente non è pigrizia nel decidere: l'estrazione da un post scritto male è precisamente il caso in cui un modello migliore si sente, e il giorno in cui servisse dev'essere una riga di configurazione, non un rilascio.

Sullo schema forzato, che è il punto tecnico che conta di più: l'alternativa storica — chiedere «rispondi solo con JSON» e poi estrarre il JSON dal testo con una regex — porta con sé un ciclo di riprova, un parser tollerante e una classe di guasti che si presenta sul post più strano, cioè quello per cui la funzione serviva. Vincolare la risposta allo schema toglie di mezzo l'intero problema: non c'è niente da estrarre e niente da perdonare. Lo schema resta comunque **rivalidato** con `safeParse` al ritorno, perché il contenuto arriva dalla rete e da lì in poi entra in un form; costa una validazione su un oggetto piccolo.

Su MusicBrainz: la policy del servizio ammette **una richiesta al secondo**, ed è il motivo per cui `musicbrainz/index.ts` porta già scritto che non è «un servizio da interrogare a ogni tasto premuto». Una locandina con cinque band vorrebbe dire cinque secondi di attesa sotto un form, per candidati che [ADR-0031](#adr-0031--limport-compila-il-form-e-le-tre-cose-che-non-decide) impone comunque di confermare a mano. Il bisogno vero dietro il punto 4 — che una band nuova entri in anagrafica **con il suo MBID**, perché è quella la chiave di deduplica di [ADR-0006](#adr-0006--artisti-e-venue-come-entità-globali-condivise) — è già servito, e meglio, da `/artists/new`, dove la ricerca MusicBrainz esiste ed è a richiesta esplicita, una band per volta.

Sul rate limit: qui è più stretto che sugli altri endpoint di §16 per una ragione che gli altri non hanno — **questa chiamata costa denaro**. Il conteggio si legge da `parse_jobs` e non da un contatore in memoria perché su Cloudflare gli isolate vanno e vengono, e un limite che si azzera a ogni risveglio non è un limite. Nessun Redis, coerentemente con [ADR-0013](#adr-0013--monolite-nessuna-coda-nessun-servizio-accessorio): la tabella e il suo indice ci sono già.

**Alternative scartate.**

- _HTTP grezzo senza SDK_, per tenere il fornitore sostituibile: la sostituibilità è già dove serve, cioè nel fatto che tutto il resto della cartella `parse/` non sa che esiste un modello. `llm.ts` è un file solo, e riscriverlo per un altro fornitore è mezza giornata; farne a meno costerebbe l'output forzato dallo schema, che è il pezzo che rende la cosa affidabile.
- _Un modello più capace di default_: proposto al manutentore insieme a Haiku, con il moltiplicatore di costo accanto. Scartato da lui.
- _Chiedere il JSON nel prompt e validare a valle_: vedi sopra. È l'errore che sembra portatile e non lo è.
- _Interrogare MusicBrainz in parallelo per aggirare il rate limit_: significa violare deliberatamente la policy di un servizio gratuito che questo progetto usa già altrove. Farsi bloccare l'IP romperebbe anche l'inserimento artisti, che funziona.
- _Un contatore in memoria per il rate limit_: non sopravvive a un isolate, e il caso da cui il limite difende — un ciclo impazzito — è proprio quello che genera abbastanza traffico da farne nascere di nuovi.

**Conseguenze.**

- Nuova dipendenza in `package.json`: `@anthropic-ai/sdk`. È la prima dipendenza di runtime verso un servizio a pagamento del progetto.
- **Senza `LLM_API_KEY` il testo libero non si legge, ma `.ics` e CSV sì.** Il pannello lo dice invece di offrire un pulsante che non risponde: sono due strade indipendenti, e una configurazione mancante non deve spegnere quella che non ne ha bisogno.
- Il prompt sta in `parse/prompt.ts`, senza I/O, per la stessa ragione per cui ci stanno le regole del motore conflitti: decide che cosa finisce nel form, e si legge meglio se non è annegato in una chiamata di rete.
- Il testo incollato viaggia dentro una delimitazione esplicita, con l'istruzione di trattarlo come dato e non come istruzioni. Non è una difesa completa — non ne esistono — ma il danno possibile è limitato per costruzione: l'unico effetto della risposta è pre-compilare campi che una persona rivede, e nessun campo del bersaglio è un'azione.

**Da rivedere se.** Le estrazioni sbagliano abbastanza da far preferire l'inserimento manuale. Il primo rimedio è `LLM_MODEL`, non il codice; il secondo è il prompt. Si legge da `parse_jobs`, finché non scade ([ADR-0032](#adr-0032--il-testo-incollato-ha-una-scadenza)).

> **Segnalazione (2026-08-24, poche ore dopo).** Il manutentore prevede di mettere in piedi un server in casa con un LLM ospitato in locale. Se succede, questa voce va rifatta e non ritoccata: cambierebbero il fornitore, il modo di forzare lo schema e il profilo di affidabilità. È la decisione #7 dell'elenco in fondo. Per questo la messa a punto del prompt è stata **sospesa** invece che completata: un prompt tarato su Haiku non si trasferisce a un modello da 7-14 miliardi di parametri, che è la taglia che gira su una macchina di casa.

---

## ADR-0035 — Una notifica nasce già redatta, per un destinatario solo

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §10 elenca cinque motivi per cui il calendario si fa vivo, e chiude con una riga che vale per tutti: «Le email di conflitto rispettano la matrice di visibilità: mai includere dettagli di un evento in `hold` altrui». Il problema è che la matrice non è una proprietà del conflitto, è una relazione fra il conflitto e **chi guarda**: lo stesso `artist_overlap` si racconta a un'organizzazione col nome della band e all'altra non si racconta affatto ([ADR-0024](#adr-0024--i-conflitti-si-rilevano-sui-dati-interi-e-si-redigono-in-uscita)). Una notifica, però, è una riga in una tabella, e una riga non ha un lettore: ce l'ha nel momento in cui viene scritta e mai più.

**Decisione.** Il `payload` di `notifications` contiene **il testo definitivo**, redatto al momento della nascita per quel destinatario, e non gli identificativi da cui ricavarlo. La costruzione degli avvisi passa da `serializeConflict`/`serializeEvent` come qualunque altra uscita, e **se la serializzazione restituisce `null` non nasce nessuna riga**: niente email senza nomi, niente avviso vuoto — proprio niente.

Il corollario pratico: un conflitto si serializza **una volta per organizzazione**, non una per persona. La visibilità dipende solo dall'appartenenza e non dal ruolo né dall'identità (§5), quindi due membri dello stesso circolo hanno per costruzione lo stesso avviso.

**Motivazioni.**

La redazione al momento della lettura sembra più pulita — una sola fonte di verità, la riga si rilegge sempre aggiornata — ma non regge alla prova più semplice: **l'email è già partita.** Se il payload contenesse solo `conflictId` e la pagina lo redigesse alla lettura, il testo in casella e il testo in pagina potrebbero divergere il giorno in cui qualcuno entra o esce da un'organizzazione. E divergerebbero nella direzione sbagliata: la riga in-app si stringerebbe, l'email già consegnata no.

Congelare il testo ha anche una conseguenza che vale da sola: **la pagina degli avvisi non ha nessun filtro di visibilità da applicare**. È l'unico posto dell'applicazione dove quella frase è vera, ed è vera perché il filtro è stato applicato prima. Il `WHERE` sul proprio `profile_id` basta.

Sul `null`: togliere il nome della band non basta, perché il conflitto stesso è l'informazione. Se l'organizzazione che ha annunciato Opeth ricevesse «una band della tua lineup suona anche altrove», saprebbe che l'altra l'ha ingaggiata — che è esattamente il segreto di [ADR-0005](#adr-0005--stato-hold-con-visibilità-ridotta). È il caso di test obbligatorio di §15, e in `tests/unit/notifications.test.ts` è il primo.

**Alternative scartate.**

- _Payload con soli id, testo calcolato alla lettura._ Vedi sopra: l'email non si riscrive.
- _Una notifica per organizzazione invece che per profilo._ Sarebbe meno righe, ma `read_at` è per persona: «l'ho già visto» è una proprietà di chi guarda, non del circolo.
- _Redigere una volta sola per conflitto e mandare a tutti._ È l'errore che il layer esiste per non fare.
- _Notificare solo chi ha inserito la data._ Un avviso grave si perderebbe perché quella settimana quella persona era in tour. Si avvisa l'organizzazione.

**Conseguenze.**

- `notifications.payload` è testo denormalizzato e invecchia: se un moderatore corregge il nome di una band ([ADR-0016](#adr-0016--il-ruolo-moderator-esiste-dalla-v1-ed-è-trasversale-alle-organizzazioni)), gli avvisi già scritti conservano quello vecchio. È il prezzo, ed è lo stesso di qualunque messaggio già spedito.
- La casella degli avvisi vive a `/notifications` e le preferenze a `/settings/notifications`. La prima non è in §7 perché la specifica dava per scontata la tabella senza dire dove si leggesse.
- I sink sono **solo canali in uscita**: oggi l'email, domani forse Telegram (decisione aperta #6). L'in-app non è un sink e non è una dimenticanza — non esce da nessuna parte, è la riga stessa.
- L'invito è l'unica notifica **fuori dal layer**: arriva a un indirizzo senza profilo, non ha una `profile_id` da mettere in tabella né preferenze da consultare, e va diritto al sink email.

**Da rivedere se.** Serve una notifica il cui testo debba cambiare dopo l'invio — per esempio un riepilogo che si aggiorna invece di ripetersi. In quel caso non è questa decisione a essere sbagliata: è quella notifica a non essere una notifica.

---

## ADR-0036 — La tabella delle notifiche è anche la coda di uscita delle email

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** §10 chiede un'«email immediata» per i conflitti gravi. Immediata significa spedita dentro la richiesta che salva la data, e una richiesta che salva una data non può dipendere da un servizio esterno: [ADR-0013](#adr-0013--monolite-nessuna-coda-nessun-servizio-accessorio) esclude una coda, e il principio 5 di §2 pretende che il fallimento di un servizio accessorio non tolga niente a chi sta lavorando. Restava da decidere che fine fa un'email che non parte.

**Decisione.** La riga in `notifications` si scrive **sempre**, prima di qualunque tentativo di invio, e porta due colonne in più rispetto a §4.6: `email_requested` — una copia per posta era prevista e non rifiutata nelle preferenze — ed `emailed_at`. Le righe con la prima vera e la seconda a `NULL` sono le email dovute e mai partite, e la corsa notturna (`/api/cron/notify`) le ritenta per tre giorni. La terza colonna in più, `dedupe_key`, è un **indice unico** `(profile_id, dedupe_key)`: è il database a garantire che un avviso non si ripeta, non un controllo in JavaScript.

**Motivazioni.**

Una coda vera non serve: la coda **esiste già** ed è la tabella che comunque va scritta per l'in-app. Aggiungerci due colonne costa due colonne; aggiungere Redis o un servizio di code costerebbe una dipendenza operativa a un manutentore part-time, che è precisamente ciò che ADR-0013 vieta.

Il taglio a tre giorni non è arbitrario. Senza, il primo giorno in cui una chiave scaduta torna valida quaranta persone riceverebbero in blocco gli avvisi di due settimane — e un avviso su un conflitto di sabato scorso non è un avviso, è rumore che insegna a non leggere i prossimi.

Sulla deduplica in SQL invece che in codice: il ricalcolo notturno ripassa ogni notte sulle stesse coppie, e il sollecito di annuncio è una scansione che riguarda le stesse date finché non cambiano. Un controllo letto-poi-scritto passerebbe due volte se due corse si sovrapponessero, che è esattamente la sera in cui qualcuno rilancia il job a mano perché il primo è fallito. L'indice unico non ha questo problema, e `dedupe_key` a `NULL` — gli avvisi che nascono da un fatto puntuale — passa sempre, perché in Postgres due `NULL` non si considerano uguali.

**Alternative scartate.**

- _Spedire e basta, senza traccia._ Il caso vero non è la rete che cade una volta: è la chiave sbagliata in produzione che nessuno nota per una settimana. Con `email_error` in tabella si vede; senza, si scopre quando qualcuno dice «non mi è mai arrivato niente».
- _Una tabella `email_outbox` separata._ Le stesse righe scritte due volte, per distinguere due cose che sono lo stesso avviso.
- _Ritentare all'infinito._ Vedi sopra: la valanga.
- _Nascondere in-app gli avvisi che §10 manda solo per email_ (digest, solleciti). Sarebbe un filtro il cui unico effetto è far dimenticare all'applicazione di aver scritto a qualcuno. La tabella di §10 decide l'**email**; la riga c'è comunque.

**Conseguenze.**

- Senza `RESEND_API_KEY` in locale non succede niente di rumoroso: le righe restano in coda e il registro non si riempie di errori. È lo stato normale di uno sviluppo.
- L'esito di ogni corsa periodica è nel JSON di risposta (`registrate`, `ripetuti`, `emailSpedite`, `emailFallite`): è l'unico modo di sapere da fuori se una notte ha fatto qualcosa.
- La consegna è **per blocco e non per indirizzo**: Resend accetta cento messaggi per richiesta, e su Cloudflare ogni `fetch` è una subrequest con un bilancio finito. Un digest a quaranta iscritti è una richiesta, non quaranta. Ciò che accade dopo l'accettazione — un rimbalzo, una casella piena — non è visibile da qui e non lo sarebbe nemmeno spedendo uno alla volta.
- Le notifiche scadono a 180 giorni con `/api/cron/purge`. È una scadenza diversa da quella di [ADR-0032](#adr-0032--il-testo-incollato-ha-una-scadenza) e per un motivo diverso: là dentro non c'è niente che il destinatario non potesse già vedere, ma una casella che cresce all'infinito è una casella che nessuno apre.

**Da rivedere se.** Il numero di iscritti cresce al punto che un digest non sta in una richiesta HTTP. A quel punto serve un job che pagina, non una coda.

> **Verificata (2026-08-25), e sul caso migliore possibile.** Un digest scritto il 24 agosto era rimasto in coda perché il canale di allora — l'email — non era mai stato configurato. Quando il canale è cambiato del tutto ([ADR-0039](#adr-0039--il-canale-delle-notifiche-è-telegram-non-lemail)) e la chat è stata collegata, la prima corsa di `/api/cron/notify` l'ha consegnato da sé: `consegnate: 1`, `consegnata_at` valorizzato, `errore_consegna` a `NULL`. **Un avviso nato quando non esisteva nessun canale, consegnato dal canale arrivato dopo, senza che nessuno lo rimettesse in coda.** Non era stato costruito per questo caso — era stato costruito per un servizio che ogni tanto non risponde — e ha retto il caso più estremo che potesse capitargli.

---

## ADR-0037 — Il rate limit degli altri due endpoint sta in una tabella, non in `parse_jobs`

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §16 chiede un rate limit «su `/api/parse`, `/api/geocode` e `/api/ics/[token]` per profilo/token». Il primo esiste dalla Fase 5 e si conta leggendo `parse_jobs` ([ADR-0034](#adr-0034--claude-haiku-con-schema-forzato-dallapi-musicbrainz-resta-fuori-dallincolla)), perché quelle righe esistono comunque per un altro motivo. Gli altri due non hanno nessuna riga da contare: il geocoding scrive in `geocode_cache`, che è indicizzata sulla query e non sa di chi sia; il feed aggiorna `calendar_feeds.last_accessed_at`, che conserva l'ultimo accesso e non quanti.

**Decisione.** Una tabella `rate_limits` con tre colonne — `bucket` (PK), `hits`, `expires_at` — e una finestra **fissa** di un'ora codificata nella chiave. L'incremento è un `INSERT … ON CONFLICT DO UPDATE … RETURNING`, atomico. I limiti: 60 all'ora per profilo sul geocoding, 24 all'ora per token sul feed. Le righe scadute le porta via `/api/cron/purge`.

**Motivazioni.**

Sul perché nel database e non in memoria, vale parola per parola ADR-0034: su Cloudflare gli isolate vanno e vengono, e un limite che si azzera a ogni risveglio non è un limite — e il caso da cui difende, un ciclo impazzito, è proprio quello che genera abbastanza traffico da farne nascere di nuovi. Nessun Redis, coerentemente con [ADR-0013](#adr-0013--monolite-nessuna-coda-nessun-servizio-accessorio).

Sulla finestra fissa invece che scorrevole: costa un caso limite noto — a cavallo di due finestre si possono fare quasi il doppio delle richieste — e in cambio non richiede di conservare la storia delle singole richieste. Contro un ciclo, le due fanno lo stesso lavoro; contro un attaccante paziente nessuna delle due basterebbe, e non è la minaccia di un calendario fra venti circoli.

Sull'incremento atomico: la versione che viene in mente per prima — leggi il contatore, decidi, scrivi — lascia passare entrambe le richieste proprio quando arrivano insieme, cioè nell'unico momento in cui il limite serve.

Sul valore dei limiti, che sono due numeri diversi perché difendono da due cose diverse. Il geocoding è un **proxy** verso Photon e Nominatim, che hanno una policy d'uso: chi esagera fa bloccare l'IP a tutto il progetto, e a rimetterci sarebbe anche l'inserimento dei locali, che funziona. Il feed è l'unico endpoint pubblico che restituisce dati, con `REFRESH-INTERVAL` a dodici ore: ventiquattro letture l'ora lasciano spazio a più client sullo stesso token — telefono, portatile, Google e Apple insieme — e a qualche ricarica a mano mentre si prova, e restano lontanissime da un uso legittimo.

**Alternative scartate.**

- _Riusare `calendar_feeds.last_accessed_at` come limite di frequenza_ («non più di una lettura al minuto»). Sarebbe stato zero righe di schema, ma è un limite sul ritmo e non sul volume, e con quattro client sottoscritti allo stesso feed il quinto legittimo verrebbe rifiutato.
- _Contare per IP._ Dietro Cloudflare l'IP c'è, ma i client calendario di Google escono da un pool condiviso: si limiterebbe Google, non chi abusa.
- _Estendere `parse_jobs` con una colonna «risorsa»._ Quella tabella esiste per il debug delle estrazioni e per misurarne la qualità; riempirla di righe che non sono estrazioni renderebbe inutile la cosa per cui è stata fatta.
- _Nessun limite sul feed, dato che il token è un segreto._ Un segreto in un URL finisce nella cronologia, in un `Referer`, in un incolla su un gruppo. Il limite serve dopo, non prima.

**Conseguenze.**

- Una richiesta in più al database per ogni chiamata a `/api/geocode` e `/api/ics/[token].ics`. A questi volumi non si misura.
- **Se il contatore non risponde, si lascia passare.** Un limite mancato è un rischio più piccolo di un feed sottoscritto che smette di aggiornarsi perché una tabella accessoria ha un problema.
- Il feed risponde **429, mai un 200 vuoto**. La differenza non è formale: un calendario vuoto servito a Google cancella tutte le date già importate, ed è il guasto peggiore che quell'endpoint possa produrre — lo stesso motivo per cui non ha un `try` intorno.
- `/api/parse` resta com'era. Le due strade coesistono e la ragione è la stessa in tutte e due le direzioni: si contano le righe che esistono già, e si crea una riga solo quando non esiste.

**Da rivedere se.** Serve un limite su qualcosa che non ha un'identità stabile da mettere nella chiave — cioè un endpoint pubblico e anonimo. Oggi non ce ne sono: il feed ha il token.

---

## ADR-0038 — Gli smoke test girano contro il database vero, si puliscono da soli e restano fuori dalla CI

**Data:** 2026-08-24 · **Stato:** Accettata

**Contesto.** `ARCHITECTURE.md` §15 chiede uno smoke E2E su «invito → registrazione → creazione evento → comparsa conflitto per la seconda organizzazione → sottoscrizione feed ICS». È il percorso che attraversa tutto il prodotto, e nessuno dei suoi passaggi si può provare con un test unitario: quello che verifica non è una funzione, è che i pezzi giusti siano collegati fra loro. Serviva decidere **contro cosa** farlo girare, dato che il progetto ha un solo database ([ADR-0002](#adr-0002--supabase-come-database-auth-e-storage)) e nessun ambiente di prova separato.

**Decisione.**

1. Gli smoke test girano contro il **database di sviluppo vero** e un dev server vero.
2. Tutto ciò che creano porta il prefisso `e2e-`, e un progetto di `teardown` di Playwright lo rimuove — **anche quando i test falliscono**.
3. Il login passa dalla **porta vera**: un `token_hash` generato con il ruolo di servizio e appeso a `/auth/callback`, cioè esattamente ciò che finisce nel magic link.
4. **Non girano in CI.** Si lanciano da locale con `npm run test:e2e`.

**Motivazioni.**

Un secondo progetto Supabase per i test costerebbe un'altra istanza da migrare, da seminare e da tenere allineata a ogni cambio di schema, a un manutentore part-time che ne ha già una. Un Postgres in container in CI risolverebbe il database ma non l'auth, che è un servizio gestito: resterebbe da simulare la parte del flusso che più spesso si rompe.

Il prefisso non è cosmetico: è ciò che permette alla pulizia di essere chirurgica invece che un `truncate`, e quindi di lanciare i test sul database dove il manutentore tiene i dati di demo senza portarglieli via. La verifica dopo il primo giro è stata proprio questa — zero righe residue con quel prefisso.

Sul login dalla porta vera: iniettare i cookie di sessione a mano sarebbe stato più corto e avrebbe reso i test ciechi proprio su `/auth/callback`, che è il pezzo con più modi di rompersi (PKCE, template email, link già consumato — vedi il file stesso). Un test che aggira la cosa più fragile del sistema prova tutto tranne quello.

Sulla CI: farli girare lì significherebbe mettere `SUPABASE_SERVICE_ROLE_KEY` fra i secret del repository. Quella chiave scavalca RLS e apre l'intero database, e in un repository che accetta pull request — anche solo teoricamente, da un fork — è un rischio sproporzionato rispetto al vantaggio. La CI continua a fare lint, typecheck, test unitari e build, che è dove stanno i controlli che devono girare a ogni commit.

**Alternative scartate.**

- _Un secondo progetto Supabase._ Vedi sopra: raddoppia le migrazioni e i seed.
- _Postgres in container più auth simulata._ Risolve la metà facile.
- _Cookie iniettati a mano._ Rende ciechi sul pezzo più fragile.
- _Girare in CI con i secret._ Il costo è la chiave che apre tutto; il beneficio è accorgersi prima di una rottura che, a questi ritmi di rilascio, si scopre comunque prima del deploy.
- _Nessun teardown, database di test usa e getta._ Non esiste un database usa e getta: è il punto di partenza.

**Conseguenze.**

- Gli smoke test sono **lenti** (una quarantina di secondi) e girano **uno alla volta**: condividono un database, e due che inseriscono la stessa data la stessa sera si darebbero fastidio a vicenda.
- Vanno lanciati **prima di un rilascio**, non a ogni commit. Il [runbook](RUNBOOK.md) lo dice.
- Il primo giro ha già trovato una cosa che nessun test unitario poteva vedere: riempire il form evento subito dopo il caricamento non funziona, perché l'idratazione di Svelte rimette a ogni campo il valore della sua prop. Il sintomo era un fallimento lontanissimo dalla causa, con davanti lo screenshot di un modulo vuoto.
- Servono `SUPABASE_SERVICE_ROLE_KEY` e `DATABASE_URL` in `.env`: senza, i test si fermano dicendolo invece di fallire in modo oscuro.

**Da rivedere se.** Il repository si apre a contributi esterni, o il calendario va in produzione con dati di organizzatori veri. Nel primo caso serve la CI e quindi un ambiente separato; nel secondo, il database di sviluppo smette di essere un posto dove far girare qualcosa che crea e cancella righe.

---

## ADR-0039 — Il canale delle notifiche è Telegram, non l'email

**Data:** 2026-08-25 · **Stato:** Accettata · **Chiude:** decisione aperta #6

**Contesto.** La Fase 6 aveva costruito il layer di notifica di §10 con l'email come unico sink, e l'aveva consegnato senza che una sola email fosse mai partita: serviva una `RESEND_API_KEY` che non c'era. Andando a configurarla è emerso il vero ostacolo, che non è la chiave.

**Per mandare email a destinatari arbitrari serve un dominio verificato.** Non è una politica di Resend: è SPF e DKIM, cioè il modo in cui si dimostra di essere autorizzati a scrivere a nome di un dominio. Postmark, Brevo, Mailgun, SendGrid chiedono tutti la stessa cosa, e chi non la chiedesse manderebbe la posta dritta nello spam. Il mittente condiviso di Resend (`onboarding@resend.dev`) consegna **solo all'indirizzo con cui ci si registra**: basta a provare l'integrazione, non a usarla.

Si è verificato anche il piano gratuito di Cloudflare, dove l'applicazione è comunque destinata a girare. Cloudflare Email Service esiste dall'aprile 2026 e fa invio transazionale, ma sul piano gratuito consegna **solo a indirizzi verificati uno per uno**; per i destinatari arbitrari vuole Workers Paid, 5 $ al mese. Il piano gratuito di Resend, con un dominio verificato, è più generoso: stessa quota di 3.000 messaggi al mese, destinatari arbitrari, zero euro.

Restava quindi un dominio da comprare — una decina di euro l'anno — e il manutentore ha deciso di non farlo ora.

**Decisione.** L'email esce dal prodotto. Il canale di consegna diventa **Telegram**, tramite un bot. Contestualmente:

1. Il sink Resend, l'email di invito e le variabili `RESEND_API_KEY`/`EMAIL_FROM` sono rimossi.
2. Le colonne che nominavano l'email sono **rinominate**, non ricreate: `email_requested`, `emailed_at` ed `email_error` diventano `consegna_richiesta`, `consegnata_at` ed `errore_consegna`; le tre preferenze perdono il prefisso `email_`.
3. `NotificationSink.consegna()` riceve il `Database`: **il sink si ricava da sé dove consegnare**.
4. L'**invito** perde ogni canale e torna a essere un link da passare a mano.

**Motivazioni.**

Telegram è gratuito, non chiede domini né record DNS, e la community degli organizzatori quel canale ce l'ha già aperto sul telefono — che è esattamente l'osservazione con cui `ARCHITECTURE.md` §10 aveva messo l'ipotesi Telegram nel documento fin dall'inizio. Il vincolo «zero euro» la trasforma da aggiunta gradita nella risposta principale.

Sulle **rinomine invece delle sostituzioni**: le righe in coda restano in coda e cambiano solo nome, così il canale nuovo le riprende da dove l'email le aveva lasciate. Ed è anche la ragione per cui i nomi nuovi non citano nessun canale — questa è la prima volta che il canale cambia, e non sarà l'ultima.

Sul **`Database` passato al sink**: l'indirizzo di una persona su Telegram è una chat, su un altro canale sarebbe altro. Farlo risolvere al servizio significherebbe insegnargli quale canale è attivo, cioè proprio ciò che l'interfaccia esiste per non dover sapere. Il sink smette di essere puro — non lo era comunque, fa I/O di rete — e in cambio il resto del layer non nomina mai un canale.

Sull'**invito**: era l'unico avviso senza alternativa in pagina, e non è un caso. Arriva a chi non ha ancora un profilo, quindi non ha una chat collegata, e non c'è modo di dargliene una prima che entri. Il link a mano è ciò che l'interfaccia già offriva e già spiegava.

**Alternative scartate.**

- _Comprare il dominio e tenere l'email._ Dieci euro l'anno, e resta la scelta migliore in assoluto: il dominio serve comunque per il deploy, e `PUBLIC_APP_URL` è una porta a senso unico che conviene chiudere prima che qualcuno sottoscriva un feed. Scartata dal manutentore, che ha preferito non spendere.
- _Cloudflare Email Service sul piano gratuito._ Consegna solo a indirizzi verificati: la stessa restrizione della sandbox di Resend con un altro nome, e con in più l'attrito di far cliccare a ogni organizzatore un'email di verifica di Cloudflare.
- _Verificare a uno a uno i venti indirizzi degli organizzatori._ Funzionerebbe per i conflitti e **non** per gli inviti, che è il caso in cui non si può pre-verificare nessuno. E aggiungerebbe un passaggio incomprensibile all'ingresso.
- _La casella Gmail del manutentore, già configurata per il magic link._ Gmail parla SMTP, e su Cloudflare Workers una connessione SMTP non si apre. È la ragione per cui §3 aveva scelto un fornitore con API HTTP.
- _Tenere il codice dell'email dormiente._ Lascerebbe una pagina di preferenze che promette avvisi che non partono, e la coda di uscita che si riempie senza svuotarsi mai.

**Conseguenze.**

- **Chi non collega la chat non riceve niente fuori dall'applicazione**, e non è un errore: è la condizione predefinita di chiunque non abbia fatto nulla. Un profilo non collegato viene saltato senza finire fra i falliti, altrimenti la corsa notturna ritenterebbe per tre giorni una consegna impossibile.
- Il collegamento è un passaggio in più all'ingresso, e va spiegato agli organizzatori.
- Un bot non può scrivere per primo: è Telegram a proibirlo, ed è il motivo per cui il collegamento esiste come flusso e non come campo da compilare.
- La decisione #6 si chiude, ma **non nel modo che il registro prescriveva** — «parlando con gli organizzatori, non a tavolino». È stata chiusa da un vincolo di budget. Se gli organizzatori dicessero che Telegram non lo vogliono, l'interfaccia `NotificationSink` regge il cambio: è la seconda volta che serve.

**Da rivedere se.** Il dominio viene comprato — a quel punto l'email torna possibile e ha senso **accanto** a Telegram, non al suo posto, perché è l'unico canale che raggiunge chi non è ancora iscritto e quindi rimetterebbe in piedi l'invito.

> **Verificata (2026-08-25).** Bot creato con @BotFather, chat collegata da `/settings/notifications`, e **primo avviso consegnato davvero**: il digest fermo in coda dal giorno prima. È la prima volta da quando il layer esiste che qualcosa esce dall'applicazione — con l'email non era mai successo, ed è il motivo per cui questa voce esiste.

---

## ADR-0040 — La chat si collega leggendo i messaggi del bot, non con un webhook

**Data:** 2026-08-25 · **Stato:** Accettata

**Contesto.** Un bot Telegram non può scrivere per primo a nessuno: serve che la persona apra la conversazione. Il prodotto deve quindi collegare una chat a un profilo, e il modo consueto è un **webhook** — si registra un indirizzo, Telegram ci manda ogni messaggio ricevuto. Quell'indirizzo dev'essere pubblico e raggiungibile, e questa applicazione non è ancora deployata.

**Decisione.** Nessun webhook. Il collegamento funziona così:

1. La pagina delle impostazioni genera un codice usa-e-getta e lo salva sul profilo.
2. La persona apre il bot con un link `https://t.me/<bot>?start=CODICE` e preme Avvia, che manda `/start CODICE`.
3. Torna nell'applicazione e preme un pulsante.
4. Il server chiama `getUpdates`, cerca il codice fra i messaggi ricevuti e ne ricava la chat.

Il codice vale trenta minuti e sparisce appena il collegamento riesce. Gli aggiornamenti **non si consumano**: nessun `offset`.

**Motivazioni.**

`getUpdates` è una POST come le altre e funziona da `localhost`. Questo rende il giro **provabile prima del deploy**, che è precisamente il problema con cui la Fase 6 si era chiusa: tre pezzi consegnati e mai visti girare perché mancava un indirizzo pubblico. Un webhook avrebbe aggiunto il quarto.

Il codice si cerca **per parola intera** e non per sottostringa. È l'unico punto del canale che può bucare la matrice di visibilità: se `ABC23456` corrispondesse dentro `ABC234567`, un conflitto redatto per un'organizzazione finirebbe nella chat di un'altra. C'è un test apposta.

Gli aggiornamenti non si consumano perché due profili che si collegano nello stesso minuto si ruberebbero i messaggi a vicenda: chi chiama `getUpdates` con un `offset` cancella la coda per tutti. Telegram li lascia cadere da solo dopo circa un giorno, il che a questi volumi è la pulizia che serve.

L'alfabeto del codice esclude `O`, `0`, `I` e `1`: si legge da uno schermo e si riscrive su un telefono, e quelle quattro sono il modo più rapido di far fallire un collegamento che sarebbe andato bene.

**Alternative scartate.**

- _Webhook._ Vuole un indirizzo pubblico, cioè il deploy, cioè la cosa che non c'è. Resta la scelta giusta il giorno in cui il volume dei messaggi conti — ma un bot che riceve solo `/start` non ha volume.
- _Chiedere all'utente di incollare il proprio `chat_id`._ Va cercato con un altro bot, è un numero senza significato, e sbagliarlo a copiare significa mandare le proprie notifiche a uno sconosciuto.
- _Consumare gli aggiornamenti con `offset`._ Più pulito in teoria, rotto in pratica appena due persone si collegano insieme.
- _Un codice più corto._ Sotto gli otto caratteri le collisioni fra codici contemporanei smettono di essere teoriche, e una collisione qui è un avviso consegnato alla persona sbagliata.

**Conseguenze.**

- `getUpdates` e i webhook si escludono a vicenda: finché si usa questo, **nessuno deve registrare un webhook** su quel bot.
- Il collegamento va completato entro trenta minuti dall'apertura, e chi preme troppo presto riceve «il messaggio non è ancora arrivato» invece di un errore.
- Il pulsante di verifica è un passaggio manuale in più rispetto a un webhook, che collegherebbe da solo. È il prezzo di poterlo provare senza essere online.

**Da rivedere se.** Il bot comincia a ricevere messaggi che non siano `/start`, o gli iscritti diventano abbastanza da far scorrere via gli aggiornamenti prima che qualcuno prema il pulsante. In entrambi i casi la risposta è il webhook, che a quel punto avrà anche un indirizzo dove vivere.

---

## ADR-0041 — La connessione al database vive quanto la richiesta

**Data:** 2026-08-26 · **Stato:** Accettata · **Corregge:** [ADR-0026](#adr-0026--il-pool-ha-più-di-una-connessione-perché-il-pooler-non-tollera-il-pipelining)

**Contesto.** Al primo deploy su Cloudflare l'applicazione rispondeva **un 500 sì e uno no**. Il log del Worker diceva sempre la stessa cosa: la prima query della richiesta falliva, in una decina di millisecondi — troppo pochi perché ci fosse stata una rete di mezzo.

Il colpevole era `getDb()`, che teneva il pool di `postgres.js` in una variabile di modulo e lo riusava per tutte le richieste. È la cosa giusta su Node, ed è quello che il progetto ha fatto per sei fasi senza problemi. Su Cloudflare Workers è un guasto: **un socket aperto nel contesto di una richiesta non può essere usato da un'altra**, e il tentativo fallisce all'istante.

L'alternanza regolare è la firma del meccanismo: la prima richiesta apre la connessione e funziona; la seconda prova a riusarla e viene respinta; `postgres.js` la marca morta e ne apre una nuova; la terza funziona. E così via.

**Decisione.** Una connessione **per richiesta**, chiusa in `finally` quando la richiesta finisce. Un hook in testa alla catena **delimita** il perimetro senza aprire niente: la connessione nasce alla prima `getDb()`, e una richiesta che il database non lo tocca non ne apre nessuna. Il perimetro lo tiene un `AsyncLocalStorage`: `getDb()` non cambia firma e nessuno dei suoi trenta chiamanti sa che è successo qualcosa. Il `max` del pool scende da 10 a 5.

**Motivazioni.**

Sull'`AsyncLocalStorage` invece di un parametro passato di mano in mano: `getDb()` è chiamata da una trentina di file, e nessuno di loro deve sapere quanto vive una connessione. Passare il database come argomento avrebbe voluto dire toccarli tutti per un dettaglio del runtime, e lasciare a chiunque scriva codice nuovo la possibilità di dimenticarsene. Su Workers `AsyncLocalStorage` c'è, sotto `nodejs_compat`, che il progetto usa già per `postgres.js`.

Sull'hook **in testa** alla sequenza: `authGuard` interroga già il database per costruire il viewer. Mettendo il perimetro più in basso, il primo a chiedere una connessione lo troverebbe chiuso e se ne aprirebbe una che nessuno chiude.

Sulla **pigrizia**, che non è un'ottimizzazione. La prima stesura apriva la connessione nell'hook, subito, per tutti. Il costo si è visto dove non lo si aspettava: `npm run build` prerenderizza `/offline`, la prerenderizzazione attraversa la catena degli hook, e una pagina che una riga di SQL non la esegue ha cominciato a pretendere `DATABASE_URL`. La CI è diventata rossa sul solo passo `Build` — e ha ragione lei, perché quella variabile non ce l'ha e **non deve averla**: dare a ogni pull request la stringa del database è esattamente ciò che [ADR-0038](#adr-0038--gli-smoke-test-girano-contro-il-database-vero-si-puliscono-da-soli-e-restano-fuori-dalla-ci) evita per gli smoke test. Aprire alla prima `getDb()` invece che all'ingresso rimette il build fuori dalla portata del database.

Sul `max` da 10 a 5: ADR-0026 aveva alzato quel numero perché con `max: 1` `postgres.js` accoda in pipeline le query concorrenti, e Supavisor in transaction mode non lo tollera. **Quella ragione resta valida** — SvelteKit esegue in parallelo la `load` del layout e quella della pagina — ma il numero non deve più coprire tutte le richieste insieme: solo le query concorrenti di una, che sono due o tre. Dieci per richiesta moltiplicherebbero le connessioni verso il pooler senza che nessuno le usi.

**Alternative scartate.**

- _Tenere il pool globale e riaprire su errore._ Curerebbe il sintomo lasciando in piedi la causa, e il primo utente di ogni ondata pagherebbe comunque un 500.
- _Cloudflare Hyperdrive_, che è fatto apposta per questo: mette il pooling al confine e la connessione diventa riusabile. Richiede il piano Workers a pagamento, e questo progetto ha scelto di stare a zero euro ([ADR-0039](#adr-0039--il-canale-delle-notifiche-è-telegram-non-lemail)). Resta la risposta giusta il giorno in cui il piano cambia.
- _Passare il `Database` come argomento ovunque._ Trenta file toccati e una trappola permanente per il codice nuovo.
- _Abbandonare `postgres.js` per l'API HTTP di Supabase._ Vorrebbe dire buttare Drizzle e con lui lo schema come unica fonte di verità dei tipi ([ADR-0001](#adr-0001--typescript-full-stack-invece-di-pythonfastapi)).

**Conseguenze.**

- **Una connessione TCP nuova per ogni richiesta che tocca il database.** È il costo vero di questa scelta: una manciata di millisecondi di handshake verso il pooler. A venti organizzazioni non si misura; è la prima cosa da guardare se un giorno la latenza diventasse un tema.
- Le richieste che il database non lo toccano — un asset, la pagina di login, la prerenderizzazione di `/offline` — non pagano niente e **non pretendono nemmeno che `DATABASE_URL` esista**. Il perimetro nasce vuoto; la stringa di connessione viene letta alla prima `getDb()`, non all'ingresso.
- **Il ramo "fuori da una richiesta" di `getDb()` non deve essere raggiunto dall'applicazione.** Esiste per i test e per gli script, che finiscono e si portano via tutto. Se ci finisse una rotta, vorrebbe dire che qualcosa gira fuori da `conDatabase` — e quella connessione non la chiuderebbe nessuno.
- Sei fasi di sviluppo su Node non hanno mai potuto vedere questo difetto. Il modo per vederlo senza deployare c'era ed è `wrangler dev`, che gira il runtime vero in locale: è nel runbook.

**Da rivedere se.** Si passa al piano Workers a pagamento — allora Hyperdrive fa sparire sia il costo dell'handshake sia questa complicazione — oppure la latenza della prima query diventa il collo di bottiglia.

---

## ADR-0042 — Sul telefono la navigazione sta in basso e il calendario è un elenco

**Data:** 2026-08-27 · **Stato:** Accettata

**Contesto.** L'applicazione è stata scritta per intero su uno schermo largo. Aperta da un telefono — 393px, tema scuro, PWA installata — la pagina `/calendar` si presentava così: le nove voci di navigazione, messe in un `flex-wrap`, occupavano **due righe piene** di testo da 14px, più una terza con nome utente e "Esci" spinto a filo del bordo destro dal suo `ml-auto`. Sotto, il titolo di pagina, tre righe di spiegazione e il pannello filtri sempre aperto, alto circa 310px. La barra di FullCalendar collassava: `left: 'prev,next oggi'` sono due gruppi nello stesso angolo, e sotto i 400px il secondo usciva dal primo sovrapponendosi al suo bordo, mentre "agosto 2026" andava a capo addosso ai pulsanti di vista.

Il risultato è che **della pagina calendario non si vedeva il calendario**: la prima riga di griglia arrivava intorno ai 760px, cioè oltre il bordo inferiore dello schermo. E anche scorrendo fin lì, la griglia del mese su quella larghezza dà colonne da circa 34px: ci sta il numero del giorno e nient'altro.

Su 28 file `.svelte` il layout applicativo non aveva **nessuna** utility responsive.

**Decisione.** Tre cose, tutte confinate sotto `md:`, senza toccare nessuna logica di dominio.

1. **La navigazione si sdoppia.** Una barra fissa in basso con quattro voci — Calendario, Conflitti, Avvisi, Nuova data — e tutto il resto dietro un `☰` che apre un pannello laterale. Sopra `md:` la barra in alto resta identica a prima.
2. **Il calendario cambia vista, non solo dimensione.** Sotto `md:` la vista iniziale è `listMonth`; la barra di FullCalendar tiene una cosa sola per angolo e la scelta della vista esce dalla barra per diventare un controllo a tutta larghezza; i filtri stanno in un `<details>` che parte chiuso e dichiara quanti filtri sono attivi.
3. **Due regole globali per il tocco**, scritte **fuori da ogni `@layer`** perché devono battere le utility di Tailwind: bersagli da 44px sotto `pointer: coarse`, e campi a 16px sotto `640px`.

**Motivazioni.**

Sulle **quattro voci in basso e non otto.** Il ciclo quotidiano di un organizzatore è uno solo: guardo il calendario, vedo una sovrapposizione, alzo il telefono (`ARCHITECTURE.md` §1). Anagrafiche, registro e feed sono manutenzione e si fanno da seduti. "Nuova data" è nelle quattro pur essendo un'azione e non una destinazione, perché è la cosa che si fa in piedi davanti a un locale — ed è il motivo per cui la pagina calendario nasconde il proprio pulsante sotto `md:`: due porte per la stessa stanza, a mezzo metro di distanza, si scambiano per due stanze.

Sull'elenco come vista predefinita. Non è che `dayGridMonth` sia meno leggibile su un telefono e si possa migliorare col CSS: su 34px di colonna **il titolo di una data non entra**, e nessun foglio di stile lo fa entrare. `listMonth` porta le stesse date per esteso — giorno, titolo, città, organizzazione — e nasce già in colonna. Resta raggiungibile dal selettore: chi vuole guardare la forma del mese può, ma non è ciò che trova aprendo l'applicazione.

Sulle **regole fuori dagli strati.** Nella cascata dei layer, ciò che non sta in nessuno vince su tutto ciò che sta dentro uno, utility comprese. Dentro `@layer base` perderebbero contro un `text-sm` o un `h-8` scritti in pagina, che sono precisamente i valori da correggere. L'alternativa era duecento `sm:` sparsi che nessuno terrà allineati. `pointer: coarse` e non una larghezza: un desktop stretto continua a usare il mouse e non ha motivo di diventare meno denso.

Sui **16px nei campi**: non è tipografia. Safari su iPhone ingrandisce la pagina quando un campo con testo più piccolo riceve il fuoco, e non la rimpicciolisce quando lo perde. Su un modulo da trenta campi come quello degli eventi la pagina resta storta fino in fondo.

Sul pannello come **`<details>` e non `<dialog>`**. Le voci secondarie sono l'unica strada per uscire dall'applicazione o raggiungere le anagrafiche, e la barra da desktop sul telefono è `display:none`. Un pannello che si apre solo con JavaScript, dopo un'idratazione fallita, chiuderebbe fuori da tutto. Con `<details>` si apre comunque; JavaScript aggiunge Esc e il blocco dello scorrimento, che senza mancano senza fare danni.

Sull'**etichetta di stato nelle righe di elenco.** Nelle viste a griglia lo stato si legge dal tratteggio del bordo — è la scelta di non affidarlo al solo colore. Una riga di elenco però è un `<tr>`, e un bordo tratteggiato attorno a una riga di tabella non si disegna in modo affidabile. Siccome l'elenco è ciò che si vede aprendo l'applicazione dal telefono, lì lo stato si **scrive**, con le stesse parole di `ETICHETTE_STATO` e in un elemento vero, così lo legge anche chi ascolta la pagina.

**Alternative scartate.**

- _Solo l'hamburger, senza barra in basso._ Metà del lavoro e un header da 52px, ma ogni destinazione a due tocchi — Conflitti compreso, che è la ragione per cui il prodotto esiste.
- _Rendere leggibile `dayGridMonth` sul telefono._ Non è un problema di stile: vedi sopra.
- _Mettere i pulsanti di vista nel `footerToolbar` di FullCalendar._ Li avrebbe portati sotto il calendario, cioè lontano dal punto in cui si decide come guardarlo.
- _Un breakpoint che forza la vista in entrambi i versi._ Scendendo sotto `md:` la vista si forza, perché nessuna delle due griglie sta in larghezza. Salendo no: chi arriva a schermo largo tiene quello che stava guardando.
- _`!important` sparsi o `@layer base`._ Vedi sopra: il primo è ciò che si è evitato tranne dove FullCalendar non lascia scelta, il secondo non funziona.

**Conseguenze.**

- **L'elenco delle voci di navigazione resta uno solo**, e le due barre ne prendono fette diverse. Tenerne due significherebbe aggiungere una rotta e scoprire un mese dopo che sul telefono non c'è.
- Il `<main>` porta un margine in basso pari all'altezza della barra fissa, più `env(safe-area-inset-bottom)`. Vale 0 finché il viewport non è `cover`, ed è scritto lo stesso perché l'app è installabile.
- **`resolve()` è tipizzato su una rotta alla volta e non accetta un'unione di path.** La risoluzione avviene quindi nel layout, un letterale per volta, e alle due barre l'indirizzo arriva già risolto: lo dice il tipo, `ResolvedPathname`, che solo `resolve()` produce. Le tre ancore che lo ricevono hanno la regola `svelte/no-navigation-without-resolve` spenta con un commento che spiega perché; ovunque altro resta accesa.
- **Due `nav` con lo stesso nome accessibile** convivono nel documento, ma solo una è visibile per volta: l'altra è `display:none`, quindi non è esposta.
- Le misure a 375px dopo: barra in alto 61px invece di ~110, filtri 46px chiusi invece di 310 aperti, barra del calendario su una riga sola da 44px, **prima data a 352px** invece che oltre il bordo. Nessuno scorrimento orizzontale, `<select>` a 16px, pulsanti della barra di FullCalendar e del selettore di vista tutti a 44px.

**Da rivedere se.** Le voci principali diventano più di quattro — a quel punto una barra in basso comincia a stringere invece che aiutare — oppure gli organizzatori dicono di usare l'applicazione soprattutto da telefono anche per le anagrafiche, che oggi stanno dietro il `☰` proprio perché si assume il contrario.

---

## ADR-0043 — Il titolare del trattamento è una persona fisica, e l'informativa è una pagina dell'applicazione

**Data:** 2026-08-27 · **Stato:** Accettata · **Chiude:** il punto 5 di `ARCHITECTURE.md` §17 e la decisione aperta #5

**Contesto.** `ARCHITECTURE.md` §16 chiedeva di decidere «chi è formalmente titolare del trattamento (una delle associazioni, presumibilmente) e non lasciarlo implicito», **prima del lancio pubblico**. Era l'ultimo punto aperto con una scadenza, e l'unico che non si poteva chiudere scrivendo codice: senza un titolare identificato non c'è informativa, e senza informativa il servizio non può essere aperto a organizzazioni esterne.

Nel frattempo il prodotto ha accumulato una superficie di trattamento più larga di quella immaginata al punto 5: oltre ai dati degli iscritti c'è una categoria che [ADR-0032](#adr-0032--il-testo-incollato-ha-una-scadenza) aveva già isolato — i **dati personali di terzi che il servizio non raccoglie ma riceve**, cioè il testo che qualcuno incolla nell'import — e le persone nominate lì dentro non sanno che ne teniamo copia.

**Decisione.** Il titolare del trattamento è **Alessandro Rizzuto**, persona fisica, che gestisce il servizio a titolo personale e non commerciale. Il recapito pubblicato è il suo indirizzo email; nessun indirizzo fisico, nessun responsabile della protezione dei dati.

L'informativa è una **pagina dell'applicazione** — `/privacy`, fuori dal gruppo di rotte `(app)` e quindi leggibile senza accedere — linkata dal login e dal piè di pagina di ogni schermata autenticata.

**Motivazioni.**

Sulla **persona fisica invece di un'associazione**, che è ciò che §16 dava per probabile. Nominare titolare un'associazione significherebbe che quella associazione risponde di un servizio che non controlla: il codice, il database e le chiavi sono in mano al manutentore, e la responsabilità deve stare dove sta il controllo effettivo. Va detto per intero che questa è anche la scelta che espone di più la persona: è il costo di gestire da soli un servizio che tratta dati di altri, ed è consapevole.

Sul **recapito**: art. 13 chiede «identità e dati di contatto» senza imporre la forma, e per una persona fisica che gestisce un servizio non commerciale nome, cognome ed email sono la prassi accettata. Pubblicare un indirizzo di casa è un costo permanente che l'obbligo non impone.

Sull'informativa come **pagina e non file Markdown**. Un `INFORMATIVA.md` in `docs/` sarebbe stato più comodo da scrivere e inutile da leggere: chi digita la propria email nel form di accesso deve poterla leggere lì, in quel momento, senza sapere che esiste un repository. Da qui anche la posizione del link nel login — sotto il campo, prima del pulsante — perché **il primo dato personale che il servizio raccoglie è proprio quell'email**.

Sull'informativa che **nomina i dati di terzi in una sezione propria**. Sarebbe stato più breve elencare i campi del profilo e fermarsi lì. Ma il testo incollato è l'unico posto in cui il servizio conserva dati di persone che non lo usano e non lo sanno, ed è esattamente il caso in cui un'informativa serve a qualcosa invece di essere un adempimento. La sezione dice anche a quelle persone come chiedere la rimozione.

Sulla **cancellazione raccontata per esteso**, invece di rimandare all'art. 17. Cancellare il profilo non cancella le date: appartengono all'organizzazione, e le sovrapposizioni già segnalate riguardano anche le organizzazioni dall'altra parte. È un limite reale, previsto dal paragrafo 3, e scoprirlo dopo aver chiesto la cancellazione sarebbe il modo peggiore di scoprirlo.

**Alternative scartate.**

- _Nominare titolare una delle associazioni iscritte_, come §16 ipotizzava. Responsabilità senza controllo, e per giunta su un servizio da cui quell'associazione non ha nessun vantaggio rispetto alle altre.
- _Contitolarità fra le organizzazioni iscritte_ (art. 26). Formalmente difendibile — ciascuna decide che cosa inserire — ma richiede un accordo scritto fra tutte, da rifare a ogni ingresso, per un gruppo di meno di venti realtà senza struttura legale comune. Sproporzionato.
- _Rimandare ancora, tenendo il servizio chiuso al gruppo attuale._ È ciò che è stato fatto finora e non era sbagliato, ma il punto aveva una scadenza («prima del lancio pubblico») e rimandarla ancora significava non lanciare.

**Conseguenze.**

- **L'informativa è codice, e va tenuta vera come il codice.** Le scadenze che dichiara — novanta giorni per il testo incollato, centottanta per gli avvisi — sono le costanti `GIORNI_CONSERVAZIONE` e `GIORNI_CONSERVAZIONE_NOTIFICHE`. Cambiare una costante senza cambiare la pagina produce un'informativa falsa, che è peggio di nessuna informativa. Il commento in testa al file lo dice.
- **Ogni fornitore nominato nella tabella corrisponde a una chiamata che esiste.** Aggiungere un fornitore che veda dati personali significa aggiungere una riga lì, e la riga va aggiunta **prima** di attivarlo. Vale in particolare per il modello linguistico dell'import da testo libero, oggi non configurato: l'informativa lo dichiara come non attivo, e la sua attivazione passa da questa pagina.
- Un fatto che è emerso scrivendo e che vale la pena aver verificato: **l'applicazione non legge mai l'indirizzo IP**. `getClientAddress()` non compare da nessuna parte, e i contatori di [ADR-0037](#adr-0037--il-rate-limit-degli-altri-due-endpoint-sta-in-una-tabella-non-in-parse_jobs) usano l'identificativo del profilo o del token. Non era stato deciso a tavolino, ma è una proprietà vera del sistema ed è dichiarabile.
- Resta un **atto formale fuori dal repository**: questa decisione identifica il titolare, non lo costituisce. Se il servizio dovesse crescere oltre il gruppo attuale, o raccogliere denaro, la forma giuridica va rivista con qualcuno che di questo si occupi per mestiere.

**Da rivedere se.** Il servizio passa a un'organizzazione con una propria forma giuridica, oppure smette di essere non commerciale — allora il titolare cambia, e con lui il recapito e probabilmente la necessità di un registro dei trattamenti ai sensi dell'art. 30.

---

## ADR-0044 — Le date di chi non è iscritto entrano per segnalazione, e appartengono a un'organizzazione senza membri

**Data:** 2026-08-27 · **Stato:** Accettata

**Contesto.** Il calendario vede solo ciò che caricano gli iscritti, ma le sovrapposizioni non si fermano al perimetro di [ADR-0004](#adr-0004--registrazione-solo-su-invito): la serata che riempie il locale a quindici chilometri è spesso di qualcuno che qui dentro non c'è. Un organizzatore che la conosce non ha modo di dirlo, e l'informazione che servirebbe a tutti resta in una chat privata.

L'idea iniziale aveva due percorsi: uno pubblico, aperto a chiunque passasse dalla home, e uno interno. Il percorso pubblico si è rivelato molto più caro di quanto sembrasse, e per tre ragioni indipendenti:

1. **Non esiste una superficie pubblica.** `+page.server.ts` manda a `/login` chi non ha sessione, e `ARCHITECTURE.md` §14 mette la vista pubblica fuori dalla v1 ([ADR-0014](#adr-0014--fuori-scope-dichiarato-per-la-v1)). Sarebbe stata la prima rotta pubblica **in scrittura**.
2. **Avrebbe riaperto il canale.** «Mi arriva una mail» significa un sink email tolto in Fase 6 ([ADR-0039](#adr-0039--il-canale-delle-notifiche-è-telegram-non-lemail)), più una riga fornitore nell'informativa.
3. **Avrebbe costretto a leggere l'IP.** `rate_limits` ha per chiave `risorsa:identità:finestra`, e le uniche identità esistenti sono il profilo e il token del feed. Un form anonimo non ha né l'una né l'altro. [ADR-0043](#adr-0043--il-titolare-del-trattamento-è-una-persona-fisica-e-linformativa-è-una-pagina-dellapplicazione) ha verificato e dichiarato che `getClientAddress()` non compare da nessuna parte, e `/privacy` lo scrive in tre punti.

**Decisione.** La segnalazione è **solo interna**, e si compone di cinque parti.

1. **Solo un iscritto segnala.** La rotta sta dentro `(app)`, l'identità per il rate limit è il profilo, e l'informativa non cambia di una riga.
2. **La segnalazione entra in calendario subito.** Non c'è approvazione del manutentore. Una notifica gli arriva sul canale configurato, **per conoscenza**.
3. **L'organizzatore esterno è una riga `organizations` con `esterna = true` e nessuna membership.** Non una terza anagrafica accanto ad artisti e venue.
4. **Una data esterna può essere solo `confirmed` o `cancelled`.** Mai `draft`, mai `hold`.
5. **Correggere una data esterna è curatela, non governo**: la può toccare chi ha `canModerateCatalog`, cioè i moderatori e i platform admin.

**Motivazioni.**

Sul **non far passare la segnalazione dal manutentore**, che è la scelta meno ovvia delle cinque. Il collo di bottiglia è precisamente ciò che [ADR-0016](#adr-0016--il-ruolo-moderator-esiste-dalla-v1-ed-è-trasversale-alle-organizzazioni) ha creato il ruolo `moderator` per evitare: «il costo non è un ruolo in più, è che ogni refuso diventa una richiesta via Telegram al manutentore». Una data segnalata di lunedì e pubblicata di giovedì, perché prima il manutentore non ha aperto Telegram, ha perso la finestra in cui qualcuno poteva ancora spostare la propria. Il valore di questa feature **è** la tempestività: un'approvazione la spende tutta. Il controllo giusto non è preventivo ed è molto più economico — vedi l'attribuzione, più sotto.

Su **`organizations` invece di una terza anagrafica**. La tentazione era modellare l'organizzatore esterno come artisti e venue, che [ADR-0006](#adr-0006--artisti-e-venue-come-entità-globali-condivise) rende entità globali di nessuno. Ma `events.organization_id` è `NOT NULL` ed è, per commento nello schema, «l'asse su cui ruota tutta la matrice di visibilità»: una terza anagrafica avrebbe richiesto di renderlo nullable e di aggiungere un `external_organizer_id` accanto, cioè di mettere due colonne dove il modello ne ha una sola apposta. Una riga `organizations` senza membri invece **non tocca l'asse**: `ownsOrganization()` è falsa per tutti, e la data si serializza da sé come una `confirmed` altrui.

C'è un secondo guadagno, che vale da solo: **il percorso di promozione non sposta niente.** Il giorno in cui quell'organizzatore entra davvero, la riga che lo rappresenta esiste già: gli si attacca una membership e si spegne `esterna`, e tutte le date segnalate su di lui diventano sue, correggibili da lui. Nessuna foreign key si muove. Con una tabella separata sarebbe stata una migrazione di `events`.

Da dire per intero: **l'operazione di promozione non è costruita in questa fase.** Le organizzazioni esterne restano fuori dall'elenco di `/admin/invites`, perché un invito dentro una scheda produrrebbe uno stato incoerente — membri veri su un'organizzazione che il resto del sistema tratta come di nessuno. Finché non serve davvero, la promozione si fa da `db:studio`, ed è la stessa scelta che ADR-0016 ha fatto per lo strumento di merge: il modello c'è, l'operazione arriva quando qualcuno la chiede.

Sui **due stati soli**. Una data esterna è per costruzione un'informazione già pubblica: chi la segnala l'ha letta da qualche parte. `draft` e `hold` esistono per proteggere ciò che il proprietario non ha ancora annunciato ([ADR-0005](#adr-0005--stato-hold-con-visibilità-ridotta)), e qui non c'è un proprietario che possa annunciare niente. Ammetterli avrebbe significato dare a un terzo il potere di mettere «in opzione» la data di un altro, che non vuol dire nulla. L'invariante è nello schema come `CHECK`, non solo nel form.

Sulla **curatela invece del governo**. `canEditEvent` passa da `membroEffettivo()`, quindi senza questa decisione una data esterna non sarebbe modificabile da nessuno — platform admin compreso — e ogni refuso sarebbe finito in `db:studio`. Il permesso giusto esisteva già: una data che non appartiene a nessuno è un bene comune esattamente come una scheda artista, e ADR-0016 ha creato `moderator` per «le schede che non appartengono a nessuna organizzazione». Non intacca [ADR-0019](#adr-0019--il-platform-admin-non-vede-le-date-altrui): il potere vale solo dove `esterna` è vera, cioè dove non c'è nessuno a cui la data possa essere sottratta.

Sull'**attribuzione come unico controllo**. `segnalata_da_organization_id` non è metadato: esce dal serializzatore in entrambe le viste, e finisce nel feed ICS e nell'export. Due ragioni. La prima è di onestà — chi si abbona a un calendario deve poter distinguere una data caricata da chi la organizza da una riferita da un terzo, e mescolarle in silenzio degrada la fiducia nell'intero cartellone, che è la posta di [ADR-0023](#adr-0023--la-fiducia-nello-stato-hold-è-assunta-non-verificata). La seconda è che l'abuso esiste: segnalare una data finta su uno slot è un modo di scoraggiare un concorrente. In una cerchia di venti realtà che si conoscono, **il nome di chi ha segnalato costa più di qualunque coda di moderazione**, e non richiede che qualcuno la smaltisca.

Sull'**avviso a una persona invece che a un'organizzazione**. `destinatari.ts` enuncia la regola opposta — «si avvisa un'organizzazione, non una persona» — con una sola eccezione, l'invito. Questa è la seconda, e per una ragione simmetrica: il fatto che l'avviso racconta («qualcuno ha segnalato una data esterna») non è un fatto su una data di un'organizzazione, è un fatto sulla piattaforma. Non c'è un'organizzazione a cui appartenga, perché quella nominata nella segnalazione non ha membri. Le organizzazioni che la segnalazione riguarda sono già servite da ciò che esiste: se la data esterna produce un conflitto, `conflitto_nuovo` parte da sé.

**Alternative scartate.**

- _Il percorso pubblico, come previsto all'inizio._ Rinviato, non rifiutato: torna insieme alla vista pubblica di ADR-0014, quando la questione IP si affronta una volta per tutte e non per un form solo.
- _La segnalazione appartiene all'organizzazione che segnala._ Un solo campo in meno, e una bugia in calendario: direbbe che il circolo X organizza una serata che non organizza. Le sue date, il suo `/audit` e i suoi conflitti si mescolerebbero con quelli di un altro.
- _Una coda di segnalazioni da approvare._ È il collo di bottiglia di cui sopra, e in più è una tabella di stato in più da tenere allineata per ottenere ciò che l'attribuzione ottiene senza stato.
- _`organization_id` nullable, con l'organizzatore esterno in una tabella a parte._ Concettualmente più pulita — l'organizzatore esterno somiglia davvero a un venue — ma paga rendendo nullable la colonna su cui ruota la matrice, e ogni consumatore diventerebbe un `left join` con un nome mancante da gestire. Si valuterà se e quando arriveranno organizzatori esterni **senza** date, che oggi non hanno motivo di esistere.
- _Riconoscere `esterna` dall'assenza di membership, senza colonna._ Un invariante derivato che diventa falso ogni volta che l'ultimo membro di un'organizzazione vera esce.

**Conseguenze.**

- `organizations` ha `esterna`, e ogni query che elenca organizzazioni per **sceglierne una** deve escluderla: onboarding, inviti, selettore del form. Un'organizzazione esterna non è un posto in cui si entra.
- Il `CHECK` sullo schema è il posto dove l'invariante dei due stati non si aggira per distrazione, come `filtriFeed` lo è per [ADR-0029](#adr-0029--il-feed-ics-non-contiene-le-bozze) e `bersaglioParse` per [ADR-0031](#adr-0031--limport-compila-il-form-e-le-tre-cose-che-non-decide).
- Il motore le tratta come qualunque `confirmed` ([ADR-0025](#adr-0025--il-motore-ignora-le-bozze-le-date-annullate-e-quelle-senza-coordinate)), quindi R1, R3 e R4 funzionano subito. R2 quasi mai: la lineup di una segnalazione resta testo libero, perché ADR-0031 vieta di collegarla all'anagrafica per conto di chi non l'ha scritta.
- Gli avvisi di conflitto partono **solo verso l'altro lato**: da questo non c'è nessun destinatario, e per [ADR-0035](#adr-0035--una-notifica-nasce-già-redatta-per-un-destinatario-solo) nessun destinatario significa nessuna riga. È già il comportamento corretto e non richiede codice.
- **Resta un buco noto**: il registro delle modifiche di un'organizzazione esterna non è leggibile da nessuno, perché `/audit` mostra solo la propria. Le correzioni dei moderatori su una data segnalata lasciano una traccia che nessuno può aprire. Non è bloccante — la traccia c'è, e `db:studio` la legge — ma è il primo posto da guardare se un giorno una data esterna cambia e nessuno sa perché.

**Da rivedere se.** Le segnalazioni diventano più di una piccola minoranza delle date in calendario. Vorrebbe dire che il perimetro di ADR-0004 è più stretto del gruppo reale di chi si sovrappone, e la risposta giusta a quel punto non è segnalare meglio: è invitare quelle organizzazioni.

---

## Template per nuove voci

```markdown
## ADR-XXXX — Titolo in forma di decisione

**Data:** YYYY-MM-DD · **Stato:** Accettata | Superata da ADR-YYYY | Rifiutata | Provvisoria

**Contesto.** Qual era il problema, quali vincoli erano in gioco.

**Decisione.** Cosa si è deciso, in una o due frasi.

**Motivazioni.** Perché questa e non un'altra.

**Alternative scartate.** Cosa si è valutato e perché è stato escluso.

**Conseguenze.** Cosa diventa più facile, cosa più difficile, cosa va ricordato.

**Da rivedere se.** La condizione che renderebbe questa decisione sbagliata.
```

---

## Decisioni da prendere

Non ancora decise, elencate per non perderle di vista. Vanno chiuse **parlando con gli organizzatori**, non a tavolino.

> **Aggiornamento (2026-08-27).** Con la chiusura del punto 5 resta aperto **solo il punto 7**, che non ha una scadenza. Tutti i punti con una scadenza di fase sono chiusi, e con essi quello che aveva la scadenza più vincolante di tutte: «prima del lancio».

| #   | Questione                                                                                                                      | Entro            |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | ~~Raggio di conflitto di default~~ **Chiusa: 60 km confermati, vedi ADR-0021.** | ~~Fase 3~~ chiusa |
| 2   | ~~Finestra di ±14 giorni per la sovrapposizione artisti~~ **Chiusa: ±7 giorni civili con severity graduata, vedi ADR-0021.** | ~~Fase 3~~ chiusa |
| 3   | ~~Serve un ruolo di moderatore con poteri di correzione e merge su anagrafiche artisti e venue?~~ **Chiusa: sì, vedi ADR-0016.** Resta da capire con gli organizzatori chi nominare, e se lo strumento di merge serva davvero. | ~~Fase 1~~ chiusa |
| 4   | ~~La visibilità ridotta in `hold` è sufficiente a far fidare gli organizzatori?~~ **Chiusa per assunzione, non verificata: vedi ADR-0023.** Il segnale che la smentisce è misurabile da `audit_log`: la quota di date che passano da `hold` prima di `confirmed` | ~~Fase 2~~ assunta |
| 5   | ~~Chi è formalmente titolare del trattamento dei dati~~ **Chiusa: il manutentore a titolo personale, e l'informativa è la pagina `/privacy` dell'applicazione. Vedi [ADR-0043](#adr-0043--il-titolare-del-trattamento-è-una-persona-fisica-e-linformativa-è-una-pagina-dellapplicazione).** | ~~Prima del lancio~~ chiusa |
| 6   | ~~Canale Telegram come sink di notifica aggiuntivo?~~ **Chiusa: sì, ed è diventato l'unico canale, vedi [ADR-0039](#adr-0039--il-canale-delle-notifiche-è-telegram-non-lemail).** Chiusa da un vincolo di budget e non parlando con gli organizzatori, come il registro prescriveva: se dicessero di non volerlo, l'interfaccia regge un altro cambio. | ~~Fase 6~~ chiusa |
| 7   | Un LLM ospitato in locale al posto della Claude API, su un server in casa del manutentore. Ribalterebbe [ADR-0034](#adr-0034--claude-haiku-con-schema-forzato-dallapi-musicbrainz-resta-fuori-dallincolla). Le tre domande vere sono sotto. | Quando il server esiste |

**Sul punto 7**, perché non vada perso il ragionamento già fatto.

- **Il costo non è l'argomento.** L'estrazione con Haiku costa circa 0,003 € a chiamata: a questi volumi sono i 1-2 € l'anno di `ARCHITECTURE.md` §9. Un server in casa non si ripaga con questo, si sceglie per altri motivi — non dipendere da nessuno, o non far uscire il testo incollato. Il secondo è un argomento serio e si lega a [ADR-0032](#adr-0032--il-testo-incollato-ha-una-scadenza): oggi il testo di un post, con dentro il numero di chi prende le prenotazioni, esce verso un fornitore terzo.
- **Lo schema forzato è la parte che non si può perdere.** È ciò che rende l'integrazione affidabile invece che quasi affidabile, e non è un'esclusiva di nessuno: `llama.cpp` ha le grammatiche, Ollama e vLLM hanno la decodifica guidata da JSON Schema, e quasi tutti espongono un endpoint compatibile OpenAI con `response_format`. La domanda da porsi prima di comprare hardware è se lo stack scelto ce l'ha, non se il modello è bravo.
- **Il Worker non arriva in salotto.** L'applicazione gira su Cloudflare (ADR-0002) e non può raggiungere una macchina su una rete domestica: servirebbe esporla, con quello che comporta. Va detto però che l'architettura **regge già** un endpoint inaffidabile — `struttura()` non solleva mai e il fallimento non blocca l'inserimento manuale (principio 5) — quindi una connessione casalinga qui è una scelta legittima, come non lo sarebbe su qualcosa di portante.
- **La riscrittura è contenuta e lo era per progetto.** Cambia `llm.ts` e basta: nessun altro file di `parse/` sa che esiste un modello. È il motivo per cui ADR-0034 ha scartato l'HTTP grezzo senza rimpianti.
