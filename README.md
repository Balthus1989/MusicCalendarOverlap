# Calendario Eventi Condiviso

[![CI](https://github.com/Balthus1989/MusicCalendarOverlap/actions/workflows/ci.yml/badge.svg)](https://github.com/Balthus1989/MusicCalendarOverlap/actions/workflows/ci.yml)

Un calendario condiviso fra organizzatori di concerti, che li avvisa quando due
date stanno per pestarsi i piedi — **prima** che qualcuno annunci.

Club, associazioni culturali, collettivi, promoter e festival inseriscono le
proprie serate in un calendario comune. Il sistema confronta ogni data nuova con
quelle già presenti e segnala le sovrapposizioni: stesso locale, stessa band a
pochi giorni di distanza, stessa sera e stesso genere a venti chilometri.

**L'obiettivo non è vietare niente: è far partire una telefonata.**

---

## Il problema, e perché serve uno stato «opzionata»

Un calendario condiviso fra organizzatori ha un difetto ovvio: nessuno ci carica
una serata che non ha ancora annunciato, perché la vedrebbero i concorrenti.
Senza quelle, però, il calendario segnala le sovrapposizioni quando è troppo
tardi per rimediare.

La risposta è uno stato **`opzionata`** con visibilità ridotta. Una data
opzionata da un'altra organizzazione si vede così:

> **12 ottobre** — Perugia (PG) — Metal — Associazione X — _[contatta]_

Giorno, città, genere e con chi parlare. Non il titolo, non l'orario, non il
locale, non una riga di lineup. Abbastanza per accorgersi di una sovrapposizione
e alzare il telefono, non abbastanza per bruciare un annuncio.

Da lì una data passa a `confermata` e diventa visibile per intero. Le date
`annullate` restano visibili apposta: liberano uno slot, ed è un'informazione
che serve a qualcun altro.

La regola vale ovunque, feed ICS ed export compresi: **nessuna riga di database
raggiunge il browser senza passare da un serializzatore**, e la matrice completa
di chi vede cosa è coperta da una asserzione di test per ogni cella.

---

## Funzionalità

### Calendario e date

- Vista mese, settimana ed elenco, con filtri per stato, genere (sottogeneri
  inclusi), organizzazione e distanza da una città.
- Ciclo di vita completo: `bozza → opzionata → confermata → annullata`, con le
  transizioni permesse e ogni cambio registrato.
- Scheda serata con lineup ordinata, generi, orari, prezzi, biglietteria,
  locandina e link esterni.
- **Rivelazione progressiva della lineup**: ogni band si annuncia quando si
  vuole, e quelle non annunciate non escono da nessuna parte.

### Rilevamento delle sovrapposizioni

Quattro regole, tutte con una severità:

| Regola                       | Quando scatta                                                |
| ---------------------------- | ------------------------------------------------------------ |
| **Stesso locale**            | due date che si sovrappongono nello stesso posto             |
| **Band in comune**           | stessa band entro ±7 giorni e 200 km, severità per giorni    |
| **Stessa sera, stesso giro** | stesso giorno, entro il raggio, generi affini                |
| **Stessa sera, in zona**     | stesso giorno, entro il raggio, generi lontani — informativo |

L'affinità fra generi si calcola sulla gerarchia della tassonomia: Tech Death e
Death Metal sono vicini, Death Metal e Jazz no.

L'avviso compare **mentre si compila il form**, prima di salvare, e non blocca
mai niente: accanto c'è il contatto della controparte. Una dashboard raccoglie i
conflitti aperti, con presa visione e nota di come è andata a finire.

### Notifiche

Avvisi in applicazione e su **Telegram**: conflitto nuovo, conflitto risolto,
digest settimanale del lunedì, sollecito quando una data opzionata ha passato la
propria data di annuncio. Ogni avviso nasce già scritto per il suo destinatario
e rispetta la visibilità: se non c'è niente che quella persona possa sapere, non
nasce nessun avviso.

Il digest non parte se non c'è niente da dire.

### Calendari ed export

- **Feed ICS sottoscrivibile**, da incollare in Google Calendar o Apple
  Calendar. Filtrabile, con token revocabile, e rispetta la matrice di
  visibilità come tutto il resto.
- Download `.ics` della singola data e link «Aggiungi a Google Calendar».
- Export **JSON**, **CSV** e **JSON-LD** (`schema.org/MusicEvent`).
- Generatore di testo pronto da incollare su Instagram, Facebook o Telegram.

### Import assistito

Si incolla il testo di un annuncio — o un file `.ics`, o un CSV — e il **form
esce compilato**. L'import riempie i campi, non crea la data: lo stato, le band
annunciate e il collegamento all'anagrafica restano decisioni di chi sta
inserendo. `.ics` e CSV sono deterministici; per il testo libero c'è un modello
linguistico, e se non risponde l'inserimento a mano funziona come sempre.

### Anagrafiche condivise

Artisti e locali sono un bene comune del gruppo, non di chi li ha inseriti.
Artisti con deduplica via MusicBrainz, locali con geocoding e cache. Un ruolo di
**moderatore**, trasversale alle organizzazioni, può correggere e unire le
schede.

### Il resto

- **Accesso solo su invito**: l'invito arriva per email e si entra con un magic link. Niente password.
- Più organizzazioni per profilo, con ruoli (`owner`, `admin`, `member`).
- **Registro delle modifiche** consultabile, e sopra il registro la metrica che
  dice se il prodotto sta funzionando: quante date passano da `opzionata` prima
  di essere confermate.
- **PWA installabile** con guscio offline, e un layout pensato per il telefono —
  navigazione in basso, calendario a elenco, bersagli da 44px.

---

## Stack

**SvelteKit 2** · TypeScript · **Drizzle ORM** · **Supabase** Postgres (UE) ·
Tailwind + shadcn-svelte · FullCalendar · **Cloudflare Workers**

Un repo, un deploy, un database. Nessuna coda, nessun servizio accessorio,
nessuna integrazione che possa chiudere da un giorno all'altro. Tutto gira sui
piani gratuiti: l'unica voce che costerebbe qualcosa è il modello dell'import da
testo libero, oggi non configurato.

I dati si portano via in JSON, CSV o ICS: nessun lock-in.

---

## Stato

**In produzione**, tutte e sette le fasi:

```
https://calendario-eventi-condiviso.rendar55.workers.dev
```

Provato sull'applicazione in esecuzione, non solo dai test: il login, la
matrice di visibilità fra due organizzazioni vere, i conflitti da entrambi i
lati, il feed ICS sottoscritto in Google e Apple Calendar, le notifiche
Telegram, i job notturni su GitHub Actions e la PWA installata.

527 test unitari, 15 smoke test end-to-end contro un database vero.

Lo stato per esteso — cosa è stato verificato, come, e cosa no — sta nel
[runbook](docs/RUNBOOK.md).

---

## Cosa manca

**Prima di aprirlo a organizzazioni esterne**

- [x] ~~Decidere chi è formalmente **titolare del trattamento dei dati**, e
      scrivere l'informativa.~~ Fatto: il titolare è il manutentore a titolo
      personale, e l'informativa è la pagina [`/privacy`](src/routes/privacy/+page.svelte).
      Nomina esplicitamente anche il testo che gli utenti incollano
      nell'import, che contiene regolarmente dati di terzi.
- [ ] Provare l'accessibilità **con uno screen reader vero**. I difetti
      misurabili sono stati corretti; questa verifica vale solo se la fa una
      persona che quello strumento lo usa davvero.

**Import da testo libero**

- [ ] Tarare l'estrazione su annunci reali. Il codice è completo e le due strade
      deterministiche (`.ics`, CSV) sono verificate, ma nessun post vero è
      ancora passato da un modello, quindi la qualità non è misurata. È
      **sospeso e non dimenticato**: si valuta un modello ospitato in locale, e
      un prompt tarato su un modello non si trasferisce a un altro.

**Rifiniture per il telefono**

- [ ] Barra di azione fissa nel form serata, con l'avviso di sovrapposizione
      sempre visibile accanto al pulsante di salvataggio.
- [ ] Le tabelle di Locali e Registro come schede sotto i 640px: oggi scorrono
      in orizzontale.

**Se qualcuno lo chiede**

- [ ] Vista pubblica in sola lettura per il pubblico dei concerti. È una rotta
      read-only e il serializzatore c'è già.

---

## Fuori scope, deliberatamente

Non è una lista di cose da fare: è una lista di cose **decise di non fare**, con
il perché in [`docs/DECISIONS.md`](docs/DECISIONS.md).

- **Import da Facebook e Instagram.** Leggere gli eventi delle Pagine è
  riservato ai Facebook Marketing Partner, e Instagram non modella affatto il
  concetto di evento. Lo scraping è fragile e contro i termini d'uso. Al suo
  posto c'è l'import assistito.
- **Pubblicazione automatica sui social.** Non è possibile via API. Al suo posto
  c'è il generatore di testo da incollare.
- **Sincronizzazione bidirezionale** con Google o Apple Calendar. Settimane di
  lavoro fra OAuth, refresh token e webhook, per un beneficio marginale rispetto
  al feed ICS in lettura.
- Biglietteria, pagamenti, gestione ospitalità. App nativa: la PWA basta.
  Multilingua: solo italiano.

---

## Documentazione

| Documento                                      | Che cosa contiene                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modello dati, matrice di visibilità, motore conflitti, piano a fasi     |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)       | 42 voci ADR: ogni decisione con il **perché**, comprese quelle scartate |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md)           | Installazione, comandi, deploy, manutenzione, difetti già incontrati    |

Le decisioni non si cancellano mai: se una viene ribaltata si marca come
superata e si scrive una voce nuova. Fra sei mesi il «cosa» si legge dal codice,
il «perché» no.

---

## Sviluppo

Serve un progetto Supabase e Node 24, che è la versione della CI. La
procedura completa — chiavi, RLS, migrazioni, primo accesso — è nel
[runbook](docs/RUNBOOK.md#setup).

```bash
npm install
npm run db:migrate     # applica le migrazioni (connessione diretta, porta 5432)
npm run db:seed        # semina la tassonomia dei generi
npm run dev
```

| Comando               | Che cosa fa                                              |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | dev server                                               |
| `npm run check`       | svelte-check e typecheck                                 |
| `npm run test`        | test unitari (vitest)                                    |
| `npm run test:e2e`    | smoke test Playwright: database vero, si pulisce da solo |
| `npm run db:generate` | genera una migrazione dallo schema                       |
| `npm run deploy`      | build e deploy su Cloudflare Workers                     |

Tre regole valgono più delle altre, e stanno per esteso in
[`CLAUDE.md`](CLAUDE.md):

1. Il browser non parla mai direttamente con Supabase per i dati di dominio.
2. Nessun handler restituisce una riga grezza: eventi e conflitti passano da un
   serializzatore.
3. Le regole del motore conflitti sono codice puro senza I/O, sempre coperto da
   test unitari.

---

## Licenza

Nessuna licenza dichiarata: senza un file `LICENSE` valgono i termini
predefiniti del diritto d'autore, e il codice non è riutilizzabile da terzi.
