/**
 * Le quattro regole di rilevamento (ARCHITECTURE.md §6.2 e §15).
 *
 * §15 chiede espressamente i casi limite: mezzanotte, eventi a cavallo di due
 * giorni, `ends_at` nullo, raggi asimmetrici fra le due organizzazioni, ora
 * legale. Sono qui sotto uno per uno, perché è dove le regole sbagliano.
 *
 * Le regole ricevono la coppia **già ordinata** da `engine.ts`, quindi qui si
 * costruiscono gli eventi con id ordinati a mano.
 */
import { describe, expect, it } from 'vitest';
import {
	artistOverlap,
	geoGenreOverlap,
	sameDayProximity,
	severitaPerGiorni,
	venueClash,
	type EventoPerConflitti
} from '../../src/lib/server/conflicts/rules';
import { daLocaleAIstante } from '../../src/lib/time';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';

const ID_A = '11111111-0000-0000-0000-000000000000';
const ID_B = '22222222-0000-0000-0000-000000000000';

const PERUGIA = { lat: 43.1107, lon: 12.3908 };
const TERNI = { lat: 42.5636, lon: 12.6427 }; // ~63 km da Perugia
const ROMA = { lat: 41.9028, lon: 12.4964 }; // ~135 km da Perugia
const MILANO = { lat: 45.4642, lon: 9.19 }; // ~430 km da Perugia

const DEATH = 'metal.death-metal';
const BLACK = 'metal.black-metal';
const JAZZ = 'jazz';

const OPETH = 'cccccccc-0000-0000-0000-000000000000';
const ULVER = 'dddddddd-0000-0000-0000-000000000000';

function evento(over: Partial<EventoPerConflitti> = {}): EventoPerConflitti {
	return {
		id: ID_A,
		organizationId: ORG_A,
		venueId: null,
		startsAt: daLocaleAIstante('2026-10-12T22:00'),
		endsAt: null,
		doorsAt: null,
		...PERUGIA,
		raggioKm: 60,
		generi: [{ path: DEATH, isPrimary: true }],
		lineup: [],
		...over
	};
}

/* ------------------------------------------------------------------ *
 * R1 — venue_clash
 * ------------------------------------------------------------------ */

const CIRCOLO = 'eeeeeeee-0000-0000-0000-000000000000';
const ALTRO_LOCALE = 'ffffffff-0000-0000-0000-000000000000';

describe('R1 — stesso locale', () => {
	it('due date nello stesso locale che si accavallano sono un conflitto grave', () => {
		const a = evento({ id: ID_A, venueId: CIRCOLO });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			venueId: CIRCOLO,
			startsAt: daLocaleAIstante('2026-10-12T23:00')
		});

		const c = venueClash(a, b);
		expect(c?.kind).toBe('venue_clash');
		// Sempre `high`: non è una scelta strategica su cui due organizzatori
		// possano dissentire, è un errore materiale.
		expect(c?.severity).toBe('high');
		expect(c?.dettagli.venueId).toBe(CIRCOLO);
	});

	it('locali diversi non sono un conflitto di locale', () => {
		const a = evento({ id: ID_A, venueId: CIRCOLO });
		const b = evento({ id: ID_B, organizationId: ORG_B, venueId: ALTRO_LOCALE });
		expect(venueClash(a, b)).toBeNull();
	});

	it('senza locale non scatta: in `hold` il locale spesso non c’è ancora', () => {
		const a = evento({ id: ID_A, venueId: null });
		const b = evento({ id: ID_B, organizationId: ORG_B, venueId: null });
		expect(venueClash(a, b)).toBeNull();
	});

	it('`ends_at` nullo vale quattro ore, e la sovrapposizione si vede lo stesso', () => {
		// 22:00 senza fine → 02:00. L'altra parte alle 01:00: un'ora dentro.
		const a = evento({ id: ID_A, venueId: CIRCOLO, endsAt: null });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			venueId: CIRCOLO,
			startsAt: daLocaleAIstante('2026-10-13T01:00'),
			endsAt: null
		});

		const c = venueClash(a, b);
		expect(c).not.toBeNull();
		expect(c?.dettagli.sovrapposizioneMinuti).toBe(60);
	});

	it('due date consecutive nello stesso locale non si accavallano', () => {
		// Una finisce alle 23:00, l'altra apre le porte alle 23:00: stretta,
		// non impossibile. Gli estremi che si toccano non sono sovrapposizione.
		const a = evento({
			id: ID_A,
			venueId: CIRCOLO,
			startsAt: daLocaleAIstante('2026-10-12T20:00'),
			endsAt: daLocaleAIstante('2026-10-12T23:00')
		});
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			venueId: CIRCOLO,
			doorsAt: daLocaleAIstante('2026-10-12T23:00'),
			startsAt: daLocaleAIstante('2026-10-12T23:30')
		});

		expect(venueClash(a, b)).toBeNull();
	});

	it('l’apertura porte fa parte dell’occupazione del locale', () => {
		// La seconda comincia alle 23:30, ma apre le porte alle 22:30, mentre
		// la prima è ancora in corso. Chi entra, entra dove?
		const a = evento({
			id: ID_A,
			venueId: CIRCOLO,
			startsAt: daLocaleAIstante('2026-10-12T20:00'),
			endsAt: daLocaleAIstante('2026-10-12T23:00')
		});
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			venueId: CIRCOLO,
			doorsAt: daLocaleAIstante('2026-10-12T22:30'),
			startsAt: daLocaleAIstante('2026-10-12T23:30')
		});

		expect(venueClash(a, b)?.dettagli.sovrapposizioneMinuti).toBe(30);
	});

	it('una data che scavalca la mezzanotte occupa ancora il locale il giorno dopo', () => {
		const a = evento({
			id: ID_A,
			venueId: CIRCOLO,
			startsAt: daLocaleAIstante('2026-10-12T22:00'),
			endsAt: daLocaleAIstante('2026-10-13T03:00')
		});
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			venueId: CIRCOLO,
			startsAt: daLocaleAIstante('2026-10-13T02:00'),
			endsAt: daLocaleAIstante('2026-10-13T05:00')
		});

		expect(venueClash(a, b)).not.toBeNull();
	});
});

/* ------------------------------------------------------------------ *
 * R2 — artist_overlap
 * ------------------------------------------------------------------ */

const conOpeth = (annunciata: boolean) => [{ artistId: OPETH, isAnnounced: annunciata }];

describe('R2 — fasce di gravità per giorni di distanza (ADR-0021)', () => {
	it.each([
		[0, 'high'],
		[1, 'high'],
		[2, 'high'],
		[3, 'medium'],
		[4, 'medium'],
		[5, 'medium'],
		[6, 'low'],
		[7, 'low']
	])('a %i giorni la gravità è %s', (giorni, atteso) => {
		expect(severitaPerGiorni(giorni)).toBe(atteso);
	});

	it('a 8 giorni non c’è più conflitto: è il bordo che ADR-0021 fissa', () => {
		expect(severitaPerGiorni(8)).toBeNull();
	});

	it('il settimo giorno è ancora dentro, l’ottavo è già fuori', () => {
		// I due bordi presi uno accanto all'altro: sono quelli su cui tornerà
		// l'evidenza, e vanno visti insieme per accorgersi se si spostano.
		expect(severitaPerGiorni(7)).not.toBeNull();
		expect(severitaPerGiorni(8)).toBeNull();
	});
});

describe('R2 — stessa band', () => {
	it('la stessa band la stessa sera a poca distanza è il caso più grave', () => {
		const a = evento({ id: ID_A, lineup: conOpeth(true) });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			lineup: conOpeth(true),
			...TERNI
		});

		const c = artistOverlap(a, b);
		expect(c?.kind).toBe('artist_overlap');
		expect(c?.severity).toBe('high');
		expect(c?.giorniDiDistanza).toBe(0);
		expect(c?.dettagli.artisti).toEqual([
			{ artistId: OPETH, annunciatoA: true, annunciatoB: true }
		]);
	});

	it('band diverse non sono un conflitto', () => {
		const a = evento({ id: ID_A, lineup: [{ artistId: OPETH, isAnnounced: true }] });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			lineup: [{ artistId: ULVER, isAnnounced: true }],
			...TERNI
		});
		expect(artistOverlap(a, b)).toBeNull();
	});

	it('oltre 200 km la regola non scatta, per quanto vicine siano le date', () => {
		const a = evento({ id: ID_A, lineup: conOpeth(true) });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			lineup: conOpeth(true),
			...MILANO
		});
		expect(artistOverlap(a, b)).toBeNull();
	});

	it('a otto giorni di distanza non scatta, anche se la band è la stessa', () => {
		const a = evento({ id: ID_A, lineup: conOpeth(true) });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			lineup: conOpeth(true),
			startsAt: daLocaleAIstante('2026-10-20T22:00'),
			...TERNI
		});
		expect(artistOverlap(a, b)).toBeNull();
	});

	it('senza coordinate la soglia dei 200 km non è verificabile e la regola tace', () => {
		// Conseguenza dichiarata di ADR-0008: un evento senza coordinate resta
		// fuori da tutti i controlli geografici. La rete di sicurezza è a
		// monte — il salvataggio geocodifica la città.
		const a = evento({ id: ID_A, lineup: conOpeth(true), lat: null, lon: null });
		const b = evento({ id: ID_B, organizationId: ORG_B, lineup: conOpeth(true), ...TERNI });
		expect(artistOverlap(a, b)).toBeNull();
	});

	it('una band segreta da entrambe le parti non produce nessuna riga', () => {
		// Nessuno dei due potrebbe mai sentirsi raccontare questo conflitto
		// (ADR-0024): registrarlo vorrebbe dire conservare un dato sensibile
		// che nessuno può leggere. La condizione è simmetrica, quindi non
		// reintroduce l'asimmetria che ADR-0024 evita.
		const a = evento({ id: ID_A, lineup: conOpeth(false) });
		const b = evento({ id: ID_B, organizationId: ORG_B, lineup: conOpeth(false), ...TERNI });
		expect(artistOverlap(a, b)).toBeNull();
	});

	it('basta che una delle due parti l’abbia annunciata perché il conflitto esista', () => {
		// Qui il conflitto si registra, e sarà `serializeConflict` a decidere
		// che solo il lato B può sentirlo raccontare.
		const a = evento({ id: ID_A, lineup: conOpeth(false) });
		const b = evento({ id: ID_B, organizationId: ORG_B, lineup: conOpeth(true), ...TERNI });

		const c = artistOverlap(a, b);
		expect(c).not.toBeNull();
		expect(c?.dettagli.artisti).toEqual([
			{ artistId: OPETH, annunciatoA: false, annunciatoB: true }
		]);
	});

	it('la rilevazione è simmetrica: scambiando i lati il conflitto resta', () => {
		// È il motivo per cui la rilevazione usa le lineup intere. Con il
		// filtro sulle sole voci annunciate, salvando una delle due date il
		// conflitto compariva e salvando l'altra spariva.
		const a = evento({ id: ID_A, lineup: conOpeth(false) });
		const b = evento({ id: ID_B, organizationId: ORG_B, lineup: conOpeth(true), ...TERNI });

		expect(artistOverlap(a, b)).not.toBeNull();
		expect(artistOverlap(b, a)).not.toBeNull();
	});

	it('una band in cartellone due volte conta come annunciata se lo è almeno una volta', () => {
		const a = evento({
			id: ID_A,
			lineup: [
				{ artistId: OPETH, isAnnounced: false },
				{ artistId: OPETH, isAnnounced: true }
			]
		});
		const b = evento({ id: ID_B, organizationId: ORG_B, lineup: conOpeth(false), ...TERNI });

		expect(artistOverlap(a, b)?.dettagli.artisti?.[0].annunciatoA).toBe(true);
	});
});

/* ------------------------------------------------------------------ *
 * R3 e R4 — stesso giorno, stessa zona
 * ------------------------------------------------------------------ */

describe('R3 — stessa sera, generi affini', () => {
	it('due serate metal a pochi chilometri la stessa sera sono un conflitto grave', () => {
		// Affinità 1.0 (≥ 0.7) e distanza 0 (≤ metà del raggio): `high` chiede
		// entrambe le condizioni.
		const a = evento({ id: ID_A });
		const b = evento({ id: ID_B, organizationId: ORG_B });

		const c = geoGenreOverlap(a, b);
		expect(c?.kind).toBe('geo_genre_overlap');
		expect(c?.severity).toBe('high');
		expect(c?.affinita).toBe(1);
	});

	it('generi affini ma oltre metà raggio restano `medium`', () => {
		// Perugia–Terni sono ~63 km: dentro un raggio di 80, oltre la metà.
		const a = evento({ id: ID_A, raggioKm: 80 });
		const b = evento({ id: ID_B, organizationId: ORG_B, raggioKm: 80, ...TERNI });

		expect(geoGenreOverlap(a, b)?.severity).toBe('medium');
	});

	it('generi lontani cadono in R4 e non in R3', () => {
		const a = evento({ id: ID_A, generi: [{ path: DEATH, isPrimary: true }] });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			generi: [{ path: JAZZ, isPrimary: true }]
		});

		expect(geoGenreOverlap(a, b)).toBeNull();
		expect(sameDayProximity(a, b)?.severity).toBe('low');
	});

	it('R3 e R4 si escludono a vicenda su ogni coppia', () => {
		const affini = [evento({ id: ID_A }), evento({ id: ID_B, organizationId: ORG_B })] as const;
		const lontani = [
			evento({ id: ID_A, generi: [{ path: DEATH, isPrimary: true }] }),
			evento({ id: ID_B, organizationId: ORG_B, generi: [{ path: JAZZ, isPrimary: true }] })
		] as const;

		for (const [x, y] of [affini, lontani]) {
			const uno = geoGenreOverlap(x, y) !== null;
			const altro = sameDayProximity(x, y) !== null;
			expect(uno).not.toBe(altro);
		}
	});

	it('il raggio effettivo è il minore dei due, non il maggiore', () => {
		// Raggi asimmetrici, il caso che §15 chiede espressamente. Chi ha
		// scelto un raggio stretto non deve ricevere gli avvisi di chi lo ha
		// largo: il raggio è la dichiarazione di quanto lontano ci si sente
		// disturbati.
		const stretto = evento({ id: ID_A, raggioKm: 30 });
		const largo = evento({ id: ID_B, organizationId: ORG_B, raggioKm: 200, ...TERNI });

		expect(geoGenreOverlap(stretto, largo)).toBeNull();
		expect(sameDayProximity(stretto, largo)).toBeNull();
	});

	it('fuori dal raggio non scatta niente, per quanto i generi siano identici', () => {
		const a = evento({ id: ID_A, raggioKm: 60 });
		const b = evento({ id: ID_B, organizationId: ORG_B, raggioKm: 60, ...ROMA });

		expect(geoGenreOverlap(a, b)).toBeNull();
		expect(sameDayProximity(a, b)).toBeNull();
	});

	it('giorni diversi non sono mai R3 né R4, anche a un’ora di distanza', () => {
		// Un concerto alle 23:30 del 12 e uno alle 00:30 del 13 sono a un'ora
		// l'uno dall'altro, ma sono due serate diverse: il giorno civile è
		// l'unità di §6.2, non l'orologio.
		const a = evento({ id: ID_A, startsAt: daLocaleAIstante('2026-10-12T23:30') });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			startsAt: daLocaleAIstante('2026-10-13T00:30')
		});

		expect(geoGenreOverlap(a, b)).toBeNull();
		expect(sameDayProximity(a, b)).toBeNull();
	});

	it('la mezzanotte esatta appartiene al giorno che comincia', () => {
		const a = evento({ id: ID_A, startsAt: daLocaleAIstante('2026-10-13T00:00') });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			startsAt: daLocaleAIstante('2026-10-13T22:00')
		});

		expect(geoGenreOverlap(a, b)).not.toBeNull();
	});

	it('senza coordinate nessuna regola geografica scatta', () => {
		const a = evento({ id: ID_A, lat: null, lon: null });
		const b = evento({ id: ID_B, organizationId: ORG_B });

		expect(geoGenreOverlap(a, b)).toBeNull();
		expect(sameDayProximity(a, b)).toBeNull();
	});

	it('registra la coppia di generi che ha prodotto l’affinità', () => {
		const a = evento({ id: ID_A, generi: [{ path: DEATH, isPrimary: true }] });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			generi: [{ path: BLACK, isPrimary: true }]
		});

		const c = geoGenreOverlap(a, b);
		expect(c?.affinita).toBe(0.5);
		expect(c?.dettagli.generi).toEqual({ pathA: DEATH, pathB: BLACK });
	});
});

/* ------------------------------------------------------------------ *
 * Ora legale
 * ------------------------------------------------------------------ */

describe('cambio dell’ora legale', () => {
	// In Italia l'ora legale finisce l'ultima domenica di ottobre: nel 2026 è
	// il 25. Quella domenica dura 25 ore.
	it('due date sulla stessa notte del ritorno all’ora solare sono lo stesso giorno', () => {
		const a = evento({ id: ID_A, startsAt: daLocaleAIstante('2026-10-25T02:30') });
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			startsAt: daLocaleAIstante('2026-10-25T22:00')
		});

		expect(geoGenreOverlap(a, b)).not.toBeNull();
	});

	it('il giorno prima e il giorno del cambio distano un giorno, non zero', () => {
		// È il caso che ADR-0021 chiede di coprire: dividendo i millisecondi
		// per 86.400.000, un sabato sera e la domenica da 25 ore che segue
		// risulterebbero a meno di un giorno di distanza.
		const a = evento({
			id: ID_A,
			lineup: conOpeth(true),
			startsAt: daLocaleAIstante('2026-10-24T22:00')
		});
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			lineup: conOpeth(true),
			startsAt: daLocaleAIstante('2026-10-25T23:30'),
			...TERNI
		});

		expect(artistOverlap(a, b)?.giorniDiDistanza).toBe(1);
	});

	it('lo stesso vale al passaggio all’ora legale, che dura 23 ore', () => {
		// Ultima domenica di marzo 2026: il 29.
		const a = evento({
			id: ID_A,
			lineup: conOpeth(true),
			startsAt: daLocaleAIstante('2026-03-28T22:00')
		});
		const b = evento({
			id: ID_B,
			organizationId: ORG_B,
			lineup: conOpeth(true),
			startsAt: daLocaleAIstante('2026-03-29T21:00'),
			...TERNI
		});

		expect(artistOverlap(a, b)?.giorniDiDistanza).toBe(1);
	});
});
