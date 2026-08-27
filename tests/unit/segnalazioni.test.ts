/**
 * Le date segnalate (ADR-0044).
 *
 * Tre cose si testano qui, e sono le tre che, sbagliando, non farebbero rumore:
 * la provenienza che non deve mai sparire dalla serializzazione, i campi che lo
 * schema del form **non deve avere**, e il testo dell'avviso che deve dire che
 * non c'è niente da approvare.
 */
import { describe, expect, it } from 'vitest';
import { segnalazioneSchema } from '../../src/lib/schemas/segnalazione';
import { avvisoSegnalazioneEsterna } from '../../src/lib/server/notifications/messages';
import {
	serializeEvent,
	type EventWithRelations,
	type OrganizzazioneEvento,
	type ViewerContext
} from '../../src/lib/server/visibility';

const ORG_MIA = 'a1b2c3d4-1111-4a2b-8c3d-000000000001';
const ORG_ESTERNA = 'e1b2c3d4-2222-4a2b-8c3d-000000000002';

const org = (id: string, name: string, esterna: boolean): OrganizzazioneEvento => ({
	id,
	name,
	slug: name.toLowerCase().replace(/ /g, '-'),
	city: 'Perugia',
	province: 'PG',
	emailContact: null,
	website: null,
	instagramUrl: null,
	facebookUrl: null,
	esterna
});

const ESTERNA = org(ORG_ESTERNA, 'Collettivo Fuori', true);
const MIA = org(ORG_MIA, 'Associazione Mia', false);

function eventoSegnalato(over: Partial<EventWithRelations> = {}): EventWithRelations {
	return {
		id: 'd1b2c3d4-3333-4a2b-8c3d-000000000003',
		organizationId: ORG_ESTERNA,
		venueId: null,
		status: 'confirmed',
		title: 'Notte di rumore',
		subtitle: null,
		description: null,
		startsAt: new Date('2026-10-12T20:00:00Z'),
		endsAt: null,
		doorsAt: null,
		isMultiDay: false,
		city: 'Foligno',
		province: 'PG',
		region: 'Umbria',
		country: 'IT',
		lat: 42.955,
		lon: 12.7,
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
		externalUrl: null,
		announceAt: null,
		internalNotes: null,
		updatedAt: new Date('2026-08-27T10:00:00Z'),
		segnalataDa: MIA,
		organization: ESTERNA,
		venue: null,
		genres: [],
		lineup: [],
		links: [],
		...over
	};
}

const estraneo: ViewerContext = {
	profileId: 'p-1',
	organizationIds: ['f1b2c3d4-4444-4a2b-8c3d-000000000004'],
	roles: {},
	isPlatformAdmin: false
};

const senzaOrganizzazioni: ViewerContext = {
	profileId: 'p-2',
	organizationIds: [],
	roles: {},
	isPlatformAdmin: true
};

describe('serializzazione di una data segnalata', () => {
	it('è visibile per intero a chiunque: non appartiene a nessuno', () => {
		const s = serializeEvent(eventoSegnalato(), estraneo);
		expect(s).not.toBeNull();
		expect(s?.visibilita).toBe('completa');
		expect(s?.proprio).toBe(false);
	});

	it('porta sempre con sé chi l’ha segnalata', () => {
		// È il solo controllo previsto contro la segnalazione compiacente:
		// se sparisce dalla serializzazione, sparisce dal calendario, dal feed
		// ICS e dall'export insieme.
		const s = serializeEvent(eventoSegnalato(), estraneo);
		expect(s?.segnalataDa?.name).toBe('Associazione Mia');
	});

	it('e la porta anche a un platform admin senza organizzazioni', () => {
		const s = serializeEvent(eventoSegnalato(), senzaOrganizzazioni);
		expect(s?.segnalataDa?.name).toBe('Associazione Mia');
		expect(s?.organizzazione.esterna).toBe(true);
	});

	it('una data normale non ha nessuna provenienza da mostrare', () => {
		const s = serializeEvent(
			eventoSegnalato({ organizationId: ORG_MIA, organization: MIA, segnalataDa: null }),
			estraneo
		);
		expect(s?.segnalataDa).toBeNull();
		expect(s?.organizzazione.esterna).toBe(false);
	});

	it('annullata resta visibile, con la provenienza intatta', () => {
		const s = serializeEvent(eventoSegnalato({ status: 'cancelled' }), estraneo);
		expect(s?.status).toBe('cancelled');
		expect(s?.segnalataDa?.name).toBe('Associazione Mia');
	});
});

/**
 * Ciò che il form di segnalazione **non** chiede.
 *
 * Stessa forma della sezione «ciò che resta di una persona» di
 * `parse-to-form.test.ts`: che il campo non esista è una regola, che esista e
 * valga sempre `null` è una consuetudine, e le consuetudini qualcuno prima o
 * poi le cambia avendo una buona ragione.
 */
describe('lo schema della segnalazione non decide ciò che non è suo', () => {
	const valido = {
		segnalataDaOrganizationId: ORG_MIA,
		organizzatore: 'Collettivo Fuori',
		title: 'Notte di rumore',
		city: 'Foligno',
		startsAtLocal: '2026-10-12T21:00',
		lineup: ['Fossa', 'Bassa Marea']
	};

	it('non ha `status`: una data esterna nasce confermata e non può essere altro', () => {
		const esito = segnalazioneSchema.safeParse({ ...valido, status: 'hold' });
		expect(esito.success).toBe(true);
		expect(esito.success && 'status' in esito.data).toBe(false);
	});

	it('non ha `isAnnounced`: su una serata pubblica non c’è niente da tenere nascosto', () => {
		const esito = segnalazioneSchema.safeParse({ ...valido, isAnnounced: false });
		expect(esito.success && 'isAnnounced' in esito.data).toBe(false);
	});

	it('la lineup è testo, non identità: nessun `artistId` da nessuna parte', () => {
		const esito = segnalazioneSchema.safeParse(valido);
		expect(esito.success).toBe(true);
		// Se un giorno queste diventassero righe strutturate, il collegamento
		// all'anagrafica sarebbe l'errore che non si vede rileggendo il form —
		// il motore confronta gli id, non i nomi.
		expect(esito.success && esito.data.lineup).toEqual(['Fossa', 'Bassa Marea']);
	});

	it('non ha note interne: l’organizzazione proprietaria non ha membri che le leggano', () => {
		const esito = segnalazioneSchema.safeParse({ ...valido, internalNotes: 'segreto' });
		expect(esito.success && 'internalNotes' in esito.data).toBe(false);
	});

	it('la città è obbligatoria, o la segnalazione non serve a niente', () => {
		// Senza città non ci sono coordinate, e senza coordinate la data resta
		// fuori da tutte le regole geografiche del motore (ADR-0025).
		const esito = segnalazioneSchema.safeParse({ ...valido, city: '' });
		expect(esito.success).toBe(false);
	});
});

describe('l’avviso al manutentore', () => {
	const destinatario = { profileId: 'p-2', displayName: 'Ale', email: 'ale@example.org' };

	function avviso() {
		const s = serializeEvent(eventoSegnalato(), senzaOrganizzazioni);
		if (!s || s.visibilita !== 'completa') throw new Error('atteso un evento completo');
		return avvisoSegnalazioneEsterna(s, destinatario);
	}

	it('dice chi organizza e chi ha segnalato', () => {
		const a = avviso();
		expect(a.testo).toContain('Collettivo Fuori');
		expect(a.testo).toContain('Associazione Mia');
	});

	it('dice che non c’è niente da approvare', () => {
		// Se questo testo diventasse ambiguo, ADR-0044 sarebbe aggirata dal
		// linguaggio: il manutentore comincerebbe a trattarlo come una coda.
		expect(avviso().testo).toContain('niente da approvare');
	});

	it('non si ripete sulla stessa data', () => {
		expect(avviso().dedupeKey).toBe('segnalazione:d1b2c3d4-3333-4a2b-8c3d-000000000003');
	});
});
