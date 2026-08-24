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

**Conseguenze.** Il blocco va **ricontrollato a ogni `npm run db:generate`**: drizzle-kit può riemettere la creazione non condizionata, e la migrazione si scoprirebbe rotta solo al deploy. È annotato nel file di migrazione e nel runbook del README. Vale solo per la prima migrazione: dallo snapshot in poi la tabella risulta già esistente.

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
- Vanno lanciati **prima di un rilascio**, non a ogni commit. Il README lo dice nel runbook.
- Il primo giro ha già trovato una cosa che nessun test unitario poteva vedere: riempire il form evento subito dopo il caricamento non funziona, perché l'idratazione di Svelte rimette a ogni campo il valore della sua prop. Il sintomo era un fallimento lontanissimo dalla causa, con davanti lo screenshot di un modulo vuoto.
- Servono `SUPABASE_SERVICE_ROLE_KEY` e `DATABASE_URL` in `.env`: senza, i test si fermano dicendolo invece di fallire in modo oscuro.

**Da rivedere se.** Il repository si apre a contributi esterni, o il calendario va in produzione con dati di organizzatori veri. Nel primo caso serve la CI e quindi un ambiente separato; nel secondo, il database di sviluppo smette di essere un posto dove far girare qualcosa che crea e cancella righe.

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

| #   | Questione                                                                                                                      | Entro            |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | ~~Raggio di conflitto di default~~ **Chiusa: 60 km confermati, vedi ADR-0021.** | ~~Fase 3~~ chiusa |
| 2   | ~~Finestra di ±14 giorni per la sovrapposizione artisti~~ **Chiusa: ±7 giorni civili con severity graduata, vedi ADR-0021.** | ~~Fase 3~~ chiusa |
| 3   | ~~Serve un ruolo di moderatore con poteri di correzione e merge su anagrafiche artisti e venue?~~ **Chiusa: sì, vedi ADR-0016.** Resta da capire con gli organizzatori chi nominare, e se lo strumento di merge serva davvero. | ~~Fase 1~~ chiusa |
| 4   | ~~La visibilità ridotta in `hold` è sufficiente a far fidare gli organizzatori?~~ **Chiusa per assunzione, non verificata: vedi ADR-0023.** Il segnale che la smentisce è misurabile da `audit_log`: la quota di date che passano da `hold` prima di `confirmed` | ~~Fase 2~~ assunta |
| 5   | Chi è formalmente titolare del trattamento dei dati: una delle associazioni o il manutentore a titolo personale?               | Prima del lancio |
| 6   | Canale Telegram come sink di notifica aggiuntivo, dato che la community esiste già? **Arrivata in fondo alla Fase 6 senza essere decisa**, e va bene così: è una domanda da fare agli organizzatori, non da chiudere a tavolino. Il layer è pronto ad accoglierlo ([ADR-0035](#adr-0035--una-notifica-nasce-già-redatta-per-un-destinatario-solo)). | ~~Fase 6~~ aperta |
| 7   | Un LLM ospitato in locale al posto della Claude API, su un server in casa del manutentore. Ribalterebbe [ADR-0034](#adr-0034--claude-haiku-con-schema-forzato-dallapi-musicbrainz-resta-fuori-dallincolla). Le tre domande vere sono sotto. | Quando il server esiste |

**Sul punto 7**, perché non vada perso il ragionamento già fatto.

- **Il costo non è l'argomento.** L'estrazione con Haiku costa circa 0,003 € a chiamata: a questi volumi sono i 1-2 € l'anno di `ARCHITECTURE.md` §9. Un server in casa non si ripaga con questo, si sceglie per altri motivi — non dipendere da nessuno, o non far uscire il testo incollato. Il secondo è un argomento serio e si lega a [ADR-0032](#adr-0032--il-testo-incollato-ha-una-scadenza): oggi il testo di un post, con dentro il numero di chi prende le prenotazioni, esce verso un fornitore terzo.
- **Lo schema forzato è la parte che non si può perdere.** È ciò che rende l'integrazione affidabile invece che quasi affidabile, e non è un'esclusiva di nessuno: `llama.cpp` ha le grammatiche, Ollama e vLLM hanno la decodifica guidata da JSON Schema, e quasi tutti espongono un endpoint compatibile OpenAI con `response_format`. La domanda da porsi prima di comprare hardware è se lo stack scelto ce l'ha, non se il modello è bravo.
- **Il Worker non arriva in salotto.** L'applicazione gira su Cloudflare (ADR-0002) e non può raggiungere una macchina su una rete domestica: servirebbe esporla, con quello che comporta. Va detto però che l'architettura **regge già** un endpoint inaffidabile — `struttura()` non solleva mai e il fallimento non blocca l'inserimento manuale (principio 5) — quindi una connessione casalinga qui è una scelta legittima, come non lo sarebbe su qualcosa di portante.
- **La riscrittura è contenuta e lo era per progetto.** Cambia `llm.ts` e basta: nessun altro file di `parse/` sa che esiste un modello. È il motivo per cui ADR-0034 ha scartato l'HTTP grezzo senza rimpianti.
