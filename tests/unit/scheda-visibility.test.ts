/**
 * La matrice di visibilità della scheda operativa della band
 * (ARCHITECTURE.md §5, seconda matrice).
 *
 * Una asserzione per cella, come per gli eventi. Il criterio di fine della
 * Fase 7 è scritto qui sotto e non a parole: **due organizzazioni annotano la
 * stessa band e nessuna delle due risale alla fascia dell'altra**, mentre una
 * terza vede l'intervallo e non vede chi l'ha prodotto.
 *
 * Le due colonne che sorprendono — moderatore e platform admin — sono
 * deliberate: il moderatore cura l'identità della band, non il registro di chi
 * l'ha pagata (ADR-0016 al contrario), e sul platform admin vale ADR-0019.
 */
import { describe, expect, it } from 'vitest';
import {
	redigiScheda,
	serializeArtistCard,
	type OsservazioneGrezza,
	type SchedaGrezza,
	type ViewerContext
} from '../../src/lib/server/visibility';

const ORG_MIA = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_ALTRA = 'bbbbbbbb-0000-0000-0000-000000000000';
const ORG_TERZA = 'cccccccc-0000-0000-0000-000000000000';
const BAND = 'dddddddd-0000-0000-0000-000000000000';

const OGGI = new Date('2026-09-01T10:00:00Z');

function viewer(over: Partial<ViewerContext> = {}): ViewerContext {
	return {
		profileId: 'ffffffff-0000-0000-0000-000000000000',
		organizationIds: [ORG_MIA],
		roles: { [ORG_MIA]: 'member' },
		isPlatformAdmin: false,
		...over
	};
}

let contatore = 0;

function osservazione(over: Partial<OsservazioneGrezza> = {}): OsservazioneGrezza {
	contatore += 1;
	return {
		id: `oss-${contatore}`,
		organizationId: ORG_MIA,
		origine: 'osservata',
		fasciaCachet: '600_1200',
		cachetInclude: 'cachet_e_viaggio',
		durataSetMinuti: 55,
		volumeOsservato: 'furgone',
		dataRiferimento: '2026-03-14',
		ruolo: 'headliner',
		capienzaVenue: 180,
		regione: 'Umbria',
		eventId: `evento-${contatore}`,
		titoloEvento: `Serata ${contatore}`,
		...over
	};
}

function scheda(over: Partial<SchedaGrezza> = {}): SchedaGrezza {
	return {
		artistId: BAND,
		schedaSpenta: false,
		dichiarati: {
			volumeAttrezzatura: 'furgone',
			personeInViaggio: 5,
			richiedeBackline: true,
			durataSetMaxDichiarata: 75
		},
		osservazioni: [],
		...over
	};
}

/* ------------------------------------------------------------------ *
 * Riga per riga
 * ------------------------------------------------------------------ */

describe('i fatti dichiarati', () => {
	it('si vedono da chiunque: non sono di nessuno, come il nome', () => {
		const s = scheda();
		for (const chi of [
			viewer(),
			viewer({ organizationIds: [ORG_ALTRA], roles: { [ORG_ALTRA]: 'member' } }),
			viewer({ organizationIds: [], roles: { [ORG_MIA]: 'moderator' } }),
			viewer({ organizationIds: [], roles: {}, isPlatformAdmin: true })
		]) {
			expect(serializeArtistCard(s, chi, OGGI)?.dichiarati).toEqual({
				volumeAttrezzatura: 'furgone',
				personeInViaggio: 5,
				richiedeBackline: true,
				durataSetMaxDichiarata: 75
			});
		}
	});
});

describe('le osservazioni sotto soglia', () => {
	const unaSola = scheda({ osservazioni: [osservazione({ organizationId: ORG_MIA })] });

	it('chi le ha scritte continua a vedere le proprie', () => {
		const vista = serializeArtistCard(unaSola, viewer(), OGGI)!;
		expect(vista.comune.cachet.stato).toBe('sotto_soglia');
		expect(vista.mie).toHaveLength(1);
		expect(vista.mie[0].fasciaCachet).toBe('600_1200');
	});

	it('un’altra organizzazione non vede niente, nemmeno quante ne mancano', () => {
		const vista = serializeArtistCard(
			unaSola,
			viewer({ organizationIds: [ORG_ALTRA], roles: { [ORG_ALTRA]: 'member' } }),
			OGGI
		)!;
		expect(vista.comune.cachet).toEqual({ stato: 'sotto_soglia' });
		expect(vista.mie).toEqual([]);
	});

	it('il moderatore non ne vede più di un’altra organizzazione', () => {
		const vista = serializeArtistCard(
			unaSola,
			viewer({ organizationIds: [ORG_ALTRA], roles: { [ORG_ALTRA]: 'moderator' } }),
			OGGI
		)!;
		expect(vista.comune.cachet).toEqual({ stato: 'sotto_soglia' });
		expect(vista.mie).toEqual([]);
	});

	it('il platform admin senza organizzazioni non ne vede nessuna', () => {
		const vista = serializeArtistCard(
			unaSola,
			viewer({ organizationIds: [], roles: {}, isPlatformAdmin: true }),
			OGGI
		)!;
		expect(vista.comune.cachet).toEqual({ stato: 'sotto_soglia' });
		expect(vista.mie).toEqual([]);
	});
});

describe('il criterio di fine della Fase 7', () => {
	const dueLati = scheda({
		osservazioni: [
			osservazione({ organizationId: ORG_MIA, fasciaCachet: 'fino_a_300' }),
			osservazione({ organizationId: ORG_ALTRA, fasciaCachet: '600_1200' }),
			osservazione({ organizationId: ORG_ALTRA, fasciaCachet: 'oltre_5000' })
		]
	});

	it('nessuna delle due organizzazioni risale alla fascia dell’altra', () => {
		const mia = serializeArtistCard(dueLati, viewer(), OGGI)!;
		const altra = serializeArtistCard(
			dueLati,
			viewer({ organizationIds: [ORG_ALTRA], roles: { [ORG_ALTRA]: 'member' } }),
			OGGI
		)!;

		expect(mia.mie.map((o) => o.fasciaCachet)).toEqual(['fino_a_300']);
		expect(altra.mie.map((o) => o.fasciaCachet).sort()).toEqual(['600_1200', 'oltre_5000']);

		// La fascia comune è la stessa per tutti e due ed è una mediana: da
		// sola non permette di ricostruire nessuna delle righe che l'hanno
		// prodotta. È la correzione di ADR-0049.
		for (const vista of [mia, altra]) {
			expect(vista.comune.cachet).toMatchObject({ stato: 'disponibile', fascia: '600_1200' });
		}

		// La prova in negativo, che è quella che conta davvero: chi possiede
		// la fascia più bassa non deve poter leggere da nessuna parte quella
		// più alta dell'altra organizzazione.
		expect(JSON.stringify(mia.comune)).not.toContain('oltre_5000');
	});

	it('una terza vede la fascia comune e non vede chi l’ha prodotta', () => {
		const vista = serializeArtistCard(
			dueLati,
			viewer({ organizationIds: [ORG_TERZA], roles: { [ORG_TERZA]: 'member' } }),
			OGGI
		)!;

		expect(vista.comune.cachet).toMatchObject({
			stato: 'disponibile',
			osservazioni: 3,
			organizzazioni: 2
		});
		expect(vista.mie).toEqual([]);

		// La prova che nessun identificativo sopravvive alla serializzazione:
		// gli id delle organizzazioni non compaiono da nessuna parte.
		const testo = JSON.stringify(vista);
		expect(testo).not.toContain(ORG_MIA);
		expect(testo).not.toContain(ORG_ALTRA);
	});

	it('non lascia uscire né la data esatta né la serata di chi non guarda', () => {
		const vista = serializeArtistCard(
			dueLati,
			viewer({ organizationIds: [ORG_TERZA], roles: { [ORG_TERZA]: 'member' } }),
			OGGI
		)!;
		const testo = JSON.stringify(vista);
		expect(testo).not.toContain('2026-03-14');
		expect(testo).not.toContain('Serata');
	});

	it('a chi ha scritto lascia data, serata e collegamento all’evento', () => {
		const vista = serializeArtistCard(dueLati, viewer(), OGGI)!;
		expect(vista.mie[0]).toMatchObject({
			dataRiferimento: '2026-03-14',
			ruolo: 'headliner',
			capienzaVenue: 180
		});
		expect(vista.mie[0].eventId).toBeTruthy();
		expect(vista.mie[0].titoloEvento).toContain('Serata');
	});
});

describe('le riferite', () => {
	const conRiferita = scheda({
		osservazioni: [
			osservazione({ organizationId: ORG_ALTRA, origine: 'riferita', fasciaCachet: '2500_5000' })
		]
	});

	it('conteggio e fasce si vedono da chiunque', () => {
		const vista = serializeArtistCard(conRiferita, viewer(), OGGI)!;
		expect(vista.comune.riferite).toEqual({ conteggio: 1, fascia: '2500_5000' });
	});

	it('chi l’ha scritta non compare, e la riga resta fuori dall’intervallo', () => {
		const vista = serializeArtistCard(conRiferita, viewer(), OGGI)!;
		expect(vista.mie).toEqual([]);
		expect(vista.comune.cachet.stato).toBe('nessun_dato');
		expect(JSON.stringify(vista)).not.toContain(ORG_ALTRA);
	});

	it('la propria riferita si vede per intero, come le altre proprie righe', () => {
		const vista = serializeArtistCard(
			conRiferita,
			viewer({ organizationIds: [ORG_ALTRA], roles: { [ORG_ALTRA]: 'member' } }),
			OGGI
		)!;
		expect(vista.mie).toHaveLength(1);
		expect(vista.mie[0].origine).toBe('riferita');
	});
});

describe('la scheda spenta su richiesta della band', () => {
	const spenta = scheda({
		schedaSpenta: true,
		osservazioni: [
			osservazione({ organizationId: ORG_MIA }),
			osservazione({ organizationId: ORG_ALTRA })
		]
	});

	it('non restituisce niente a nessuno, nemmeno a chi ha scritto', () => {
		expect(serializeArtistCard(spenta, viewer(), OGGI)).toBeNull();
	});

	it('non restituisce niente nemmeno al moderatore o al platform admin', () => {
		expect(
			serializeArtistCard(spenta, viewer({ roles: { [ORG_MIA]: 'moderator' } }), OGGI)
		).toBeNull();
		expect(serializeArtistCard(spenta, viewer({ isPlatformAdmin: true }), OGGI)).toBeNull();
	});
});

describe('redigiScheda, il nucleo', () => {
	it('calcola l’aggregato su tutte le righe, comprese le proprie', () => {
		const righe = [
			osservazione({ organizationId: ORG_MIA, fasciaCachet: 'fino_a_300' }),
			osservazione({ organizationId: ORG_ALTRA, fasciaCachet: '600_1200' }),
			osservazione({ organizationId: ORG_ALTRA, fasciaCachet: 'oltre_5000' })
		];
		// La fascia comune è un fatto del gruppo: non cambia a seconda di chi
		// guarda, cambia solo quanto se ne vede sotto.
		const daUnLato = redigiScheda(righe, [ORG_MIA], OGGI);
		const daFuori = redigiScheda(righe, [ORG_TERZA], OGGI);
		expect(daUnLato.comune).toEqual(daFuori.comune);
		expect(daUnLato.mie).toHaveLength(1);
		expect(daFuori.mie).toHaveLength(0);
	});

	it('ordina le proprie dalla più recente', () => {
		const r = redigiScheda(
			[
				osservazione({ dataRiferimento: '2025-05-01' }),
				osservazione({ dataRiferimento: '2026-05-01' })
			],
			[ORG_MIA],
			OGGI
		);
		expect(r.mie.map((o) => o.dataRiferimento)).toEqual(['2026-05-01', '2025-05-01']);
	});
});
