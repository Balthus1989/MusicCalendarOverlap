/**
 * L'aggregazione della scheda operativa della band (ARCHITECTURE.md §4.7.2).
 *
 * La soglia è il cuore di ADR-0049 ed è il punto in cui un errore non si vede:
 * una fascia mostrata una volta di troppo non solleva niente e non rompe
 * nessuna pagina. Da qui l'insistenza sui due casi che contano davvero:
 * **dieci osservazioni della stessa organizzazione non superano niente**,
 * perché il criterio non è quante righe ci sono ma da quante organizzazioni
 * vengono; e **l'aggregato non si inverte**, cioè chi ne ha scritta una non
 * ricava le altre. La seconda è la correzione di ADR-0049 arrivata guardando
 * la pagina vera: pubblicare gli estremi rendeva la soglia decorativa.
 */
import { describe, expect, it } from 'vitest';
import {
	aggregaScheda,
	inizioFinestra,
	MESI_FINESTRA,
	type OsservazionePura
} from '../../src/lib/server/catalog/scheda';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';
const ORG_C = 'cccccccc-0000-0000-0000-000000000000';

/** Un martedì qualunque, lontano dai cambi d'ora. */
const OGGI = new Date('2026-09-01T10:00:00Z');

let contatore = 0;

function oss(over: Partial<OsservazionePura> = {}): OsservazionePura {
	contatore += 1;
	return {
		id: `id-${contatore}`,
		organizationId: ORG_A,
		origine: 'osservata',
		fasciaCachet: '600_1200',
		cachetInclude: 'solo_cachet',
		durataSetMinuti: null,
		volumeOsservato: null,
		dataRiferimento: '2026-03-14',
		ruolo: 'headliner',
		...over
	};
}

describe('la finestra', () => {
	it('parte da ventiquattro mesi prima del giorno civile', () => {
		expect(inizioFinestra(OGGI)).toBe('2024-09-01');
		expect(MESI_FINESTRA).toBe(24);
	});

	it('non si fa spostare dal riporto dei mesi', () => {
		expect(inizioFinestra(new Date('2026-01-15T12:00:00Z'), 24)).toBe('2024-01-15');
		expect(inizioFinestra(new Date('2026-01-15T12:00:00Z'), 12)).toBe('2025-01-15');
	});

	it('scarta le osservazioni più vecchie della finestra', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, dataRiferimento: '2024-01-10' }),
				oss({ organizationId: ORG_B, dataRiferimento: '2024-02-10' })
			],
			OGGI
		);
		// Due osservazioni da due organizzazioni: supererebbero la soglia se
		// fossero nella finestra. Non ci sono, quindi non esiste niente.
		expect(s.cachet.stato).toBe('nessun_dato');
	});
});

describe('la soglia del cachet', () => {
	it('non mostra niente con una sola osservazione', () => {
		const s = aggregaScheda([oss()], OGGI);
		expect(s.cachet.stato).toBe('sotto_soglia');
	});

	it('non mostra niente con dieci osservazioni della stessa organizzazione', () => {
		const righe = Array.from({ length: 10 }, () => oss({ organizationId: ORG_A }));
		const s = aggregaScheda(righe, OGGI);
		// È il caso più frequente e il più insidioso: l'organizzazione che
		// compila con diligenza tutte le proprie date passate.
		expect(s.cachet.stato).toBe('sotto_soglia');
	});

	it('non basta che siano due, nemmeno da due organizzazioni', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_B, fasciaCachet: '1200_2500' })
			],
			OGGI
		);
		// Con due, chiunque ne abbia scritta una ricava l'altra: l'aggregato
		// non aggrega niente, riporta. Vedi la correzione in ADR-0049.
		expect(s.cachet.stato).toBe('sotto_soglia');
	});

	it('mostra la fascia con tre osservazioni da due organizzazioni', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_B, fasciaCachet: '1200_2500' })
			],
			OGGI
		);
		expect(s.cachet).toMatchObject({
			stato: 'disponibile',
			fascia: '600_1200',
			osservazioni: 3,
			organizzazioni: 2
		});
	});

	it('pubblica la mediana e non gli estremi, che si invertono', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, fasciaCachet: 'oltre_5000' }),
				oss({ organizationId: ORG_B, fasciaCachet: 'fino_a_300' }),
				oss({ organizationId: ORG_C, fasciaCachet: '600_1200' })
			],
			OGGI
		);
		const cachet = s.cachet;
		expect(cachet).toMatchObject({ stato: 'disponibile', fascia: '600_1200' });
		// Gli estremi non escono da nessuna parte: se uscissero, chi possiede
		// una delle tre osservazioni saprebbe che le altre due sono agli
		// antipodi della scala.
		expect(Object.keys(cachet)).not.toContain('da');
		expect(Object.keys(cachet)).not.toContain('a');
	});

	it('su un numero pari sceglie la fascia più bassa fra le due centrali', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, fasciaCachet: 'fino_a_300' }),
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_B, fasciaCachet: '1200_2500' }),
				oss({ organizationId: ORG_B, fasciaCachet: 'oltre_5000' })
			],
			OGGI
		);
		// Fra due risposte difendibili conviene quella che non gonfia il prezzo
		// di una band che di quel numero non sa niente.
		expect(s.cachet).toMatchObject({ stato: 'disponibile', fascia: '600_1200' });
	});

	it('non si inverte: chi ne possiede una non ricava le altre', () => {
		const righe = [
			oss({ organizationId: ORG_A, fasciaCachet: 'fino_a_300' }),
			oss({ organizationId: ORG_A, fasciaCachet: 'oltre_5000' }),
			oss({ organizationId: ORG_B, fasciaCachet: '600_1200' })
		];
		const pubblicato = JSON.stringify(aggregaScheda(righe, OGGI).cachet);

		// Beta possiede la fascia di mezzo. Se dall'aggregato risalisse alle
		// due di Alfa la soglia non proteggerebbe niente: le due fasce estreme
		// non devono comparire da nessuna parte.
		expect(pubblicato).not.toContain('fino_a_300');
		expect(pubblicato).not.toContain('oltre_5000');
	});

	it('non conta le osservazioni senza fascia', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_B, fasciaCachet: null, durataSetMinuti: 50 })
			],
			OGGI
		);
		// La terza riga è un'osservazione valida ma non dice niente sul prezzo:
		// due organizzazioni sì, tre osservazioni di cachet no.
		expect(s.cachet.stato).toBe('sotto_soglia');
	});

	it('raccoglie senza duplicati che cosa comprendevano i cachet', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, cachetInclude: 'solo_cachet' }),
				oss({ organizationId: ORG_B, cachetInclude: 'solo_cachet' }),
				oss({ organizationId: ORG_C, cachetInclude: 'tutto_incluso' })
			],
			OGGI
		);
		expect(s.cachet.stato === 'disponibile' && s.cachet.include).toBe('solo_cachet');
	});
});

describe('la freschezza', () => {
	it('è a blocchi grossi e non è mai una data', () => {
		const recente = aggregaScheda(
			[
				oss({ organizationId: ORG_A, dataRiferimento: '2026-07-01' }),
				oss({ organizationId: ORG_A, dataRiferimento: '2026-06-01' }),
				oss({ organizationId: ORG_B, dataRiferimento: '2025-01-01' })
			],
			OGGI
		);
		expect(recente.cachet.stato === 'disponibile' && recente.cachet.freschezza).toBe(
			'ultimi_12_mesi'
		);

		const vecchia = aggregaScheda(
			[
				oss({ organizationId: ORG_A, dataRiferimento: '2025-02-01' }),
				oss({ organizationId: ORG_A, dataRiferimento: '2025-01-15' }),
				oss({ organizationId: ORG_B, dataRiferimento: '2025-01-01' })
			],
			OGGI
		);
		expect(vecchia.cachet.stato === 'disponibile' && vecchia.cachet.freschezza).toBe(
			'da_12_a_24_mesi'
		);
	});
});

describe('le riferite', () => {
	it('non concorrono alla soglia e non entrano nella fascia comune', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, fasciaCachet: '600_1200' }),
				oss({ organizationId: ORG_B, origine: 'riferita', fasciaCachet: 'oltre_5000' })
			],
			OGGI
		);
		// Una osservata e una riferita: la soglia chiede tre osservate.
		expect(s.cachet.stato).toBe('sotto_soglia');
		expect(s.riferite).toEqual({ conteggio: 1, fascia: 'oltre_5000' });
	});

	it('hanno una riga propria, con il loro conteggio', () => {
		const s = aggregaScheda(
			[
				oss({ organizationId: ORG_A, origine: 'riferita', fasciaCachet: '300_600' }),
				oss({ organizationId: ORG_B, origine: 'riferita', fasciaCachet: '1200_2500' })
			],
			OGGI
		);
		expect(s.cachet.stato).toBe('nessun_dato');
		// Anche le riferite pubblicano una mediana e non gli estremi: due
		// riferite si invertono esattamente come si invertivano due osservate.
		expect(s.riferite).toEqual({ conteggio: 2, fascia: '300_600' });
	});

	it('non entrano nemmeno negli aggregati che non hanno soglia', () => {
		const s = aggregaScheda(
			[oss({ origine: 'riferita', fasciaCachet: null, durataSetMinuti: 200 })],
			OGGI
		);
		// Duemila minuti di sentito dire non spostano la mediana di niente.
		expect(s.durata.medianaMinuti).toBeNull();
		expect(s.durata.osservazioni).toBe(0);
	});
});

describe('durata del set e volume', () => {
	it('si mostrano da una sola osservazione: non sono prezzi', () => {
		const s = aggregaScheda(
			[oss({ fasciaCachet: null, durataSetMinuti: 55, volumeOsservato: 'furgone' })],
			OGGI
		);
		expect(s.durata.medianaMinuti).toBe(55);
		expect(s.volume.modale).toBe('furgone');
	});

	it('usano la mediana, che un set da tre ore non trascina', () => {
		const s = aggregaScheda(
			[
				oss({ fasciaCachet: null, durataSetMinuti: 40 }),
				oss({ fasciaCachet: null, durataSetMinuti: 45 }),
				oss({ fasciaCachet: null, durataSetMinuti: 180 })
			],
			OGGI
		);
		expect(s.durata.medianaMinuti).toBe(45);
	});

	it('arrotondano la mediana su un numero pari di osservazioni', () => {
		const s = aggregaScheda(
			[
				oss({ fasciaCachet: null, durataSetMinuti: 40 }),
				oss({ fasciaCachet: null, durataSetMinuti: 45 })
			],
			OGGI
		);
		expect(s.durata.medianaMinuti).toBe(43);
	});

	it('separano per ruolo solo dove i numeri lo permettono', () => {
		const s = aggregaScheda(
			[
				oss({ fasciaCachet: null, durataSetMinuti: 70, ruolo: 'headliner' }),
				oss({ fasciaCachet: null, durataSetMinuti: 80, ruolo: 'headliner' }),
				oss({ fasciaCachet: null, durataSetMinuti: 30, ruolo: 'support' })
			],
			OGGI
		);
		// `support` ha una sola riga: la sua "mediana" sarebbe il dato singolo
		// con un nome più rispettabile, e non compare.
		expect(s.durata.perRuolo).toEqual([{ ruolo: 'headliner', minuti: 75, osservazioni: 2 }]);
	});

	it('prendono il volume più frequente, non il più grande', () => {
		const s = aggregaScheda(
			[
				oss({ fasciaCachet: null, volumeOsservato: 'furgone' }),
				oss({ fasciaCachet: null, volumeOsservato: 'furgone' }),
				oss({ fasciaCachet: null, volumeOsservato: 'camion' })
			],
			OGGI
		);
		expect(s.volume.modale).toBe('furgone');
		expect(s.volume.osservazioni).toBe(3);
	});
});

describe('la scheda vuota', () => {
	it('non inventa niente', () => {
		const s = aggregaScheda([], OGGI);
		expect(s.cachet.stato).toBe('nessun_dato');
		expect(s.riferite.conteggio).toBe(0);
		expect(s.durata.medianaMinuti).toBeNull();
		expect(s.volume.modale).toBeNull();
	});
});
