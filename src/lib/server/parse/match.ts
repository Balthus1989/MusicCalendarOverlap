/**
 * Le band lette nel testo, cercate in anagrafica (ARCHITECTURE.md §9 punto 4).
 *
 * **Propone, non collega.** `artistId` resta vuoto nel form e i candidati
 * viaggiano a parte: è il «ogni match richiede conferma esplicita» della
 * specifica, e non è una cortesia. Collegare da soli la riga "Fossa" alla
 * scheda sbagliata fra due omonimi non si vede nel form — il campo mostra il
 * nome giusto — e falsa la regola R2 del motore conflitti, che confronta gli
 * `artist_id` e non i nomi (ADR-0006).
 *
 * La ricerca passa da `findDuplicates()`, la stessa funzione che avvisa dei
 * doppioni quando si inserisce una scheda nuova. Non è riuso per pigrizia: i
 * criteri con cui due nomi sono "la stessa band" devono essere gli stessi nei
 * due punti, altrimenti l'import propone accostamenti che l'anagrafica
 * considera band diverse.
 *
 * **MusicBrainz resta fuori da qui**, e §9 punto 4 lo nominava. La policy del
 * servizio ammette una richiesta al secondo: cercare cinque band di una
 * locandina vorrebbe dire cinque secondi di attesa sotto un form, per un
 * risultato che è comunque da confermare a mano. La strada per portare una
 * band nuova in anagrafica con il suo MBID esiste già ed è quella giusta —
 * `/artists/new`, dove l'autocomplete MusicBrainz è a richiesta esplicita,
 * come prescrive ADR-0006. Vedi ADR-0034.
 */
import type { VoceLineupForm } from '$lib/events';
import type { CandidatoArtista, PropostaArtista } from '$lib/parse';
import type { Database } from '$lib/server/db/client';
import { findDuplicates } from '$lib/server/catalog/artists';

/**
 * Oltre questa soglia non si cerca più.
 *
 * Una locandina di festival può avere quaranta nomi. Le prime righe sono
 * quelle che contano e che qualcuno riguarderà davvero; sulle altre la
 * proposta sarebbe rumore che nessuno legge, pagato con una query a testa.
 */
const RIGHE_MASSIME = 30;

/**
 * Le forme stanno in `$lib/parse.ts` e non qui: il pannello dell'incolla le
 * mostra nel browser, e da lì `$lib/server` non si importa. `motivo` usa lo
 * stesso vocabolario di `findDuplicates` — «stesso identificativo
 * MusicBrainz», «stesso nome», «nome simile» — perché è quello con cui
 * l'anagrafica descrive già i doppioni, e due vocabolari per la stessa cosa
 * sono due cose da imparare.
 */
export type { CandidatoArtista, PropostaArtista };

/**
 * Per ogni riga di lineup, chi in anagrafica potrebbe essere quella band.
 *
 * Le righe senza candidati non tornano affatto: una proposta vuota non è
 * un'informazione, e riempirebbe il pannello di righe che dicono "niente".
 */
export async function proponiArtisti(
	db: Database,
	lineup: VoceLineupForm[]
): Promise<PropostaArtista[]> {
	const richieste = lineup
		.map((v, indice) => ({ indice, nome: v.artistName.trim(), giaCollegata: Boolean(v.artistId) }))
		// Una riga già collegata non ha bisogno di proposte, e un nome di una
		// lettera — o un "TBA" — non è una band da cercare in anagrafica.
		.filter((r) => !r.giaCollegata && r.nome.length >= 2)
		.slice(0, RIGHE_MASSIME);

	if (!richieste.length) return [];

	// In parallelo: il pool ha dieci connessioni proprio perché le richieste
	// concorrenti sono la norma e non un caso di punta (ADR-0026). In serie,
	// una locandina da otto band sarebbe otto andate e ritorno.
	const esiti = await Promise.all(
		richieste.map(async (r) => ({
			indice: r.indice,
			nome: r.nome,
			candidati: (await findDuplicates(db, r.nome, null)).map((c) => ({
				id: c.id,
				name: c.name,
				motivo: c.motivo
			}))
		}))
	);

	return esiti.filter((e) => e.candidati.length > 0);
}
