/**
 * Le date degli organizzatori non iscritti (ADR-0044).
 *
 * Un iscritto sa di una serata che non è di nessuno qui dentro e che sposta il
 * pubblico della sua: la segnala, ed entra in calendario **subito**, attribuita
 * a un'organizzazione `esterna` e firmata dall'organizzazione che l'ha
 * riferita. Nessuna approvazione: sarebbe il collo di bottiglia che ADR-0016 ha
 * creato il ruolo `moderator` per evitare, e la tempestività è tutto il valore
 * di questa funzione.
 *
 * Il file fa due cose sole, e la seconda si appoggia interamente a `write.ts`:
 * una data segnalata attraversa lo stesso `creaEvento` di tutte le altre, con
 * le stesse coordinate, la stessa riconciliazione e lo stesso registro.
 */
import { eq } from 'drizzle-orm';
import type { SegnalazioneInput } from '$lib/schemas/segnalazione';
import type { EventInput } from '$lib/schemas/event';
import type { Database } from '$lib/server/db/client';
import { organizations } from '$lib/server/db/schema';
import { uniqueOrgSlug } from '$lib/server/invites/service';
import { avvisoSegnalazioneEsterna } from '$lib/server/notifications/messages';
import { platformAdmin } from '$lib/server/notifications/destinatari';
import { notifica } from '$lib/server/notifications/service';
import { slugify } from '$lib/server/text';
import { serializeEvent, type ViewerContext } from '$lib/server/visibility';
import { caricaEvento } from './queries';
import { creaEvento } from './write';

export type EsitoSegnalazione =
	{ ok: true; eventId: string } | { ok: false; motivo: 'gia-iscritta'; nome: string };

/**
 * L'organizzazione esterna con questo nome, creandola se non c'è.
 *
 * La deduplica passa dallo slug, che è `normalizeName` con i trattini: è la
 * stessa forma canonica con cui ADR-0006 fa collassare i doppioni di artisti e
 * venue, e `organizations.slug` ha già l'indice unico che la rende affidabile.
 *
 * Se il nome corrisponde a un'organizzazione **iscritta**, la segnalazione non
 * si fa: quella realtà è qui dentro e le sue date le carica lei. Rispondere
 * "esiste già" invece di creare un doppione esterno evita il caso peggiore,
 * cioè due righe per lo stesso circolo di cui una senza membri.
 */
async function organizzazioneEsterna(
	db: Database,
	nome: string
): Promise<{ id: string } | { conflitto: string }> {
	const slug = slugify(nome);

	const esistente = await db
		.select({ id: organizations.id, name: organizations.name, esterna: organizations.esterna })
		.from(organizations)
		.where(eq(organizations.slug, slug))
		.limit(1);

	if (esistente[0]) {
		if (!esistente[0].esterna) return { conflitto: esistente[0].name };
		return { id: esistente[0].id };
	}

	const creata = await db
		.insert(organizations)
		.values({
			name: nome,
			// `uniqueOrgSlug` esiste per gli omonimi; qui lo slug è appena
			// risultato libero, ma passarci comunque tiene una sola regola di
			// generazione invece di due che possono divergere.
			slug: await uniqueOrgSlug(db, nome),
			esterna: true
		})
		.returning({ id: organizations.id });

	return { id: creata[0].id };
}

/**
 * Dalla segnalazione ai campi che `creaEvento` si aspetta.
 *
 * I valori che il form non chiede si scrivono qui, una volta sola, e discendono
 * tutti dallo stesso fatto: **una data esterna è già pubblica.** Chi segnala
 * l'ha letta da qualche parte, e non c'è nessun annuncio ancora da fare.
 *
 * Da qui `status: 'confirmed'`, e da qui anche `isAnnounced: true` su ogni riga
 * di lineup — che a prima vista somiglia alla decisione che ADR-0031 vieta al
 * parser, e non lo è. Lì il divieto protegge le band **della propria** data,
 * che escono quando lo decide chi le porta; qui l'organizzazione proprietaria
 * non ha membri, e per ADR-0020 una voce non annunciata non sarebbe visibile a
 * nessuno al mondo. Lasciarla `false` non proteggerebbe niente: renderebbe la
 * lineup segnalata invisibile anche a chi l'ha appena scritta.
 *
 * Ciò che resta vietato è l'altra metà di ADR-0031, ed è lo schema a renderlo
 * impossibile: nessun `artistId`, quindi nessun collegamento all'anagrafica
 * fatto per conto di chi non ha scritto quei nomi.
 */
function versoEvento(dati: SegnalazioneInput, organizationId: string): EventInput {
	return {
		organizationId,
		status: 'confirmed',
		title: dati.title,
		subtitle: null,
		// Le note di chi segnala sono l'unica parte del form che racconta
		// qualcosa di soggettivo: stanno nella descrizione, che è pubblica,
		// perché una segnalazione senza il suo contesto si legge peggio.
		description: dati.note,
		venueId: dati.venueId,
		city: dati.city,
		province: dati.province,
		region: null,
		country: 'IT',
		lat: null,
		lon: null,
		startsAtLocal: dati.startsAtLocal,
		endsAtLocal: dati.endsAtLocal,
		doorsAtLocal: null,
		announceAtLocal: null,
		isMultiDay: false,
		conflictRadiusKm: null,
		isFree: false,
		isMembersOnly: false,
		pricePresale: null,
		priceDoor: null,
		currency: 'EUR',
		ticketUrl: null,
		ageRestriction: null,
		capacityExpected: null,
		posterUrl: null,
		facebookEventUrl: null,
		instagramPostUrl: null,
		externalUrl: dati.fonteUrl,
		links: [],
		primaryGenreSlug: dati.primaryGenreSlug,
		secondaryGenreSlugs: [],
		lineup: dati.lineup.map((nome) => ({
			id: null,
			artistId: null,
			artistName: nome,
			billing: 'support' as const,
			stage: null,
			dayDate: null,
			setStartsAtLocal: null,
			setDurationMinutes: null,
			isAnnounced: true,
			notes: null
		})),
		internalNotes: null
	};
}

/**
 * Registra una segnalazione e avvisa il manutentore.
 *
 * L'avviso parte **dopo** che la data è in calendario, ed è per conoscenza: il
 * testo lo dice, perché un avviso ambiguo trasformerebbe in un adempimento
 * quotidiano ciò che ADR-0044 ha deciso di non rendere tale. Come ovunque, si
 * costruisce da un evento **già serializzato** (ADR-0035).
 */
export async function creaSegnalazione(
	db: Database,
	profileId: string,
	dati: SegnalazioneInput
): Promise<EsitoSegnalazione> {
	const org = await organizzazioneEsterna(db, dati.organizzatore);
	if ('conflitto' in org) return { ok: false, motivo: 'gia-iscritta', nome: org.conflitto };

	const eventId = await creaEvento(
		db,
		profileId,
		versoEvento(dati, org.id),
		dati.segnalataDaOrganizationId
	);

	await avvisaIlManutentore(db, eventId);
	return { ok: true, eventId };
}

/**
 * L'avviso ai platform admin. Non solleva: una segnalazione registrata non
 * deve andare persa perché il canale non risponde — è la stessa garanzia che
 * `notifica()` dà a tutto il resto, e qui vale anche per la lettura che la
 * precede.
 */
async function avvisaIlManutentore(db: Database, eventId: string): Promise<void> {
	try {
		const destinatari = await platformAdmin(db);
		if (!destinatari.length) return;

		const evento = await caricaEvento(db, eventId);
		if (!evento) return;

		const avvisi = [];
		for (const destinatario of destinatari) {
			// Il contesto è quello reale del destinatario per quanto conta qui:
			// una data esterna non appartiene a nessuno, quindi si serializza
			// completa per chiunque. Passarci comunque è la regola senza
			// eccezioni comode di ADR-0035.
			const viewer: ViewerContext = {
				profileId: destinatario.profileId,
				organizationIds: [],
				roles: {},
				isPlatformAdmin: true
			};
			const serializzato = serializeEvent(evento, viewer);
			if (!serializzato || serializzato.visibilita !== 'completa') continue;
			avvisi.push(avvisoSegnalazioneEsterna(serializzato, destinatario));
		}

		await notifica(db, avvisi);
	} catch (err) {
		console.error('Avviso di segnalazione non partito:', err);
	}
}
