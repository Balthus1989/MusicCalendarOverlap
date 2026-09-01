/**
 * Che cosa si può scrivere in un'osservazione sulla scheda di una band
 * (ADR-0048, ADR-0049).
 *
 * Vale la pena leggere questo file per ciò che **non** contiene: non c'è un
 * campo per l'importo esatto, e non c'è nessun campo di testo. Non sono
 * omissioni da colmare — una cifra precisa non viene nascosta in uscita, non
 * entra proprio (ADR-0049), e una nota libera su una band è la differenza fra
 * un archivio operativo e una lista nera (ADR-0050).
 */
import { z } from 'zod';
import { enumOpzionale, interoOpzionale } from './common';
import { VOLUMI } from './artist';

const ANNO_CORRENTE = new Date().getUTCFullYear();

export const FASCE_CACHET = [
	'fino_a_300',
	'300_600',
	'600_1200',
	'1200_2500',
	'2500_5000',
	'oltre_5000'
] as const;

export const AMBITI_CACHET = ['solo_cachet', 'cachet_e_viaggio', 'tutto_incluso'] as const;

const campiComuni = {
	fasciaCachet: enumOpzionale(FASCE_CACHET),
	cachetInclude: enumOpzionale(AMBITI_CACHET),
	/**
	 * Minuti effettivamente suonati. Il massimo è generoso di proposito: un set
	 * di tre ore esiste, e un limite stretto costringerebbe a mentire.
	 */
	durataSetMinuti: interoOpzionale(1, 600),
	volumeOsservato: enumOpzionale(VOLUMI)
};

/**
 * Almeno un dato fra i tre, come il `CHECK` sul database: un'osservazione
 * vuota non è un'osservazione. Il controllo sta in tutti e due i posti perché
 * il messaggio d'errore utile lo sa dare solo questo.
 */
const haAlmenoUnDato = (d: {
	fasciaCachet: string | null;
	durataSetMinuti: number | null;
	volumeOsservato: string | null;
}) => d.fasciaCachet !== null || d.durataSetMinuti !== null || d.volumeOsservato !== null;

const MESSAGGIO_VUOTA = 'Serve almeno un dato: la fascia, i minuti suonati o il volume.';

/**
 * La forma piena: appesa a una riga di lineup di una propria data passata e
 * confermata. La data, il ruolo in cartellone, la capienza e la regione non si
 * chiedono a nessuno — arrivano dall'evento.
 */
export const osservazioneSchema = z
	.object({
		eventLineupId: z.uuid('Riferimento alla serata non valido.'),
		...campiComuni
	})
	.refine(haAlmenoUnDato, { message: MESSAGGIO_VUOTA });

/**
 * Il sentito dire, per una band che nel gruppo non ha ancora portato nessuno.
 *
 * Chiede l'anno perché senza non scadrebbe mai, e il passato ammesso si ferma
 * alla finestra di 24 mesi: un sentito dire più vecchio non entrerebbe comunque
 * in nessun aggregato, e accettarlo darebbe l'idea che serva a qualcosa.
 */
export const riferitaSchema = z
	.object({
		artistId: z.uuid('Riferimento alla band non valido.'),
		annoRiferimento: z.coerce
			.number()
			.int()
			.min(ANNO_CORRENTE - 2, 'Troppo indietro nel tempo per dire ancora qualcosa.')
			.max(ANNO_CORRENTE, 'Non si può riferire il futuro.'),
		...campiComuni
	})
	.refine(haAlmenoUnDato, { message: MESSAGGIO_VUOTA });

export type OsservazioneInput = z.infer<typeof osservazioneSchema>;
export type RiferitaInput = z.infer<typeof riferitaSchema>;
