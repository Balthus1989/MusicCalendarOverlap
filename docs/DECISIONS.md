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

**Decisione.** Supabase free tier, region EU (Frankfurt). Auth con magic link.

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

## ADR-0015 — Lo schema `auth` di Supabase è dichiarato in Drizzle, ma migrato in forma idempotente

**Data:** 2026-08-19 · **Stato:** Accettata

**Contesto.** `profiles.id` è una foreign key verso `auth.users.id`, tabella creata e gestita da Supabase. Perché Drizzle possa esprimere quella foreign key, `auth.users` va dichiarata nello schema TypeScript. Ma `drizzle-kit generate` non distingue fra "tabella che possiedo" e "tabella che referenzio": emette un `CREATE TABLE "auth"."users"` che su Supabase fallirebbe, perché quella tabella esiste già. `schemaFilter: ['public']` non risolve: agisce sull'introspezione, non sulla generazione.

**Decisione.** Si dichiara `auth.users` come `pgSchema('auth').table(...)` con la sola colonna `id`, e nella migrazione si sostituisce a mano la creazione con la forma idempotente:

```sql
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE TABLE IF NOT EXISTS "auth"."users" ("id" uuid PRIMARY KEY NOT NULL);
```

**Motivazioni.** Su Supabase entrambe le istruzioni sono no-op e la migrazione passa. Su un Postgres vuoto — un database di scarto per provare un ripristino, o un'istanza locale — la foreign key resta creabile invece di far fallire l'intera catena di migrazioni. L'alternativa, rinunciare al `.references()` e scrivere il vincolo in SQL grezzo, toglierebbe a Drizzle la conoscenza della relazione senza guadagnare nulla.

**Alternative scartate.**

- _Nessuna foreign key verso `auth.users`_: l'integrità fra profilo e utente è esattamente ciò che rende `profiles` uno specchio affidabile. Rinunciarvi significherebbe accettare profili orfani.
- _Migrazione scritta interamente a mano_: perde il vantaggio principale di Drizzle, cioè lo schema come unica fonte di verità.

**Conseguenze.** Il passaggio va **ricontrollato a ogni `npm run db:generate`**: drizzle-kit può riemettere la creazione non condizionata, e la migrazione si scoprirebbe rotta solo al deploy. È annotato nel file di migrazione e nel runbook del README. Vale solo per la prima migrazione: dallo snapshot in poi la tabella risulta già esistente.

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
| 1   | Raggio di conflitto di default: 60 km è un'ipotesi da tarare sulla geografia reale del gruppo                                  | Fase 3           |
| 2   | Finestra di ±14 giorni per la sovrapposizione artisti: dipende dalle clausole di esclusiva nei loro contratti di booking       | Fase 3           |
| 3   | ~~Serve un ruolo di moderatore con poteri di correzione e merge su anagrafiche artisti e venue?~~ **Chiusa: sì, vedi ADR-0016.** Resta da capire con gli organizzatori chi nominare, e se lo strumento di merge serva davvero. | ~~Fase 1~~ chiusa |
| 4   | La visibilità ridotta in `hold` è sufficiente a far fidare gli organizzatori? Va verificata con loro prima di costruirci sopra | Fase 2           |
| 5   | Chi è formalmente titolare del trattamento dei dati: una delle associazioni o il manutentore a titolo personale?               | Prima del lancio |
| 6   | Canale Telegram come sink di notifica aggiuntivo, dato che la community esiste già?                                            | Fase 6           |
