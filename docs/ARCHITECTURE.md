# Calendario Eventi Condiviso — Documento di Architettura

**Versione:** 1.0
**Data:** 19 agosto 2026
**Scopo del documento:** specifica tecnica completa da usare come contesto per lo sviluppo con Claude Code.

---

## 1. Problema e obiettivo

Un gruppo di organizzatori di concerti e festival (club, associazioni culturali, collettivi, promoter) inserisce le proprie date in un calendario condiviso. Il sistema li avvisa quando una nuova data **entra in conflitto** con una già inserita da un altro iscritto, così che possano coordinarsi _prima_ dell'annuncio pubblico.

**Metrica di successo:** gli organizzatori inseriscono le date in stato provvisorio _prima_ di confermarle. Se lo usano solo dopo l'annuncio, il prodotto ha fallito il suo scopo.

**Contesto operativo:** meno di 20 organizzazioni nel primo anno, contesto di alta fiducia, budget minimo, un solo manutentore part-time. Ogni decisione architetturale privilegia la semplicità operativa sulla scalabilità.

---

## 2. Principi di progetto

1. **Monolite.** Un solo repo, un solo deploy, un solo database.
2. **La logica di conflitto è codice puro e testato.** Funzioni senza I/O, con test unitari. È il cuore del prodotto e l'unica parte dove i bug sono costosi.
3. **La visibilità è un layer di serializzazione esplicito**, non un insieme di `if` sparsi nei template.
4. **Niente integrazioni fragili.** Nessuno scraping, nessun sync bidirezionale, nessuna dipendenza da API che possono chiudere.
5. **Degradazione elegante.** Se il geocoding o il parser LLM non rispondono, l'inserimento manuale funziona sempre.
6. **Dati esportabili.** L'utente può portarsi via tutto in JSON/CSV/ICS. Nessun lock-in.

---

## 3. Stack

| Layer            | Scelta                                                                                    | Note                                                  |
| ---------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Framework        | **SvelteKit 2** (TypeScript)                                                              | Full-stack: server load + form actions + endpoint API |
| ORM / migrazioni | **Drizzle ORM** + `drizzle-kit`                                                           | Schema come unica fonte di verità dei tipi            |
| Database         | **Supabase Postgres** (region EU — Frankfurt)                                             | Free tier; Postgres vero, non un'astrazione           |
| Driver DB        | `postgres` (postgres.js) su **Supavisor**, porta 6543, transaction mode, `prepare: false` | Obbligatorio in ambiente serverless                   |
| Auth             | **Supabase Auth**, magic link via email                                                   | `@supabase/ssr` per la gestione cookie/sessione       |
| Storage          | **Supabase Storage**                                                                      | Locandine e foto band                                 |
| Validazione      | **Zod** + `sveltekit-superforms`                                                          | Una sola definizione per client, server e tipi        |
| UI               | **Tailwind CSS** + **shadcn-svelte**                                                      |                                                       |
| Calendario       | **FullCalendar** (pacchetti core MIT)                                                     | Viste `dayGridMonth`, `timeGridWeek`, `listMonth`     |
| ICS              | `ical-generator`                                                                          | Feed sottoscrivibili + download singolo               |
| Geocoding        | **Photon** (Komoot) con fallback Nominatim, risultati cacheati su DB                      | Rispettare rate limit e attribuzione OSM              |
| Email            | **Resend** free tier                                                                      | Inviti, alert conflitto, digest                       |
| Cron             | **GitHub Actions** schedulato → chiama endpoint protetto da secret                        | Evita di tenere uno scheduler attivo                  |
| Hosting          | **Cloudflare Workers** via `adapter-cloudflare`                                           | Free tier reale, no cold start problematici           |
| Test             | **Vitest** (unit) + **Playwright** (smoke E2E)                                            |                                                       |

### Note vincolanti sull'ambiente

- **Le migrazioni girano dalla connessione diretta** (porta 5432), non dal pooler. Da locale o da CI, mai a runtime.
- **Il browser non parla mai direttamente con Supabase** per i dati di dominio. Solo l'auth passa dal client. Tutte le query di dominio passano dal server SvelteKit. Questo è il presupposto su cui si regge il modello di visibilità: va rispettato senza eccezioni.
- **RLS** va abilitata su tutte le tabelle con policy di default `deny all` come difesa in profondità. Il server usa la connessione privilegiata; RLS serve solo a rendere innocuo un eventuale leak di chiave anon.
- Se emergono frizioni con Cloudflare (limiti CPU su richieste pesanti), la via di fuga è `adapter-vercel` senza toccare il codice applicativo.

---

## 4. Modello dati

Tutti gli ID sono `uuid` con default `gen_random_uuid()`. Tutti i timestamp sono `timestamptz`. Timezone applicativo di riferimento: `Europe/Rome`.

### 4.1 Identità e organizzazioni

**`profiles`** — specchio applicativo di `auth.users`

| Campo                      | Tipo                  | Note                                             |
| -------------------------- | --------------------- | ------------------------------------------------ |
| `id`                       | uuid PK               | FK → `auth.users.id`                             |
| `display_name`             | text NOT NULL         |                                                  |
| `email`                    | text NOT NULL         |                                                  |
| `phone`                    | text                  | opzionale, per contatto rapido tra organizzatori |
| `is_platform_admin`        | boolean DEFAULT false | genera inviti, gestisce tassonomie               |
| `created_at`, `updated_at` | timestamptz           |                                                  |

**`organizations`**

| Campo                                                       | Tipo                 | Note                                                                            |
| ----------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `id`                                                        | uuid PK              |                                                                                 |
| `name`                                                      | text NOT NULL        |                                                                                 |
| `slug`                                                      | text UNIQUE NOT NULL |                                                                                 |
| `kind`                                                      | enum `org_kind`      | `club`, `associazione_culturale`, `collettivo`, `promoter`, `festival`, `altro` |
| `city`, `province`, `region`, `country`                     | text                 | `country` default `IT`                                                          |
| `lat`, `lon`                                                | double precision     | base geografica, usata come default per gli eventi                              |
| `website`, `instagram_url`, `facebook_url`, `email_contact` | text                 |                                                                                 |
| `default_conflict_radius_km`                                | integer DEFAULT 60   | preferenza dell'organizzazione                                                  |
| `notes`                                                     | text                 |                                                                                 |
| `created_at`, `updated_at`                                  | timestamptz          |                                                                                 |

**`memberships`**

| Campo             | Tipo                    | Note                       |
| ----------------- | ----------------------- | -------------------------- |
| `id`              | uuid PK                 |                            |
| `profile_id`      | uuid FK → profiles      |                            |
| `organization_id` | uuid FK → organizations |                            |
| `role`            | enum `member_role`      | `owner`, `admin`, `member` |
| `created_at`      | timestamptz             |                            |

UNIQUE `(profile_id, organization_id)`. Un profilo può appartenere a più organizzazioni; il contesto attivo è in sessione.

**`invites`**

| Campo             | Tipo                                | Note                                                |
| ----------------- | ----------------------------------- | --------------------------------------------------- |
| `id`              | uuid PK                             |                                                     |
| `code`            | text UNIQUE NOT NULL                | random 10 caratteri URL-safe                        |
| `organization_id` | uuid FK, nullable                   | se `NULL`, l'invitato crea una nuova organizzazione |
| `role`            | enum `member_role` DEFAULT `member` |                                                     |
| `email_hint`      | text                                | opzionale, per pre-compilare                        |
| `max_uses`        | integer DEFAULT 1                   |                                                     |
| `uses`            | integer DEFAULT 0                   |                                                     |
| `expires_at`      | timestamptz                         |                                                     |
| `created_by`      | uuid FK → profiles                  |                                                     |
| `created_at`      | timestamptz                         |                                                     |

### 4.2 Tassonomia generi

**`genres`**

| Campo        | Tipo                       | Note                                           |
| ------------ | -------------------------- | ---------------------------------------------- |
| `id`         | uuid PK                    |                                                |
| `slug`       | text UNIQUE NOT NULL       | `death-metal`                                  |
| `name`       | text NOT NULL              | `Death Metal`                                  |
| `parent_id`  | uuid FK → genres, nullable |                                                |
| `path`       | text NOT NULL              | materializzato: `metal.death-metal.tech-death` |
| `depth`      | integer NOT NULL           | 0 per le radici                                |
| `sort_order` | integer                    |                                                |

Indice su `path` (`text_pattern_ops`) per prefix matching. Il `path` è ricalcolato da trigger o da funzione applicativa al salvataggio: la tassonomia cambia raramente, non serve ottimizzare.

Tassonomia **chiusa**: solo i platform admin possono aggiungere generi. Il seed iniziale deve coprire almeno: Metal (con Death, Black, Doom, Sludge, Thrash, Grindcore, Metalcore, Post-Metal, Stoner, Tech Death, Djent), Punk/Hardcore, Rock (Prog, Psych, Garage, Alternative, Indie), Elettronica (Techno, Ambient, Industrial, Drum'n'Bass), Jazz, Cantautorale, Hip-Hop, Reggae/Dub, Folk/World, Sperimentale/Noise, Classica. Il seed va in un file versionato (`db/seeds/genres.ts`), non inserito a mano.

### 4.3 Artisti e venue

**`artists`**

| Campo                                                                                                          | Tipo                  | Note                                              |
| -------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------- |
| `id`                                                                                                           | uuid PK               |                                                   |
| `name`                                                                                                         | text NOT NULL         |                                                   |
| `name_normalized`                                                                                              | text NOT NULL         | lowercase, senza accenti/punteggiatura; per dedup |
| `mbid`                                                                                                         | uuid UNIQUE, nullable | MusicBrainz ID: chiave di deduplicazione forte    |
| `country`, `city`                                                                                              | text                  |                                                   |
| `formed_year`                                                                                                  | integer               |                                                   |
| `bio`                                                                                                          | text                  | markdown breve                                    |
| `image_url`                                                                                                    | text                  | Supabase Storage                                  |
| `website_url`, `instagram_url`, `facebook_url`, `bandcamp_url`, `spotify_url`, `youtube_url`, `soundcloud_url` | text                  |                                                   |
| `booking_email`, `booking_agency`                                                                              | text                  | informazione preziosa tra organizzatori           |
| `is_verified`                                                                                                  | boolean DEFAULT false | curato da un admin                                |
| `created_by`                                                                                                   | uuid FK → profiles    |                                                   |
| `created_at`, `updated_at`                                                                                     | timestamptz           |                                                   |

Indice UNIQUE su `name_normalized` (parziale, dove `mbid IS NULL`) per limitare i duplicati senza bloccare omonimie legittime risolte via MBID. Indice trigram (`pg_trgm`) su `name` per l'autocomplete locale.

**`artist_genres`** — `artist_id`, `genre_id`, `is_primary` boolean. PK composita.

**`venues`**

| Campo                                                             | Tipo                      | Note                             |
| ----------------------------------------------------------------- | ------------------------- | -------------------------------- |
| `id`                                                              | uuid PK                   |                                  |
| `name`                                                            | text NOT NULL             |                                  |
| `address`, `city`, `province`, `region`, `postal_code`, `country` | text                      |                                  |
| `lat`, `lon`                                                      | double precision NOT NULL |                                  |
| `capacity`                                                        | integer                   |                                  |
| `website`, `instagram_url`, `facebook_url`, `phone`, `email`      | text                      |                                  |
| `geocode_source`, `geocode_query`, `geocoded_at`                  | text / timestamptz        | tracciabilità e cache            |
| `notes`                                                           | text                      | es. "palco piccolo, no backline" |
| `created_by`                                                      | uuid FK → profiles        |                                  |
| `created_at`, `updated_at`                                        | timestamptz               |                                  |

I venue sono **condivisi** tra le organizzazioni: sono un bene comune del gruppo.

### 4.4 Eventi

**`events`**

| Campo                                                      | Tipo                         | Note                                                          |
| ---------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `id`                                                       | uuid PK                      |                                                               |
| `organization_id`                                          | uuid FK NOT NULL             | proprietario                                                  |
| `venue_id`                                                 | uuid FK, nullable            | `NULL` ammesso in stato `hold`                                |
| `status`                                                   | enum `event_status` NOT NULL | `draft`, `hold`, `confirmed`, `cancelled`                     |
| `title`                                                    | text NOT NULL                |                                                               |
| `subtitle`                                                 | text                         |                                                               |
| `description`                                              | text                         | markdown                                                      |
| `starts_at`                                                | timestamptz NOT NULL         | inizio concerto                                               |
| `ends_at`                                                  | timestamptz                  | fine stimata; se `NULL` si assume +4h                         |
| `doors_at`                                                 | timestamptz                  | apertura porte                                                |
| `is_multi_day`                                             | boolean DEFAULT false        | festival                                                      |
| `city`, `province`, `region`, `country`                    | text NOT NULL (`city`)       | **denormalizzati**: presenti anche senza venue                |
| `lat`, `lon`                                               | double precision             | copiati dal venue al salvataggio, o dal geocoding della città |
| `conflict_radius_km`                                       | integer, nullable            | override dell'organizzazione                                  |
| `is_free`                                                  | boolean DEFAULT false        |                                                               |
| `is_members_only`                                          | boolean DEFAULT false        | tesseramento ARCI/ACSI ecc.                                   |
| `price_presale`, `price_door`                              | numeric(8,2)                 |                                                               |
| `currency`                                                 | text DEFAULT `EUR`           |                                                               |
| `ticket_url`                                               | text                         |                                                               |
| `age_restriction`                                          | text                         |                                                               |
| `capacity_expected`                                        | integer                      |                                                               |
| `poster_url`                                               | text                         | Supabase Storage                                              |
| `facebook_event_url`, `instagram_post_url`, `external_url` | text                         |                                                               |
| `announce_at`                                              | timestamptz, nullable        | data prevista di annuncio pubblico (solo per `hold`)          |
| `internal_notes`                                           | text                         | **mai** visibile ad altre organizzazioni                      |
| `created_by`, `updated_by`                                 | uuid FK → profiles           |                                                               |
| `created_at`, `updated_at`                                 | timestamptz                  |                                                               |

Indici: `(starts_at)`, `(status, starts_at)`, `(organization_id, starts_at)`, `(lat, lon)`.

**`event_genres`** — `event_id`, `genre_id`, `is_primary` boolean. PK composita. Il genere della serata è indipendente da quello delle singole band.

**`event_lineup`**

| Campo                  | Tipo                                | Note                                                                           |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `id`                   | uuid PK                             |                                                                                |
| `event_id`             | uuid FK NOT NULL, ON DELETE CASCADE |                                                                                |
| `artist_id`            | uuid FK, nullable                   | `NULL` se l'artista non è ancora in anagrafica                                 |
| `artist_name_raw`      | text                                | usato quando `artist_id IS NULL`, o per "TBA"                                  |
| `billing`              | enum `billing_role`                 | `headliner`, `co_headliner`, `special_guest`, `support`, `opener`, `dj`, `tba` |
| `position`             | integer NOT NULL                    | ordine di locandina                                                            |
| `stage`                | text                                | multi-palco                                                                    |
| `day_date`             | date                                | per festival multi-giorno                                                      |
| `set_starts_at`        | timestamptz                         |                                                                                |
| `set_duration_minutes` | integer                             |                                                                                |
| `is_announced`         | boolean DEFAULT false               | rivelazione progressiva della lineup                                           |
| `notes`                | text                                |                                                                                |

Vincolo CHECK: `artist_id IS NOT NULL OR artist_name_raw IS NOT NULL`.

**`event_links`** — `id`, `event_id`, `label`, `url`, `sort_order`. Per link extra oltre a quelli tipizzati.

### 4.5 Conflitti

**`conflicts`**

| Campo                                    | Tipo                     | Note                                                                       |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `id`                                     | uuid PK                  |                                                                            |
| `event_a_id`, `event_b_id`               | uuid FK NOT NULL         | ordinati: `event_a_id < event_b_id` (CHECK)                                |
| `kind`                                   | enum `conflict_kind`     | `venue_clash`, `artist_overlap`, `geo_genre_overlap`, `same_day_proximity` |
| `severity`                               | enum `conflict_severity` | `low`, `medium`, `high`                                                    |
| `distance_km`                            | numeric(6,1)             |                                                                            |
| `genre_affinity`                         | numeric(3,2)             | 0.00–1.00                                                                  |
| `days_apart`                             | integer                  |                                                                            |
| `details`                                | jsonb                    | artisti condivisi, generi in comune                                        |
| `status`                                 | enum `conflict_status`   | `open`, `acknowledged`, `resolved`, `dismissed`                            |
| `acknowledged_by_a`, `acknowledged_by_b` | boolean DEFAULT false    |                                                                            |
| `resolution_note`                        | text                     |                                                                            |
| `resolved_by`                            | uuid FK, nullable        |                                                                            |
| `computed_at`, `updated_at`              | timestamptz              |                                                                            |

UNIQUE `(event_a_id, event_b_id, kind)`. I conflitti sono **persistiti** (non solo calcolati a volo) perché servono per notifiche, dashboard e per ricordare che due organizzatori si sono già parlati.

### 4.6 Supporto

**`calendar_feeds`** — `id`, `token` (UNIQUE, random 32 char), `profile_id`, `label`, `filters` jsonb (`{genres:[], radius_km, center_city, statuses:[], organization_ids:[]}`), `last_accessed_at`, `revoked_at`, `created_at`.

**`notifications`** — `id`, `profile_id`, `kind`, `payload` jsonb, `read_at`, `emailed_at`, `created_at`.

**`geocode_cache`** — `query_normalized` PK, `lat`, `lon`, `payload` jsonb, `source`, `created_at`.

**`parse_jobs`** — `id`, `profile_id`, `raw_text`, `source_hint`, `parsed_json` jsonb, `model`, `status`, `error`, `created_at`.

**`audit_log`** — `id`, `actor_profile_id`, `entity_type`, `entity_id`, `action`, `diff` jsonb, `created_at`. Popolato per eventi, conflitti e membership.

---

## 5. Modello di visibilità

Il punto più delicato del prodotto: **nessun organizzatore carica una lineup non annunciata su un calendario che vedono i concorrenti.** Lo stato `hold` esiste per questo.

### Matrice di visibilità

| Campo                     | `draft` | `hold` (altra org) | `confirmed` (altra org) | `cancelled` (altra org) | Propria org (ogni stato) |
| ------------------------- | ------- | ------------------ | ----------------------- | ----------------------- | ------------------------ |
| Esistenza dell'evento     | ✗       | ✓                  | ✓                       | ✓                       | ✓                        |
| Data (giorno)             | ✗       | ✓                  | ✓                       | ✓                       | ✓                        |
| Ora esatta                | ✗       | ✗                  | ✓                       | ✓                       | ✓                        |
| Città / provincia         | ✗       | ✓                  | ✓                       | ✓                       | ✓                        |
| Venue                     | ✗       | ✗                  | ✓                       | ✓                       | ✓                        |
| Titolo                    | ✗       | ✗                  | ✓                       | ✓                       | ✓                        |
| Genere primario           | ✗       | ✓                  | ✓                       | ✓                       | ✓                        |
| Generi secondari          | ✗       | ✗                  | ✓                       | ✓                       | ✓                        |
| Lineup                    | ✗       | ✗                  | ✓ (solo `is_announced`) | ✓                       | ✓                        |
| Locandina, prezzi, ticket | ✗       | ✗                  | ✓                       | ✓                       | ✓                        |
| Organizzazione + contatto | ✗       | ✓                  | ✓                       | ✓                       | ✓                        |
| `internal_notes`          | ✗       | ✗                  | ✗                       | ✗                       | ✓                        |
| `announce_at`             | ✗       | ✗                  | —                       | —                       | ✓                        |

Un evento in `hold` visto da un'altra organizzazione si presenta come: _"12 ottobre — Perugia (PG) — Metal — Associazione X — [contatta]"_. Abbastanza per far scattare la telefonata, non abbastanza per bruciare un annuncio.

Gli eventi `cancelled` restano visibili: liberano uno slot ed è un'informazione utile.

### Implementazione

Una singola funzione pura:

```ts
// src/lib/server/visibility.ts
type ViewerContext = {
	profileId: string;
	organizationIds: string[];
	isPlatformAdmin: boolean;
};

export function serializeEvent(
	event: EventWithRelations,
	viewer: ViewerContext
): PublicEvent | RedactedEvent | null;
```

Regole non negoziabili:

- **Nessun handler restituisce mai una riga `events` grezza al client.** Tutto passa da `serializeEvent`.
- Le query di lista filtrano già in SQL (`status != 'draft' OR organization_id = ANY(...)`), la serializzazione è il secondo strato.
- La funzione ha test unitari esaustivi: una asserzione per cella della matrice sopra. È il test suite più importante del progetto.

---

## 6. Motore di rilevamento conflitti

Codice puro in `src/lib/server/conflicts/`, senza accesso al DB: riceve l'evento candidato e un array di eventi esistenti, restituisce i conflitti.

### 6.1 Selezione dei candidati (SQL)

```
WHERE status IN ('hold','confirmed')
  AND organization_id <> :orgId
  AND id <> :eventId
  AND starts_at BETWEEN :day_start - INTERVAL '21 days'
                    AND :day_end   + INTERVAL '21 days'
```

La finestra di ±21 giorni serve al controllo di sovrapposizione artisti (una band non suona due volte a 50 km di distanza a due settimane di distanza). Per i controlli geografici si restringe poi allo stesso giorno.

Prefiltro geografico via bounding box prima dell'haversine:
`Δlat = radius/111.0`, `Δlon = radius/(111.0 * cos(lat_radianti))`.

### 6.2 Le quattro regole

**R1 — `venue_clash`** (severity `high`)
Stesso `venue_id` e sovrapposizione temporale degli intervalli `[doors_at ?? starts_at, ends_at ?? starts_at + 4h]`. È un errore materiale, non una scelta strategica: va segnalato con la massima evidenza.

**R2 — `artist_overlap`** (severity `high`)
Almeno un `artist_id` in comune, entro ±14 giorni (configurabile) e distanza ≤ 200 km. Considera solo lineup con `is_announced = true` oppure appartenenti alla propria organizzazione — altrimenti si rivelerebbe indirettamente una lineup segreta. **Attenzione: questa è la regola dove è più facile creare un leak di informazione.** Il messaggio all'utente deve dire _"un altro organizzatore ha già una data con una band della tua lineup"_ senza specificare quale band, se quell'evento è in `hold`.

**R3 — `geo_genre_overlap`** (severity `medium` o `high`)
Stesso giorno civile (`Europe/Rome`), distanza ≤ raggio effettivo, affinità di genere ≥ 0.4.
Raggio effettivo = `min(event_a.conflict_radius_km ?? org_a.default, event_b...)`.
Severity `high` se affinità ≥ 0.7 **e** distanza ≤ metà del raggio.

**R4 — `same_day_proximity`** (severity `low`)
Stesso giorno, distanza ≤ raggio, affinità di genere < 0.4. Informativo: "c'è un'altra serata in zona, generi diversi".

### 6.3 Affinità di genere

Basata sui `path` materializzati. Per ogni coppia di generi (a, b) dei due eventi:

- `path` identico → 1.0
- uno è prefisso dell'altro → `0.9 - 0.1 * differenza_di_profondità`
- prefisso comune di profondità _d_, profondità massima _m_ → `d / (m + 1)`
- nessun prefisso comune → 0.0

L'affinità dell'evento è il **massimo** su tutte le coppie, con i generi `is_primary` pesati ×1.0 e i secondari ×0.7.

Esempi attesi (da usare come test): Tech Death vs Death Metal → 0.8; Death Metal vs Black Metal → 0.5 (radice Metal comune a profondità 1); Death Metal vs Jazz → 0.0.

### 6.4 Riconciliazione

Su ogni salvataggio di evento (o cambio di stato/data/luogo/lineup/generi):

1. Ricalcola i conflitti per quell'evento.
2. `UPSERT` dei conflitti trovati; i conflitti spariti passano a `status = 'resolved'` con nota automatica (non vengono cancellati: la storia serve).
3. Genera notifiche per **entrambe** le organizzazioni coinvolte sui conflitti nuovi con severity ≥ `medium`.
4. Un job notturno (GitHub Actions) ricalcola tutta la finestra futura, per recuperare eventuali derive.

### 6.5 Preview live nel form

`POST /api/conflicts/preview` riceve la bozza del form (non ancora salvata), esegue lo stesso motore in sola lettura, restituisce l'elenco dei conflitti. Chiamata con debounce di 600 ms sui campi rilevanti (data, città/venue, generi, lineup).

**Il warning non blocca mai il salvataggio.** Mostra: severity, controparte, distanza, giorno, e un pulsante di contatto diretto. L'obiettivo è la telefonata, non il divieto.

---

## 7. Rotte

### Pagine

```
/login                        magic link
/invite/[code]                accettazione invito → join o creazione org
/onboarding                   crea/completa organizzazione
/(app)/                       redirect a /calendar
/(app)/calendar               FullCalendar, filtri (genere, raggio, org, stato)
/(app)/events/new
/(app)/events/[id]
/(app)/events/[id]/edit
/(app)/conflicts              dashboard conflitti aperti
/(app)/artists                anagrafica condivisa + ricerca
/(app)/artists/[id]
/(app)/venues
/(app)/venues/[id]
/(app)/org                    profilo organizzazione, membri, inviti
/(app)/settings/feeds         gestione feed ICS
/(app)/settings/notifications
/admin/genres                 solo platform admin
```

### Endpoint API

| Metodo | Path                                             | Scopo                                 |
| ------ | ------------------------------------------------ | ------------------------------------- |
| POST   | `/api/conflicts/preview`                         | conflitti su bozza non salvata        |
| POST   | `/api/parse`                                     | paste-to-parse (§9)                   |
| GET    | `/api/artists/search?q=`                         | anagrafica locale + proxy MusicBrainz |
| GET    | `/api/geocode?q=`                                | Photon/Nominatim con cache            |
| GET    | `/api/ics/[token].ics`                           | feed sottoscrivibile filtrato         |
| GET    | `/api/events/[id].ics`                           | singolo evento, download              |
| GET    | `/api/export?format=json\|csv\|jsonld&from=&to=` | export massivo                        |
| GET    | `/api/events/[id]/social-copy?platform=`         | testo pronto per il post              |
| POST   | `/api/cron/recompute`                            | protetto da header secret             |
| POST   | `/api/cron/digest`                               | idem                                  |

Le mutazioni di dominio usano **form actions** di SvelteKit, non endpoint REST: progressive enhancement gratis e validazione condivisa con superforms.

---

## 8. Export e calendari

### Feed ICS sottoscrivibile — la feature che conta più di tutte

`GET /api/ics/[token].ics` restituisce `text/calendar` con:

- `X-WR-CALNAME`, `REFRESH-INTERVAL;VALUE=DURATION:PT12H`, `X-PUBLISHED-TTL:PT12H`
- `UID` stabile: `{event_id}@calendario.example`
- `SEQUENCE` incrementato ad ogni modifica (altrimenti Google non aggiorna)
- `STATUS`: `TENTATIVE` per `hold`, `CONFIRMED`, `CANCELLED`
- `SUMMARY`/`DESCRIPTION` prodotti da `serializeEvent`: **il feed rispetta la matrice di visibilità**
- `GEO`, `LOCATION`, `URL`, `CATEGORIES` (generi)

Il token è un segreto in un URL: l'endpoint è pubblico senza auth (i client calendario non fanno login). Quindi il feed contiene solo ciò che quel profilo può vedere, il token è revocabile, e va servito con `Cache-Control: private, max-age=3600` e senza indicizzazione.

L'utente incolla l'URL in Google Calendar ("Da URL") o Apple Calendar ("Nuova iscrizione calendario"). Niente OAuth, niente refresh token, niente webhook: un endpoint e un file.

### Download singolo

`/api/events/[id].ics` con `Content-Disposition: attachment`. In pagina, accanto, i link "Aggiungi a Google Calendar" (URL `render?action=TEMPLATE`) e Outlook Web, generati lato server.

### Export dati

- **JSON** — schema documentato e stabile, per reimport
- **CSV** — una riga per evento, lineup concatenata; per chi lavora in foglio di calcolo
- **JSON-LD** `schema.org/MusicEvent` — incluso anche nella pagina dettaglio per SEO e aggregatori

### Copy per i social

`/api/events/[id]/social-copy?platform=instagram|facebook|telegram` genera testo pre-formattato (lineup, orari, prezzi, hashtag dai generi, link ticket) pronto da copiare. **Non pubblica nulla:** la pubblicazione automatica di eventi su Meta non è disponibile via API. Questa è la sostituzione onesta.

---

## 9. Paste-to-parse (import "da Facebook/Instagram")

**Perché non c'è un import vero:** Meta ha deprecato la lettura pubblica degli eventi delle Pagine e Instagram non modella affatto il concetto di evento. Lo scraping è fragile e contro i ToS. La sostituzione funzionante:

1. L'utente copia il testo del post/evento e lo incolla in un textarea.
2. `POST /api/parse` invia il testo a un LLM con un prompt che impone output JSON conforme allo schema Zod del form.
3. Il risultato **pre-compila il form**, non crea l'evento. L'utente rivede e conferma sempre.
4. Le band riconosciute vengono cercate in anagrafica e in MusicBrainz; ogni match richiede conferma esplicita.
5. Il job resta in `parse_jobs` per debug e per misurare la qualità dell'estrazione.

Vincoli: modello economico (classe Haiku/Flash), timeout 20 s, rate limit per profilo, il fallimento non blocca mai l'inserimento manuale. Costo stimato: ordine di 1-2 € l'anno a questi volumi.

Accetta anche l'incolla di un file `.ics` o di un CSV: parsing deterministico, nessun LLM coinvolto. Da preferire quando la fonte lo permette.

---

## 10. Notifiche

| Trigger                                          | Canale                   | Destinatari                                                                                      |
| ------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| Nuovo conflitto severity ≥ `medium`              | email immediata + in-app | entrambe le organizzazioni                                                                       |
| Conflitto risolto                                | in-app                   | entrambe                                                                                         |
| Invito ricevuto                                  | email                    | invitato                                                                                         |
| Digest settimanale (lunedì mattina)              | email                    | tutti gli iscritti: nuove date della settimana, conflitti aperti, `hold` in scadenza di annuncio |
| `hold` con `announce_at` passata e ancora `hold` | email di sollecito       | organizzazione proprietaria                                                                      |

Le email di conflitto rispettano la matrice di visibilità: mai includere dettagli di un evento in `hold` altrui.

I cron sono GitHub Actions che chiamano gli endpoint `/api/cron/*` con un header segreto. Se serve un canale Telegram (community già esistente), si aggiunge come sink alternativo dello stesso layer di notifica: il layer va progettato con interfaccia `NotificationSink` per non doverlo riscrivere.

---

## 11. Fuori scope in v1 (deliberatamente)

- Sync bidirezionale con Google/Apple Calendar (OAuth + refresh token + webhook: settimane di lavoro per marginale beneficio sul feed ICS in lettura)
- Pubblicazione automatica su Facebook/Instagram (non possibile)
- Scraping di qualunque piattaforma
- Vista pubblica per il pubblico dei concerti (aggiungibile dopo: è una rotta read-only con serializzatore già pronto)
- Biglietteria, pagamenti, gestione ospitalità/rider
- App nativa (PWA installabile è sufficiente)
- Multilingua (solo italiano; i testi vanno però tenuti in un unico modulo per non rendere doloroso un futuro i18n)
- Notifiche push

---

## 12. Piano di implementazione

Ogni fase deve terminare con l'applicazione funzionante e deployata. Nessuna fase lascia il progetto in stato non avviabile.

**Fase 0 — Fondazioni**
Scaffolding SvelteKit + TS + Tailwind + shadcn-svelte. Progetto Supabase in EU. Drizzle configurato con pooler e migrazioni via connessione diretta. Deploy su Cloudflare funzionante. Auth magic link con `@supabase/ssr`, hook di sessione, rotte protette. RLS `deny all` su tutte le tabelle. CI: lint, typecheck, test.
_Criterio di fine:_ login e logout in produzione.

**Fase 1 — Anagrafiche**
Schema completo (§4) e migrazioni. Seed generi. Flusso inviti → creazione organizzazione → membership con ruoli. CRUD venue con geocoding e cache. CRUD artisti con autocomplete MusicBrainz e deduplica per MBID/nome normalizzato.
_Criterio di fine:_ due utenti in due organizzazioni diverse, con band e venue inseriti.

**Fase 2 — Eventi e calendario**
Schema Zod del form completo con superforms: dati base, luogo, orari, ticketing, lineup dinamica (aggiungi/riordina/rimuovi), generi serata e band, link, upload locandina. Macchina a stati `draft → hold → confirmed → cancelled` con transizioni permesse e audit. **`serializeEvent` con test unitari completi sulla matrice §5.** Calendario FullCalendar con filtri. Pagina dettaglio evento.
_Criterio di fine:_ un evento in `hold` di un'organizzazione appare correttamente redatto all'altra. Testato, non solo verificato a occhio.

**Fase 3 — Motore conflitti**
Modulo puro con le quattro regole e il calcolo di affinità, con test unitari (inclusi i casi numerici di §6.3). Persistenza e riconciliazione. Preview live nel form con debounce. Dashboard conflitti con acknowledge e nota di risoluzione. Cron di ricalcolo.
_Criterio di fine:_ inserendo una data in conflitto, il warning appare durante la compilazione e il conflitto è persistito per entrambe le parti.

**Fase 4 — Interoperabilità**
Feed ICS con token, filtri, `SEQUENCE`, `STATUS`. ICS singolo evento e link add-to-calendar. Export JSON/CSV/JSON-LD. Generatore di copy social. JSON-LD nella pagina dettaglio.
_Criterio di fine:_ un feed sottoscritto in Google Calendar e in Apple Calendar mostra le date corrette e si aggiorna dopo una modifica.

**Fase 5 — Import assistito**
Paste-to-parse con schema forzato, matching band, pre-compilazione form. Import ICS/CSV deterministico.
_Criterio di fine:_ incollando il testo di un evento reale, il form risulta compilato in modo utilizzabile.

**Fase 6 — Rifinitura**
Notifiche email e digest. Audit log consultabile. PWA (manifest, offline shell). Accessibilità (navigazione da tastiera nel calendario, focus management nel form lungo, contrasti). Smoke test Playwright sui flussi critici. README e runbook operativo.

---

## 13. Struttura del repository

```
src/
  lib/
    server/
      db/            schema.ts, migrations/, seeds/, client.ts
      conflicts/     engine.ts, rules.ts, genre-affinity.ts, geo.ts, reconcile.ts
      visibility.ts
      ics/
      parse/
      geocode/
      musicbrainz/
      notifications/  sinks/{email,inapp,telegram}.ts
      audit.ts
    schemas/         zod: event.ts, artist.ts, venue.ts, organization.ts
    components/
    utils/
  routes/
tests/
  unit/            conflicts, visibility, genre-affinity, ics
  e2e/
db/seeds/genres.ts
docs/               questo documento, runbook, decisioni
```

---

## 14. Variabili d'ambiente

```
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL              # pooler 6543, transaction mode, ?prepare=false
DIRECT_DATABASE_URL       # 5432, solo migrazioni
RESEND_API_KEY
EMAIL_FROM
LLM_API_KEY
LLM_MODEL
GEOCODER_BASE_URL
GEOCODER_USER_AGENT       # richiesto dalla policy Nominatim
CRON_SECRET
PUBLIC_APP_URL
```

---

## 15. Strategia di test

**Test unitari obbligatori** (sono il cuore, non un contorno):

- `genre-affinity`: tabella di casi attesi, inclusi quelli di §6.3
- `conflicts/rules`: una suite per regola, con casi limite — mezzanotte, eventi a cavallo di due giorni, `ends_at` nullo, raggi asimmetrici tra le due organizzazioni, DST
- `visibility`: una asserzione per cella della matrice §5, più il caso specifico "R2 non deve rivelare quale band"
- `ics`: snapshot dell'output, validazione con un parser ICS
- `geo/haversine`: distanze note

**E2E (Playwright)**: invito → registrazione → creazione evento → comparsa conflitto per la seconda organizzazione → sottoscrizione feed ICS.

---

## 16. Note operative

- **Timezone.** Tutto `timestamptz`. Il "giorno civile" per la regola R3 si calcola con `date_trunc('day', starts_at AT TIME ZONE 'Europe/Rome')`. I test devono includere una data in DST e una fuori.
- **GDPR.** Dati personali minimi (nome, email, telefono opzionale). Hosting EU. Privacy policy e informativa necessarie, con il titolare del trattamento identificato prima del lancio pubblico: va deciso chi è formalmente titolare (una delle associazioni, presumibilmente) e non lasciato implicito.
- **Backup.** Il free tier di Supabase non garantisce backup adeguati: schedulare un `pg_dump` settimanale via GitHub Actions su artifact cifrato. Non opzionale.
- **Attribuzione OSM** obbligatoria dove si mostrano dati di geocoding.
- **Rate limit** su `/api/parse`, `/api/geocode` e `/api/ics/[token]` per profilo/token.
- **Migrazione futura fuori dal free tier:** essendo Postgres standard e SvelteKit adapter-agnostico, lo spostamento su VPS o su Vercel non richiede riscritture. Nessun servizio proprietario nel percorso critico eccetto Supabase Auth, sostituibile.

---

## 17. Punti aperti da decidere prima della Fase 2

1. **Raggio di default** di 60 km: è il valore giusto per l'area geografica reale del gruppo? Va tarato su come ragionano davvero gli organizzatori.
2. **Finestra artisti** di ±14 giorni per R2: dipende dalle clausole di esclusiva tipiche nei loro contratti di booking.
3. La lineup in `hold` è **completamente** invisibile ad altre organizzazioni: sufficiente a farli fidare, o serve anche poter marcare un intero evento come "non mostrare nemmeno la data"? (Quest'ultima opzione svuoterebbe però il senso del calendario.)
4. Serve un ruolo di **moderatore** che possa correggere anagrafiche band e venue di tutti?
5. Verificare, in Fase 5, lo stato attuale delle API Meta: la conclusione di §9 è solida ma va riconfermata al momento dell'implementazione.
