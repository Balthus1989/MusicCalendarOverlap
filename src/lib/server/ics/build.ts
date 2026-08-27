/**
 * Generazione ICS (ARCHITECTURE.md §8, ADR-0011).
 *
 * Il feed sottoscrivibile è la feature che conta più di tutte: un endpoint e
 * un file, contro OAuth, refresh token e webhook di un sync bidirezionale.
 *
 * Il file è **codice puro**: entra un elenco di eventi già serializzati, esce
 * una stringa. Nessuna query, nessun `fetch`, nessuna variabile d'ambiente.
 * È la stessa disciplina del motore conflitti, e per la stessa ragione: qui
 * si può sbagliare in modo silenzioso — un `SEQUENCE` che non cresce, una
 * descrizione che racconta una lineup non annunciata — e un test è l'unico
 * modo di accorgersene prima di un organizzatore.
 *
 * **Il contenuto passa da `serializeEvent()` e da lì soltanto.** Le funzioni
 * qui sotto leggono `EventoSerializzato`, non `EventWithRelations`: un campo
 * che la matrice di §5 non lascia uscire non è proprio raggiungibile da questo
 * file. È il vincolo di ADR-0005 applicato al feed, e la ragione per cui
 * l'intero modulo non conosce il tipo grezzo.
 */
import ical, { ICalEventStatus, type ICalEventData } from 'ical-generator';
import { ETICHETTE_LOCANDINA, ETICHETTE_STATO } from '$lib/events';
import { fineEffettiva } from '$lib/time';
import { slugify } from '$lib/server/text';
import type { EventoSerializzato, EventoCompleto } from '$lib/server/visibility';
import { titoloVisibile } from '$lib/server/visibility';
import type { EventStatus } from '$lib/server/db/schema';

/** Ogni quanto un client deve richiedere di nuovo il feed. */
export const TTL_SECONDI = 12 * 60 * 60;

/**
 * L'origine del `SEQUENCE`: 1° gennaio 2026, in UTC.
 *
 * Non è una data significativa, è solo abbastanza recente. Vedi `sequenzaDa`.
 */
const EPOCA_SEQUENCE_MS = Date.UTC(2026, 0, 1);

/** RFC 5545: `SEQUENCE` è un intero, e gli interi di iCalendar sono a 32 bit. */
const SEQUENCE_MASSIMO = 2_147_483_647;

/**
 * Il numero di versione che i client calendario usano per accorgersi di una
 * modifica.
 *
 * È l'errore classico di questa integrazione, quello che ADR-0011 elenca per
 * nome: senza un `SEQUENCE` che cresce, **Google non aggiorna mai** un evento
 * già importato. Si può spostare una data di un mese e nei calendari di tutti
 * resta dov'era.
 *
 * Si deriva da `updated_at`, in secondi da un'origine recente, invece di
 * tenere un contatore in una colonna. `updated_at` cambia già a ogni scrittura
 * — evento, lineup, generi e link si salvano in una sola transazione, e anche
 * il cambio di stato passa di lì — quindi un contatore sarebbe un secondo
 * stato da tenere allineato al primo, con l'unico effetto di poter divergere.
 *
 * I secondi e non i millisecondi perché il valore deve stare in 32 bit: dal
 * 2026 in poi restano una sessantina d'anni di margine, contro tre settimane
 * se si contassero i millisecondi. Vedi ADR-0028.
 */
export function sequenzaDa(aggiornatoIl: Date): number {
	const secondi = Math.floor((aggiornatoIl.getTime() - EPOCA_SEQUENCE_MS) / 1000);
	// Una riga con `updated_at` anteriore all'origine è un dato di prova o un
	// ripristino andato storto: vale zero, non un numero negativo che alcuni
	// client rifiutano e altri accettano scrivendolo nel posto sbagliato.
	if (!Number.isFinite(secondi) || secondi < 0) return 0;
	return Math.min(secondi, SEQUENCE_MASSIMO);
}

/**
 * Una voce del feed: l'evento come lo vede chi guarda, più l'istante della sua
 * ultima modifica.
 *
 * `aggiornatoIl` arriva dalla riga grezza e **non** passa da
 * `serializeEvent()`: non è un campo dell'evento che si mostra, è metadato del
 * feed. Tenerlo fuori dal serializzatore evita di allargare la matrice di §5
 * per una necessità tecnica (ADR-0028).
 */
export type VoceFeed = {
	evento: EventoSerializzato;
	aggiornatoIl: Date;
};

export type OpzioniCalendario = {
	/** Finisce in `X-WR-CALNAME`: è il nome che il client mostra nella barra. */
	nome: string;
	/** Radice dell'applicazione, senza slash finale: `https://app.example`. */
	baseUrl: string;
	descrizione?: string | null;
	/** L'URL del feed stesso, se ne ha uno: diventa `SOURCE`. */
	sorgente?: string | null;
};

/* ------------------------------------------------------------------ *
 * Dalla matrice di visibilità ai campi iCalendar
 * ------------------------------------------------------------------ */

/**
 * `STATUS` per stato dell'evento.
 *
 * `hold` è `TENTATIVE`, che è esattamente ciò che significa: una data
 * opzionata. `cancelled` resta nel feed e non sparisce, perché liberare uno
 * slot è un'informazione utile (ADR-0005) — e `CANCELLED` è il modo di dirlo
 * che i client conoscono. `draft` non entra mai in un feed (ADR-0029), ma può
 * comparire nel download singolo di una data propria: lì vale `TENTATIVE`.
 */
export function statoIcs(stato: EventStatus): ICalEventStatus {
	switch (stato) {
		case 'confirmed':
			return ICalEventStatus.CONFIRMED;
		case 'cancelled':
			return ICalEventStatus.CANCELLED;
		default:
			return ICalEventStatus.TENTATIVE;
	}
}

/**
 * Il titolo con cui la data compare in un'app di calendario.
 *
 * `titoloVisibile()` decide *cosa* si può scrivere — per un `hold` altrui è
 * genere più organizzazione, mai il titolo vero. Qui si aggiunge solo lo stato,
 * e solo quando non è `confirmed`: in una vista mensile una data opzionata e
 * una confermata sarebbero altrimenti indistinguibili, e `STATUS:TENTATIVE`
 * quasi nessun client lo disegna.
 */
export function sommarioIcs(evento: EventoSerializzato): string {
	const titolo = titoloVisibile(evento);
	if (evento.status === 'confirmed') return titolo;
	return `${ETICHETTE_STATO[evento.status]} · ${titolo}`;
}

function luogoTestuale(evento: EventoSerializzato): string {
	return evento.province ? `${evento.city} (${evento.province})` : evento.city;
}

/** `LOCATION` e `GEO`: il locale se è visibile, la città altrimenti. */
function luogoIcs(evento: EventoSerializzato): ICalEventData['location'] {
	const completo = evento.visibilita === 'completa' ? evento : null;
	const venue = completo?.venue ?? null;

	if (venue) {
		return {
			title: venue.name,
			address: [venue.address, luogoTestuale(evento)].filter(Boolean).join(', '),
			geo: { lat: venue.lat, lon: venue.lon }
		};
	}

	// Senza locale restano le coordinate dell'evento, che ci sono anche in
	// `hold` quando la città è stata geocodificata — ma solo in visibilità
	// completa: `EventoRidotto` non le espone, ed è giusto così.
	const geo =
		completo?.lat != null && completo?.lon != null
			? { lat: completo.lat, lon: completo.lon }
			: undefined;

	return { title: luogoTestuale(evento), geo };
}

function prezzoLeggibile(v: string | null): string | null {
	return v === null ? null : `${Number(v).toFixed(2).replace('.', ',')} €`;
}

function descrizioneCompleta(e: EventoCompleto, baseUrl: string): string {
	const righe: string[] = [];

	if (e.subtitle) righe.push(e.subtitle);

	// La lineup è già filtrata da `serializeEvent`: fuori dall'organizzazione
	// proprietaria contiene solo le voci annunciate, in ogni stato compreso
	// `cancelled` (ADR-0020). Qui non si rifiltra niente, perché rifiltrare
	// suggerirebbe che si potesse arrivare qui con dati non filtrati.
	if (e.lineup.length) {
		righe.push('');
		righe.push(
			...e.lineup.map((v) =>
				v.billing === 'tba' ? v.nome : `${v.nome} — ${ETICHETTE_LOCANDINA[v.billing]}`
			)
		);
	}

	const ingresso = e.isFree
		? 'Ingresso libero'
		: [
				prezzoLeggibile(e.pricePresale) && `${prezzoLeggibile(e.pricePresale)} in prevendita`,
				prezzoLeggibile(e.priceDoor) && `${prezzoLeggibile(e.priceDoor)} alla porta`
			]
				.filter(Boolean)
				.join(' · ');

	if (ingresso) {
		righe.push('');
		righe.push(e.isMembersOnly ? `${ingresso} · riservato ai tesserati` : ingresso);
	}
	if (e.ticketUrl) righe.push(`Prevendita: ${e.ticketUrl}`);

	righe.push('');
	righe.push(`Organizza: ${e.organizzazione.name}`);
	// La provenienza segue la data anche fuori dall'applicazione (ADR-0044).
	// Un feed sottoscritto è il posto in cui una data riferita da un terzo
	// somiglia di più a una verificata: lì il contesto della pagina non c'è, e
	// resta solo questa riga a distinguerle.
	if (e.segnalataDa) {
		righe.push(`Segnalata da ${e.segnalataDa.name}: non confermata da chi organizza.`);
	}
	righe.push(`${baseUrl}/events/${e.id}`);

	return righe.join('\n').trim();
}

/**
 * La descrizione di una data opzionata altrui.
 *
 * Dice esplicitamente *perché* si vede così poco. In un'app di calendario non
 * c'è nessuna interfaccia intorno a spiegarlo, e una riga con solo la città
 * sembra un dato mancante invece che un dato riservato — che è la lettura che
 * fa smettere di fidarsi dello strumento.
 */
function descrizioneRidotta(e: EventoSerializzato, baseUrl: string): string {
	const righe = [
		`Data opzionata da ${e.organizzazione.name}, non ancora annunciata.`,
		'Giorno, città e genere sono tutto ciò che è stato condiviso: orario, locale e lineup restano riservati finché non viene confermata.'
	];
	if (e.organizzazione.emailContact) {
		righe.push('', `Contatto: ${e.organizzazione.emailContact}`);
	}
	righe.push('', `${baseUrl}/events/${e.id}`);
	return righe.join('\n');
}

function categorieIcs(evento: EventoSerializzato): { name: string }[] {
	// In visibilità ridotta esce solo il genere primario: i secondari
	// raccontano troppo della serata (matrice §5).
	const generi =
		evento.visibilita === 'completa'
			? evento.generi
			: evento.generePrimario
				? [evento.generePrimario]
				: [];
	return generi.map((g) => ({ name: g.name }));
}

/** Host da usare nell'`UID`. Stabile per installazione, mai per evento. */
function dominioDi(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return 'calendario.local';
	}
}

/**
 * Una voce del feed nella forma che `ical-generator` sa scrivere.
 *
 * Le due visibilità producono due eventi di forma diversa, e non per comodità:
 * di una data in `hold` altrui **non si conosce l'ora**, quindi diventa un
 * evento di giornata intera. Dargli un orario finto — le 21, "di solito" —
 * significherebbe inventare in un file che qualcuno legge come un dato.
 */
export function aVoceIcs(voce: VoceFeed, opzioni: OpzioniCalendario): ICalEventData {
	const { evento, aggiornatoIl } = voce;
	const dominio = dominioDi(opzioni.baseUrl);
	const completo = evento.visibilita === 'completa' ? evento : null;

	const comune = {
		// `UID` stabile per evento e per installazione: è la chiave con cui il
		// client riconosce che è la stessa data e non una nuova.
		id: `${evento.id}@${dominio}`,
		sequence: sequenzaDa(aggiornatoIl),
		// `DTSTAMP` e `LAST-MODIFIED` dalla stessa fonte del `SEQUENCE`: così
		// l'output è deterministico a parità di dati, e i test possono
		// confrontarlo per intero.
		stamp: aggiornatoIl,
		lastModified: aggiornatoIl,
		status: statoIcs(evento.status),
		summary: sommarioIcs(evento),
		location: luogoIcs(evento),
		categories: categorieIcs(evento),
		url: `${opzioni.baseUrl}/events/${evento.id}`
	} satisfies Partial<ICalEventData>;

	if (!completo) {
		// Giornata intera: `DTEND` in iCalendar è esclusivo, quindi il giorno
		// dopo. Le due mezzanotti sono in UTC perché con `allDay` la libreria
		// scrive solo la parte data, e la parte data di una mezzanotte UTC è
		// il giorno che ci interessa.
		const giorno = new Date(`${evento.giorno}T00:00:00Z`);
		return {
			...comune,
			allDay: true,
			start: giorno,
			end: new Date(giorno.getTime() + 86_400_000),
			description: descrizioneRidotta(evento, opzioni.baseUrl)
		};
	}

	return {
		...comune,
		start: completo.startsAt,
		// `ends_at` nullo vale +4h, la stessa assunzione con cui il motore
		// conflitti calcola le sovrapposizioni (ARCHITECTURE.md §4.4). Due
		// assunzioni diverse per la stessa durata sarebbero un modo elegante
		// di far dire cose diverse al calendario e agli avvisi.
		end: fineEffettiva(completo.startsAt, completo.endsAt),
		description: descrizioneCompleta(completo, opzioni.baseUrl)
	};
}

/**
 * Il calendario completo, pronto da servire come `text/calendar`.
 *
 * `REFRESH-INTERVAL` e `X-PUBLISHED-TTL` dicono al client ogni quanto tornare:
 * senza, alcuni interrogano il feed una volta al giorno e una data spostata
 * stamattina compare domani.
 */
export function costruisciCalendario(voci: VoceFeed[], opzioni: OpzioniCalendario): string {
	const cal = ical({
		name: opzioni.nome,
		description: opzioni.descrizione ?? undefined,
		prodId: '//calendario-eventi-condiviso//IT',
		ttl: TTL_SECONDI,
		source: opzioni.sorgente ?? undefined,
		url: opzioni.sorgente ?? undefined
	});

	for (const voce of voci) cal.createEvent(aVoceIcs(voce, opzioni));

	return cal.toString();
}

/**
 * Nome file per il download di una singola data.
 *
 * Chi scarica tre `.ics` di seguito se li ritrova nella stessa cartella: il
 * giorno davanti li ordina da solo.
 */
export function nomeFileIcs(evento: EventoSerializzato): string {
	// `slugify` è la stessa normalizzazione degli slug di organizzazione: un
	// secondo modo di togliere gli accenti divergerebbe dal primo.
	const titolo = slugify(titoloVisibile(evento)).slice(0, 60).replace(/-+$/, '');
	return `${evento.giorno}${titolo ? `-${titolo}` : ''}.ics`;
}
