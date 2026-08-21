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

**Data:** 2026-08-19 · **Stato:** Provvisoria — riconfermare in Fase 5

**Contesto.** L'import da FB/IG era un requisito iniziale esplicito. Meta ha però deprecato la lettura pubblica degli eventi delle Pagine e Instagram non modella affatto il concetto di evento. Lo scraping è fragile e contro i ToS.

**Decisione.** L'utente incolla il testo del post, un LLM lo struttura secondo lo schema Zod del form, il risultato **pre-compila il form** senza mai creare l'evento automaticamente. In parallelo, import deterministico da ICS e CSV, da preferire quando la fonte lo permette.

**Motivazioni.** Copre il bisogno reale (non ridigitare tutto) senza dipendere da un'API che non esiste e senza costruire uno scraper che si rompe di sabato sera.

**Conseguenze.** Unico costo variabile del progetto: trascurabile a questi volumi (ordine di 1-2 € l'anno con un modello economico). Il fallimento del parser non blocca mai l'inserimento manuale.

**Perché provvisoria.** Lo stato delle API Meta va riconfermato al momento dell'implementazione, non dato per assodato sulla base di questa nota.

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
| 6   | Canale Telegram come sink di notifica aggiuntivo, dato che la community esiste già?                                            | Fase 6           |
