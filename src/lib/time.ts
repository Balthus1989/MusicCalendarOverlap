/**
 * Fuso orario applicativo (ARCHITECTURE.md §16).
 *
 * Nel database tutto è `timestamptz`, cioè un istante assoluto. Ma un
 * organizzatore ragiona per orario di parete: "il 12 ottobre alle 22". Le due
 * cose coincidono solo per caso, e mai nelle due domeniche l'anno in cui
 * cambia l'ora legale.
 *
 * Qui sta l'unica conversione fra i due mondi. È codice puro e testato, anche
 * se non fa parte del motore conflitti: il "giorno civile" della regola R3 si
 * calcola con `giornoCivile()`, e sbagliarlo significa sbagliare i conflitti.
 *
 * Nessuna dipendenza: `Intl` sa già tutto sulle regole di fuso, incluse quelle
 * storiche. Serve solo interrogarlo nel verso giusto.
 */

export const FUSO_APP = 'Europe/Rome';

/** Durata assunta quando `ends_at` è nullo (ARCHITECTURE.md §4.4). */
export const DURATA_PREDEFINITA_MS = 4 * 60 * 60 * 1000;

const CAMPI = {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
} as const;

/** Un `Intl.DateTimeFormat` per fuso, riusato: costruirlo costa. */
const formatter = new Map<string, Intl.DateTimeFormat>();

function formatoPer(fuso: string): Intl.DateTimeFormat {
	let f = formatter.get(fuso);
	if (!f) {
		// `hourCycle: 'h23'` e non `hour12: false`: quest'ultimo, con alcune
		// locale, restituisce "24" per la mezzanotte e sposta il giorno.
		f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', ...CAMPI });
		formatter.set(fuso, f);
	}
	return f;
}

type Parti = { anno: number; mese: number; giorno: number; ora: number; minuto: number };

/** I campi dell'orologio da parete di quell'istante, in quel fuso. */
function partiLocali(istante: Date, fuso: string): Parti {
	const p = Object.fromEntries(
		formatoPer(fuso)
			.formatToParts(istante)
			.map((x) => [x.type, x.value])
	);
	return {
		anno: Number(p.year),
		mese: Number(p.month),
		giorno: Number(p.day),
		ora: Number(p.hour),
		minuto: Number(p.minute)
	};
}

/** Scarto fra il fuso e UTC, in millisecondi, valido *per quell'istante*. */
function scartoMs(istante: Date, fuso: string): number {
	const l = partiLocali(istante, fuso);
	const comeSeUtc = Date.UTC(l.anno, l.mese - 1, l.giorno, l.ora, l.minuto);
	// I secondi si perdono nell'arrotondamento al minuto: nessun fuso ha mai
	// avuto scarti non multipli del minuto in epoca informatica.
	return comeSeUtc - Math.floor(istante.getTime() / 60000) * 60000;
}

/**
 * Da orario di parete (`2026-10-12T22:00`, come lo scrive un `datetime-local`)
 * all'istante assoluto.
 *
 * Il doppio passaggio serve al cambio d'ora: lo scarto va misurato sull'istante
 * giusto, ma per sapere qual è l'istante giusto serve già lo scarto. Si parte
 * da una stima, si corregge, e per le date normali la correzione è nulla.
 *
 * Le due ore ambigue dell'anno si comportano così: l'ora che non esiste (l'una
 * di notte dell'ultima domenica di marzo) scala in avanti, l'ora ripetuta di
 * ottobre si risolve sulla prima occorrenza, cioè quella legale. Sono le stesse
 * scelte che fa un calendario qualunque.
 */
export function daLocaleAIstante(locale: string, fuso: string = FUSO_APP): Date {
	const [dataParte, oraParte = '00:00'] = locale.trim().split('T');
	const [anno, mese, giorno] = dataParte.split('-').map(Number);
	const [ora, minuto] = oraParte.split(':').map(Number);

	const stima = Date.UTC(anno, mese - 1, giorno, ora || 0, minuto || 0);
	const primoScarto = scartoMs(new Date(stima), fuso);
	const candidato = new Date(stima - primoScarto);

	const secondoScarto = scartoMs(candidato, fuso);
	if (secondoScarto === primoScarto) return candidato;
	return new Date(stima - secondoScarto);
}

const dueCifre = (n: number) => String(n).padStart(2, '0');

/** Verso l'attributo `value` di un `<input type="datetime-local">`. */
export function aLocaleInput(istante: Date | null, fuso: string = FUSO_APP): string {
	if (!istante) return '';
	const l = partiLocali(istante, fuso);
	return `${l.anno}-${dueCifre(l.mese)}-${dueCifre(l.giorno)}T${dueCifre(l.ora)}:${dueCifre(l.minuto)}`;
}

/**
 * Il giorno civile di un istante, come `YYYY-MM-DD`.
 *
 * È l'equivalente esatto in codice di `date_trunc('day', starts_at AT TIME
 * ZONE 'Europe/Rome')`, e come quello segue l'orologio: un concerto che
 * comincia all'una di notte del 13 ottobre appartiene al 13, anche se per chi
 * lo organizza è la coda della serata del 12. Non si corregge con un'ora di
 * taglio, per quanto sarebbe più fedele al modo di ragionare di un
 * organizzatore: il filtro SQL e le regole R2/R3 devono rispondere lo stesso
 * giorno, e il database sa fare solo `date_trunc`.
 */
export function giornoCivile(istante: Date, fuso: string = FUSO_APP): string {
	const l = partiLocali(istante, fuso);
	return `${l.anno}-${dueCifre(l.mese)}-${dueCifre(l.giorno)}`;
}

/** Ora di parete `HH:MM`, per la presentazione. */
export function oraCivile(istante: Date, fuso: string = FUSO_APP): string {
	const l = partiLocali(istante, fuso);
	return `${dueCifre(l.ora)}:${dueCifre(l.minuto)}`;
}

/** Fine dell'evento, esplicita o assunta a +4h. */
export function fineEffettiva(startsAt: Date, endsAt: Date | null): Date {
	return endsAt ?? new Date(startsAt.getTime() + DURATA_PREDEFINITA_MS);
}

/**
 * Giorni civili di distanza fra due istanti, sempre positivo.
 *
 * È la misura su cui poggia la regola R2 del motore conflitti (ADR-0021), e
 * va calcolata **fra giorni civili**, non dividendo la differenza di
 * millisecondi per 86.400.000: le due domeniche del cambio d'ora durano 23 e
 * 25 ore, e con la divisione un sabato e la domenica successiva
 * risulterebbero a 0 giorni di distanza invece che a 1.
 *
 * Si passa dai giorni civili in `Europe/Rome` a due mezzanotti UTC, che sono
 * distanti multipli esatti di 24 ore per costruzione.
 */
export function distanzaInGiorniCivili(a: Date, b: Date, fuso: string = FUSO_APP): number {
	const aUtc = mezzanotteUtcDelGiorno(giornoCivile(a, fuso));
	const bUtc = mezzanotteUtcDelGiorno(giornoCivile(b, fuso));
	return Math.abs(Math.round((aUtc - bUtc) / 86400000));
}

function mezzanotteUtcDelGiorno(giorno: string): number {
	const [anno, mese, giornoDelMese] = giorno.split('-').map(Number);
	return Date.UTC(anno, mese - 1, giornoDelMese);
}
