/**
 * Scritture degli eventi.
 *
 * Un solo punto in cui una data entra nel database, per tre motivi:
 * - le coordinate di `events` vanno risincronizzate qui e non da un trigger
 *   nascosto (ADR-0008);
 * - lineup, generi e link vanno riconciliati insieme all'evento, in
 *   transazione, altrimenti un errore a metà lascia una serata senza band;
 * - da Fase 3 il ricalcolo dei conflitti si aggancia esattamente qui.
 */
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { EventInput } from '$lib/schemas/event';
import { generiInOrdine } from '$lib/schemas/event';
import { calcolaDiff, registraAudit } from '$lib/server/audit';
import { riconciliaConflitti } from '$lib/server/conflicts/reconcile';
import type { Database } from '$lib/server/db/client';
import {
	eventGenres,
	eventLineup,
	eventLinks,
	events,
	genres,
	venues,
	type EventStatus
} from '$lib/server/db/schema';
import { geocode } from '$lib/server/geocode';
import { daLocaleAIstante } from '$lib/time';

type Coordinate = { lat: number | null; lon: number | null };

/**
 * Vero quando la data **rientra in cartellone**: arriva in `hold` o
 * `confirmed` venendo da uno stato diverso.
 *
 * Copre tre cose che si assomigliano: una data annullata che si recupera, una
 * bozza che viene opzionata, e un'opzione che viene confermata. In tutti e tre
 * i casi la situazione che due organizzatori avevano discusso e chiuso non è
 * più quella, e il conflitto risolto torna aperto (ADR-0027). Il terzo caso è
 * il più importante: confermare significa annunciare, ed è il momento in cui
 * ADR-0022 pretende che l'avviso si veda.
 *
 * Restare fermi nello stesso stato non è un rientro: salvare una modifica alla
 * descrizione non deve riaprire una discussione chiusa.
 */
function rientraInCartellone(precedente: EventStatus, nuovo: EventStatus): boolean {
	return nuovo !== precedente && (nuovo === 'hold' || nuovo === 'confirmed');
}

/**
 * Da dove vengono le coordinate di un evento, in ordine di fiducia.
 *
 * 1. il locale, se scelto: è geocodificato e verificato da chi l'ha inserito;
 * 2. quelle scritte nel form, se ci sono;
 * 3. il geocoding della città, come rete di sicurezza.
 *
 * Se falliscono tutte si salva comunque senza coordinate: l'evento resterà
 * fuori dai controlli geografici finché non gli si dà un locale, ma perdere
 * l'inserimento sarebbe peggio (principio 5, degradazione elegante).
 */
async function risolviCoordinate(db: Database, dati: EventInput): Promise<Coordinate> {
	if (dati.venueId) {
		const locale = await db
			.select({ lat: venues.lat, lon: venues.lon })
			.from(venues)
			.where(eq(venues.id, dati.venueId))
			.limit(1);
		if (locale[0]) return { lat: locale[0].lat, lon: locale[0].lon };
	}

	if (dati.lat !== null && dati.lon !== null) return { lat: dati.lat, lon: dati.lon };

	const query = [dati.city, dati.province, 'Italia'].filter(Boolean).join(', ');
	try {
		const posizione = await geocode(db, query);
		if (posizione) return { lat: posizione.lat, lon: posizione.lon };
	} catch (err) {
		console.error('Geocoding della città non riuscito:', err);
	}

	return { lat: null, lon: null };
}

/** I campi della riga `events`, pronti per l'insert o l'update. */
function colonneEvento(dati: EventInput, coordinate: Coordinate) {
	return {
		organizationId: dati.organizationId,
		venueId: dati.venueId,
		status: dati.status,
		title: dati.title,
		subtitle: dati.subtitle,
		description: dati.description,
		startsAt: daLocaleAIstante(dati.startsAtLocal),
		endsAt: dati.endsAtLocal ? daLocaleAIstante(dati.endsAtLocal) : null,
		doorsAt: dati.doorsAtLocal ? daLocaleAIstante(dati.doorsAtLocal) : null,
		// La data di annuncio ha senso solo finché la data è opzionata: dopo
		// l'annuncio è storia, e tenerla farebbe scattare il sollecito di
		// Fase 6 su una data già pubblica.
		announceAt:
			dati.status === 'hold' && dati.announceAtLocal
				? daLocaleAIstante(dati.announceAtLocal)
				: null,
		isMultiDay: dati.isMultiDay,
		city: dati.city,
		province: dati.province,
		region: dati.region,
		country: dati.country,
		lat: coordinate.lat,
		lon: coordinate.lon,
		conflictRadiusKm: dati.conflictRadiusKm,
		isFree: dati.isFree,
		isMembersOnly: dati.isMembersOnly,
		pricePresale: dati.isFree ? null : dati.pricePresale,
		priceDoor: dati.isFree ? null : dati.priceDoor,
		currency: dati.currency,
		ticketUrl: dati.ticketUrl,
		ageRestriction: dati.ageRestriction,
		capacityExpected: dati.capacityExpected,
		posterUrl: dati.posterUrl,
		facebookEventUrl: dati.facebookEventUrl,
		instagramPostUrl: dati.instagramPostUrl,
		externalUrl: dati.externalUrl,
		internalNotes: dati.internalNotes
	};
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Sostituisce i generi dell'evento; il primo slug è il primario. */
async function sincronizzaGeneri(tx: Tx, eventId: string, slugs: string[]) {
	await tx.delete(eventGenres).where(eq(eventGenres.eventId, eventId));
	if (!slugs.length) return;

	const trovati = await tx
		.select({ id: genres.id, slug: genres.slug })
		.from(genres)
		.where(inArray(genres.slug, slugs));

	const perSlug = new Map(trovati.map((g) => [g.slug, g.id]));
	const righe = slugs
		.map((slug, i) => {
			const genreId = perSlug.get(slug);
			return genreId ? { eventId, genreId, isPrimary: i === 0 } : null;
		})
		.filter((r) => r !== null);

	if (righe.length) await tx.insert(eventGenres).values(righe).onConflictDoNothing();
}

/**
 * Riconcilia la lineup: aggiorna le righe che c'erano, inserisce le nuove,
 * cancella quelle rimosse.
 *
 * Non si cancella e reinserisce tutto perché gli id delle righe sono ciò che
 * tiene insieme la storia di una serata: `is_announced` su una riga che ha
 * cambiato id è, per chiunque legga il registro di audit, una band diversa.
 */
async function sincronizzaLineup(tx: Tx, eventId: string, voci: EventInput['lineup']) {
	const daTenere = voci.map((v) => v.id).filter((id) => id !== null);

	if (daTenere.length) {
		await tx
			.delete(eventLineup)
			.where(and(eq(eventLineup.eventId, eventId), notInArray(eventLineup.id, daTenere)));
	} else {
		await tx.delete(eventLineup).where(eq(eventLineup.eventId, eventId));
	}

	for (const [i, v] of voci.entries()) {
		const colonne = {
			eventId,
			artistId: v.artistId,
			// Il nome grezzo si tiene solo quando non c'è l'anagrafica: due
			// fonti per lo stesso dato divergono sempre, prima o poi.
			artistNameRaw: v.artistId ? null : v.artistName,
			billing: v.billing,
			position: i,
			stage: v.stage,
			dayDate: v.dayDate,
			setStartsAt: v.setStartsAtLocal ? daLocaleAIstante(v.setStartsAtLocal) : null,
			setDurationMinutes: v.setDurationMinutes,
			isAnnounced: v.isAnnounced,
			notes: v.notes
		};

		if (v.id) {
			// Il vincolo sull'`event_id` non è ridondante: l'id della riga
			// arriva da un campo nascosto del form, quindi da fuori. Senza,
			// basterebbe cambiarlo a mano per riscrivere la lineup di un
			// evento di un'altra organizzazione.
			await tx
				.update(eventLineup)
				.set(colonne)
				.where(and(eq(eventLineup.id, v.id), eq(eventLineup.eventId, eventId)));
		} else {
			await tx.insert(eventLineup).values(colonne);
		}
	}
}

async function sincronizzaLink(tx: Tx, eventId: string, links: EventInput['links']) {
	await tx.delete(eventLinks).where(eq(eventLinks.eventId, eventId));
	if (!links.length) return;
	await tx
		.insert(eventLinks)
		.values(links.map((l, i) => ({ eventId, label: l.label, url: l.url, sortOrder: i })));
}

/** Crea un evento con lineup, generi e link. Restituisce l'id. */
export async function creaEvento(
	db: Database,
	profileId: string,
	dati: EventInput
): Promise<string> {
	const coordinate = await risolviCoordinate(db, dati);
	const colonne = colonneEvento(dati, coordinate);

	const id = await db.transaction(async (tx) => {
		const inserito = await tx
			.insert(events)
			.values({ ...colonne, createdBy: profileId, updatedBy: profileId })
			.returning({ id: events.id });

		const eventId = inserito[0].id;
		await sincronizzaGeneri(tx, eventId, generiInOrdine(dati));
		await sincronizzaLineup(tx, eventId, dati.lineup);
		await sincronizzaLink(tx, eventId, dati.links);
		return eventId;
	});

	await registraAudit(db, {
		actorProfileId: profileId,
		entityType: 'event',
		entityId: id,
		action: 'create',
		diff: { status: [null, dati.status], title: [null, dati.title] }
	});

	// Il ricalcolo sta **fuori** dalla transazione e non solleva mai: un
	// motore conflitti che non risponde non deve far perdere la data appena
	// inserita (ARCHITECTURE.md §6.4, e il cron notturno recupera).
	await riconciliaConflitti(db, id);

	return id;
}

/**
 * Aggiorna un evento esistente.
 *
 * `precedente` serve al registro di audit e al riconoscimento del cambio di
 * stato: chi chiama ha già letto la riga per i controlli di permesso, quindi
 * non la si rilegge.
 */
export async function aggiornaEvento(
	db: Database,
	profileId: string,
	id: string,
	dati: EventInput,
	precedente: { status: EventStatus; title: string; startsAt: Date; venueId: string | null }
): Promise<void> {
	const coordinate = await risolviCoordinate(db, dati);
	const colonne = colonneEvento(dati, coordinate);

	await db.transaction(async (tx) => {
		await tx
			.update(events)
			.set({ ...colonne, updatedBy: profileId, updatedAt: new Date() })
			.where(eq(events.id, id));

		await sincronizzaGeneri(tx, id, generiInOrdine(dati));
		await sincronizzaLineup(tx, id, dati.lineup);
		await sincronizzaLink(tx, id, dati.links);
	});

	const diff = calcolaDiff(precedente, {
		status: colonne.status,
		title: colonne.title,
		startsAt: colonne.startsAt,
		venueId: colonne.venueId
	});

	if (diff) {
		await registraAudit(db, {
			actorProfileId: profileId,
			entityType: 'event',
			entityId: id,
			// Il cambio di stato si distingue perché è l'unico che cambia ciò
			// che gli altri vedono: è la voce che si andrà a cercare.
			action: 'status' in diff ? 'status_change' : 'update',
			diff
		});
	}

	// Sempre, non solo quando `diff` è valorizzato: il ricalcolo dipende anche
	// da lineup, generi e raggio, che in `diff` non compaiono perché al
	// registro di audit non servono.
	await riconciliaConflitti(db, id, {
		rientroInCartellone: rientraInCartellone(precedente.status, colonne.status)
	});
}

/** Cambia solo lo stato. La transizione è già stata validata da `status.ts`. */
export async function cambiaStato(
	db: Database,
	profileId: string,
	id: string,
	da: EventStatus,
	a: EventStatus
): Promise<void> {
	await db
		.update(events)
		.set({
			status: a,
			// Vedi `colonneEvento`: fuori da `hold` la data di annuncio non serve più.
			...(a === 'hold' ? {} : { announceAt: null }),
			updatedBy: profileId,
			updatedAt: new Date()
		})
		.where(eq(events.id, id));

	await registraAudit(db, {
		actorProfileId: profileId,
		entityType: 'event',
		entityId: id,
		action: 'status_change',
		diff: { status: [da, a] }
	});

	// È il cambio che sposta di più: entrando in `hold` o `confirmed` una data
	// comincia a contendersi il pubblico, uscendone smette. Vedi
	// `partecipaAiConflitti`.
	await riconciliaConflitti(db, id, { rientroInCartellone: rientraInCartellone(da, a) });
}

/** Cancellazione vera. Lineup, generi e link se ne vanno in cascata. */
export async function eliminaEvento(
	db: Database,
	profileId: string,
	id: string,
	titolo: string
): Promise<void> {
	await db.delete(events).where(eq(events.id, id));
	await registraAudit(db, {
		actorProfileId: profileId,
		entityType: 'event',
		entityId: id,
		action: 'delete',
		diff: { title: [titolo, null] }
	});
}
