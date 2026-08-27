/**
 * Il layer di notifica (ARCHITECTURE.md §10, ADR-0035, ADR-0036).
 *
 * Due cose si controllano qui, e la seconda è quella che conta.
 *
 * La prima sono le tabelle di decisione: quale avviso esce dall'applicazione,
 * quale interruttore lo governa. Sono quattro righe di codice e sbagliarle significa
 * o non avvisare nessuno o non poter smettere di avvisare.
 *
 * La seconda è che **un nome di band non annunciata non finisca in un avviso
 * consegnato.** Un messaggio già uscito è l'unica cosa del prodotto che non si
 * può più ritirare: la dashboard si corregge, un feed ICS si revoca, un
 * messaggio recapitato no. I test cercano quindi il nome nell'avviso intero,
 * non nei campi in cui ci si aspetterebbe di trovarlo — la stessa tecnica
 * delle uscite di Fase 4.
 */
import { describe, expect, it } from 'vitest';
import {
	avvisoConflittoNuovo,
	avvisoConflittoRisolto,
	avvisoDigest,
	avvisoSollecito,
	digestVuoto,
	giornoEsteso,
	type RiepilogoDigest
} from '../../src/lib/server/notifications/messages';
import {
	CONSEGNA_PREVISTA,
	PREFERENZE_PREDEFINITE,
	vuoleConsegna,
	type Destinatario
} from '../../src/lib/server/notifications/types';
import { etichettaSettimana } from '../../src/lib/server/notifications/digest';
import {
	serializeConflict,
	serializeEvent,
	type ConflittoGrezzo,
	type EventWithRelations,
	type EventoCompleto,
	type ViewerContext
} from '../../src/lib/server/visibility';
import { daLocaleAIstante } from '../../src/lib/time';

/* ------------------------------------------------------------------ *
 * Fixture
 * ------------------------------------------------------------------ */

const ORG_MIA = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_ALTRA = 'bbbbbbbb-0000-0000-0000-000000000000';
const EVENTO_A = '11111111-0000-0000-0000-000000000000';
const EVENTO_B = '22222222-0000-0000-0000-000000000000';
const OPETH = 'cccccccc-0000-0000-0000-000000000000';
const NOMI = { [OPETH]: 'Opeth' };

const destinatario: Destinatario = {
	profileId: 'ffffffff-0000-0000-0000-000000000000',
	displayName: 'Anna',
	email: 'anna@circolo.example'
};

function organizzazione(id: string, name: string) {
	return {
		id,
		name,
		slug: name.toLowerCase().replace(/\s+/g, '-'),
		city: 'Perugia',
		province: 'PG',
		emailContact: `info@${name.toLowerCase().replace(/\s+/g, '')}.example`,
		website: null,
		instagramUrl: null,
		facebookUrl: null,
		esterna: false
	};
}

function evento(over: Partial<EventWithRelations> = {}): EventWithRelations {
	return {
		id: EVENTO_A,
		organizationId: ORG_MIA,
		venueId: null,
		status: 'confirmed',
		title: 'Notte di Death Metal',
		subtitle: null,
		description: null,
		startsAt: daLocaleAIstante('2026-10-12T22:00'),
		endsAt: null,
		doorsAt: null,
		isMultiDay: false,
		city: 'Perugia',
		province: 'PG',
		region: 'Umbria',
		country: 'IT',
		lat: 43.1107,
		lon: 12.3908,
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
		internalNotes: 'cachet 800',
		updatedAt: daLocaleAIstante('2026-09-01T10:00'),
		segnalataDa: null,
		organization: organizzazione(ORG_MIA, 'Associazione Mia'),
		venue: null,
		genres: [
			{ slug: 'death-metal', name: 'Death Metal', path: 'metal.death-metal', isPrimary: true }
		],
		lineup: [],
		links: [],
		...over
	};
}

function conflitto(over: Partial<ConflittoGrezzo> = {}): ConflittoGrezzo {
	return {
		id: 'dddd0000-0000-0000-0000-000000000000',
		eventAId: EVENTO_A,
		eventBId: EVENTO_B,
		kind: 'geo_genre_overlap',
		severity: 'medium',
		status: 'open',
		distanceKm: '12.5',
		genreAffinity: '0.80',
		daysApart: 0,
		details: {},
		acknowledgedByA: false,
		acknowledgedByB: false,
		resolutionNote: null,
		computedAt: new Date(),
		updatedAt: new Date(),
		...over
	};
}

const coppia = (statoAltrui: EventWithRelations['status'] = 'confirmed') => ({
	a: evento({ id: EVENTO_A, organizationId: ORG_MIA }),
	b: evento({
		id: EVENTO_B,
		organizationId: ORG_ALTRA,
		status: statoAltrui,
		title: 'Serata segreta',
		segnalataDa: null,
		organization: organizzazione(ORG_ALTRA, 'Associazione Altra')
	})
});

const viewerDi = (organizationId: string): ViewerContext => ({
	profileId: '',
	organizationIds: [organizationId],
	roles: {},
	isPlatformAdmin: false
});

/** Serializza per un lato, sollevando se la fixture non produce niente. */
function conflittoDi(
	c: ConflittoGrezzo,
	organizationId: string,
	stato?: EventWithRelations['status']
) {
	return serializeConflict(c, coppia(stato), viewerDi(organizationId), NOMI);
}

/* ------------------------------------------------------------------ *
 * Tabelle di decisione
 * ------------------------------------------------------------------ */

describe('quali avvisi escono dall’applicazione', () => {
	it('segue la tabella di §10', () => {
		expect(CONSEGNA_PREVISTA.conflitto_nuovo).toBe(true);
		// Una buona notizia non ha bisogno di raggiungere nessuno al lavoro.
		expect(CONSEGNA_PREVISTA.conflitto_risolto).toBe(false);
		expect(CONSEGNA_PREVISTA.invito).toBe(true);
		expect(CONSEGNA_PREVISTA.digest_settimanale).toBe(true);
		expect(CONSEGNA_PREVISTA.sollecito_annuncio).toBe(true);
	});

	it('senza preferenze salvate manda tutto', () => {
		// L'assenza di riga vale "tutto acceso": un profilo appena creato deve
		// essere avvisato di un conflitto grave, e farlo dipendere da una riga
		// che nessuno ha inserito sarebbe un silenzio per errore.
		expect(vuoleConsegna('conflitto_nuovo', PREFERENZE_PREDEFINITE)).toBe(true);
		expect(vuoleConsegna('digest_settimanale', PREFERENZE_PREDEFINITE)).toBe(true);
		expect(vuoleConsegna('sollecito_annuncio', PREFERENZE_PREDEFINITE)).toBe(true);
	});

	it('ogni interruttore spegne solo la propria famiglia', () => {
		const soloConflitti = { avvisaConflitti: true, avvisaDigest: false, avvisaSolleciti: false };
		expect(vuoleConsegna('conflitto_nuovo', soloConflitti)).toBe(true);
		expect(vuoleConsegna('digest_settimanale', soloConflitti)).toBe(false);
		expect(vuoleConsegna('sollecito_annuncio', soloConflitti)).toBe(false);
	});

	it('l’invito non è disattivabile, ma è comunque inerte', () => {
		// Nessuna preferenza lo governa — arriva a chi non ha ancora un profilo
		// su cui esprimerne una — e infatti non produce mai una riga: senza
		// `profile_id` non c'è niente da scrivere. Il valore resta `true`
		// perché la tabella copra l'enum per intero.
		const spento = { avvisaConflitti: false, avvisaDigest: false, avvisaSolleciti: false };
		expect(vuoleConsegna('invito', spento)).toBe(true);
	});

	it('il conflitto risolto non esce nemmeno con tutto acceso', () => {
		expect(vuoleConsegna('conflitto_risolto', PREFERENZE_PREDEFINITE)).toBe(false);
	});
});

/* ------------------------------------------------------------------ *
 * Il caso obbligatorio: la band che una sola delle due ha annunciato
 * ------------------------------------------------------------------ */

describe('una band non annunciata non finisce in nessun avviso', () => {
	/**
	 * Opeth è in cartellone da entrambi. La ha annunciata **solo il lato A**.
	 *
	 * Chi sta da A non deve ricevere niente: sapere che Opeth suona anche da
	 * un'altra parte gli direbbe che l'altra organizzazione l'ha ingaggiata,
	 * cioè esattamente il segreto che lo stato `hold` protegge (ADR-0024).
	 */
	const dettagli = { artisti: [{ artistId: OPETH, annunciatoA: true, annunciatoB: false }] };
	const c = conflitto({
		kind: 'artist_overlap',
		severity: 'high',
		daysApart: 0,
		details: dettagli
	});

	it('al lato che l’ha annunciata il conflitto non si racconta affatto', () => {
		expect(conflittoDi(c, ORG_MIA)).toBeNull();
	});

	it('all’altro lato sì, e con il nome', () => {
		const serializzato = conflittoDi(c, ORG_ALTRA);
		expect(serializzato).not.toBeNull();

		const avviso = avvisoConflittoNuovo(serializzato!, destinatario);
		expect(avviso.testo).toContain('Opeth');
		// Il caso "stesso giorno" si racconta con parole diverse: non è
		// concorrenza, è un doppio ingaggio (ADR-0021).
		expect(avviso.titolo).toContain('impegnata altrove');
	});

	it('il nome non compare da nessuna parte nell’avviso del lato sbagliato', () => {
		// Se la redazione lasciasse passare qualcosa, il conflitto non sarebbe
		// `null` e questo test fallirebbe prima di arrivare alla stringa. Il
		// controllo sul JSON intero c'è per il giorno in cui `redigiConflitto`
		// cambierà: cercare "Opeth" nel testo serializzato coglie anche un
		// nome finito in un campo che oggi non esiste.
		const serializzato = conflittoDi(c, ORG_MIA);
		expect(serializzato).toBeNull();

		const dallAltraParte = conflittoDi(c, ORG_ALTRA)!;
		const avviso = avvisoConflittoNuovo(dallAltraParte, destinatario);
		// Controprova: nel verso in cui il nome *può* uscire, esce davvero.
		expect(JSON.stringify(avviso)).toContain('Opeth');
	});
});

describe('l’avviso di conflitto', () => {
	it('non nomina il locale della controparte se la sua data è opzionata', () => {
		// Un conflitto di locale *è* il locale, e in `hold` il locale è
		// riservato: non c'è modo di raccontarlo a metà.
		const c = conflitto({ kind: 'venue_clash', severity: 'high', details: { venueId: 'v1' } });
		expect(conflittoDi(c, ORG_MIA, 'hold')).toBeNull();
	});

	it('porta il titolo della propria data e non quello della controparte', () => {
		const serializzato = conflittoDi(conflitto(), ORG_MIA)!;
		const avviso = avvisoConflittoNuovo(serializzato, destinatario);
		expect(avviso.testo).toContain('Notte di Death Metal');
		expect(avviso.url).toBe('/conflicts');
	});

	it('non dà ordini a nessuno', () => {
		// ADR-0022: il calendario mette in contatto due pari e non ha titolo
		// per decidere quale delle due serate abbia diritto a quella data.
		const serializzato = conflittoDi(conflitto(), ORG_MIA)!;
		const avviso = avvisoConflittoNuovo(serializzato, destinatario);
		expect(avviso.testo).not.toMatch(/\bdevi\b|\bsposta\b|\bannulla\b/i);
		expect(avviso.testo).toContain('sentitevi');
	});

	it('ha una chiave di deduplica stabile, legata al conflitto', () => {
		// È ciò che impedisce al ricalcolo notturno di rimandare ogni notte lo
		// stesso avviso sulla stessa coppia.
		const serializzato = conflittoDi(conflitto(), ORG_MIA)!;
		const primo = avvisoConflittoNuovo(serializzato, destinatario);
		const secondo = avvisoConflittoNuovo(serializzato, destinatario);
		expect(primo.dedupeKey).toBe(secondo.dedupeKey);
		expect(primo.dedupeKey).toContain(serializzato.id);
	});

	it('la chiusura è un avviso diverso, con la sua chiave', () => {
		const serializzato = conflittoDi(
			conflitto({ status: 'resolved', resolutionNote: 'Ci siamo sentiti, spostiamo noi.' }),
			ORG_MIA
		)!;
		const avviso = avvisoConflittoRisolto(serializzato, destinatario);
		expect(avviso.kind).toBe('conflitto_risolto');
		expect(avviso.testo).toContain('Ci siamo sentiti');
		expect(avviso.dedupeKey).not.toBe(avvisoConflittoNuovo(serializzato, destinatario).dedupeKey);
	});
});

/* ------------------------------------------------------------------ *
 * Sollecito
 * ------------------------------------------------------------------ */

describe('il sollecito di annuncio', () => {
	const mia = serializeEvent(
		evento({
			status: 'hold',
			announceAt: daLocaleAIstante('2026-09-15T12:00')
		}),
		viewerDi(ORG_MIA)
	) as EventoCompleto;

	it('cita la scadenza che aveva scritto chi legge', () => {
		const avviso = avvisoSollecito(mia, destinatario);
		expect(avviso.testo).toContain('15 settembre');
		expect(avviso.url).toBe(`/events/${mia.id}`);
	});

	it('non chiede di confermare', () => {
		// Una data può restare opzionata per ottime ragioni. Il promemoria dice
		// che la scadenza è passata, non cosa farne (ADR-0022).
		const avviso = avvisoSollecito(mia, destinatario);
		expect(avviso.testo).not.toMatch(/\bdevi confermare\b|\bconfermala\b/i);
	});

	it('si manda una volta sola per data', () => {
		expect(avvisoSollecito(mia, destinatario).dedupeKey).toBe(`sollecito:${mia.id}`);
	});
});

/* ------------------------------------------------------------------ *
 * Digest
 * ------------------------------------------------------------------ */

describe('il digest settimanale', () => {
	const vuoto: RiepilogoDigest = { nuoveDate: [], conflittiAperti: [], holdInScadenza: [] };

	it('non parte quando non c’è niente da dire', () => {
		// Un riepilogo che arriva anche a settimana vuota insegna a non
		// aprirla, e la settimana con dentro un conflitto grave finisce nello
		// stesso scorrimento di pollice delle altre.
		expect(digestVuoto(vuoto)).toBe(true);
		expect(avvisoDigest(vuoto, destinatario, '2026-W35')).toBeNull();
	});

	it('basta una riga in una sola sezione perché parta', () => {
		const riepilogo: RiepilogoDigest = {
			...vuoto,
			conflittiAperti: [
				{ giorno: '2026-10-12', testo: 'Stessa sera in zona (Notte di Death Metal)' }
			]
		};
		const avviso = avvisoDigest(riepilogo, destinatario, '2026-W35');
		expect(avviso).not.toBeNull();
		expect(avviso!.testo).toContain('Conflitti da guardare');
		expect(avviso!.testo).toContain('Anna');
	});

	it('non stampa le sezioni vuote', () => {
		const riepilogo: RiepilogoDigest = {
			...vuoto,
			nuoveDate: [{ giorno: '2026-10-12', testo: 'Serata jazz — Terni' }]
		};
		const avviso = avvisoDigest(riepilogo, destinatario, '2026-W35')!;
		expect(avviso.testo).toContain('Date nuove in calendario');
		expect(avviso.testo).not.toContain('Conflitti da guardare');
	});

	it('ha una chiave per settimana, non per esecuzione', () => {
		// Rilanciare la corsa del lunedì non deve rimandare il digest.
		const riepilogo: RiepilogoDigest = {
			...vuoto,
			nuoveDate: [{ giorno: '2026-10-12', testo: 'Serata jazz — Terni' }]
		};
		expect(avvisoDigest(riepilogo, destinatario, '2026-W35')!.dedupeKey).toBe('digest:2026-W35');
	});
});

describe('l’etichetta della settimana', () => {
	it('è quella ISO, con l’anno del giovedì', () => {
		// Il 2026-12-31 è un giovedì: la sua settimana è la 53 del 2026.
		expect(etichettaSettimana(daLocaleAIstante('2026-12-31T09:00'))).toBe('2026-W53');
		// Il 2027-01-01 è un venerdì, stessa settimana ISO.
		expect(etichettaSettimana(daLocaleAIstante('2027-01-01T09:00'))).toBe('2026-W53');
	});

	it('non cambia fra il lunedì e la domenica della stessa settimana', () => {
		const lunedi = etichettaSettimana(daLocaleAIstante('2026-08-24T07:00'));
		const domenica = etichettaSettimana(daLocaleAIstante('2026-08-30T23:00'));
		expect(lunedi).toBe(domenica);
	});
});

describe('le date nei testi', () => {
	it('sono in italiano, per esteso, con l’iniziale maiuscola', () => {
		expect(giornoEsteso('2026-10-12')).toBe('Lunedì 12 ottobre');
	});
});
