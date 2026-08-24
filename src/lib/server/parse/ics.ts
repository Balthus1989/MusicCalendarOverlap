/**
 * Lettura deterministica di un `.ics` (ARCHITECTURE.md §9).
 *
 * «Accetta anche l'incolla di un file `.ics` o di un CSV: parsing
 * deterministico, nessun LLM coinvolto. **Da preferire quando la fonte lo
 * permette.**» Questo modulo è quel "da preferire": se l'incollato è un
 * calendario, non c'è niente da indovinare e nessun motivo di far leggere a un
 * modello un file che ha già i campi separati.
 *
 * Codice puro, senza I/O, come il motore conflitti e il costruttore ICS:
 * entra una stringa, esce un `BersaglioParse`. È l'unico modo di coprire con
 * un test i casi che contano, che qui sono i fusi e le giornate intere.
 *
 * Non è un'implementazione completa di RFC 5545 e non prova a esserlo: legge
 * ciò che i calendari veri scrivono in un `VEVENT` e ignora il resto —
 * ricorrenze, allarmi, partecipanti. Una ricorrenza non è una serata.
 */
import { bersaglioVuoto, type BersaglioParse } from '$lib/schemas/parse';
import { aLocaleInput, daLocaleAIstante, FUSO_APP } from '$lib/time';

export type EsitoIcs = {
	bersaglio: BersaglioParse;
	/** Quante `VEVENT` conteneva il file: se ne usa una sola (ADR-0033). */
	totaleEventi: number;
};

/* ------------------------------------------------------------------ *
 * Struttura del file
 * ------------------------------------------------------------------ */

type Riga = {
	nome: string;
	parametri: Record<string, string>;
	valore: string;
};

/**
 * Ricompone le righe spezzate.
 *
 * RFC 5545 impone di non superare i 75 ottetti per riga e di continuare la
 * successiva iniziandola con uno spazio o una tabulazione. Chi scrive gli
 * `.ics` lo rispetta sul serio, quindi una `DESCRIPTION` con la lineup dentro
 * arriva quasi sempre spezzata in cinque pezzi: senza questo passaggio si
 * leggerebbe solo il primo, e non se ne accorgerebbe nessuno perché il
 * risultato *sembra* un titolo.
 */
export function srotola(testo: string): string[] {
	const grezze = testo.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	const righe: string[] = [];

	for (const riga of grezze) {
		if ((riga.startsWith(' ') || riga.startsWith('\t')) && righe.length) {
			righe[righe.length - 1] += riga.slice(1);
		} else {
			righe.push(riga);
		}
	}

	return righe.filter((r) => r.trim() !== '');
}

/**
 * `DTSTART;TZID=Europe/Rome:20261012T220000` nelle sue tre parti.
 *
 * I due punti che separano il valore vanno cercati **fuori dalle virgolette**:
 * un `TZID="GMT+01:00"` fra apici ne contiene uno, e tagliare sul primo che si
 * incontra spezzerebbe il parametro invece del valore.
 */
export function leggiRiga(riga: string): Riga | null {
	let fraApici = false;
	let taglio = -1;

	for (let i = 0; i < riga.length; i++) {
		const c = riga[i];
		if (c === '"') fraApici = !fraApici;
		else if (c === ':' && !fraApici) {
			taglio = i;
			break;
		}
	}
	if (taglio < 0) return null;

	const testa = riga.slice(0, taglio);
	const valore = riga.slice(taglio + 1);
	const pezzi = testa.split(';');
	const nome = pezzi[0].trim().toUpperCase();
	if (!nome) return null;

	const parametri: Record<string, string> = {};
	for (const p of pezzi.slice(1)) {
		const uguale = p.indexOf('=');
		if (uguale < 0) continue;
		parametri[p.slice(0, uguale).trim().toUpperCase()] = p
			.slice(uguale + 1)
			.trim()
			.replace(/^"|"$/g, '');
	}

	return { nome, parametri, valore };
}

/**
 * Il testo di un valore `TEXT`, con le sequenze di escape sciolte.
 *
 * `\n` è quello che conta: è come viaggia ogni a-capo di una `DESCRIPTION`, e
 * senza scioglierlo la lineup arriva su una riga sola con delle `\n` dentro,
 * che poi finiscono nel form.
 */
export function sciogli(valore: string): string {
	return valore
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\')
		.trim();
}

/* ------------------------------------------------------------------ *
 * Istanti
 * ------------------------------------------------------------------ */

const FORMATO_DATA_ORA = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;
const FORMATO_DATA = /^(\d{4})(\d{2})(\d{2})$/;

type Istante =
	| { tipo: 'orario'; locale: string }
	| { tipo: 'giornata'; giorno: string }
	| { tipo: 'illeggibile' };

/**
 * Da un `DTSTART` all'orario di parete italiano che il form si aspetta.
 *
 * Le quattro forme che esistono davvero, e come si distinguono:
 *
 * | Nel file                                  | Che cos'è                | Cosa se ne fa                    |
 * | ----------------------------------------- | ------------------------ | -------------------------------- |
 * | `...T200000Z`                             | istante UTC              | si rende nel fuso italiano       |
 * | `;TZID=Europe/Rome:...T220000`            | parete in un fuso        | si converte da quel fuso al nostro |
 * | `...T220000` senza altro                  | parete "fluttuante"      | si prende alla lettera           |
 * | `;VALUE=DATE:20261012`                    | giornata intera          | resta un giorno senza ora        |
 *
 * Il terzo caso — l'ora fluttuante — si prende alla lettera **di proposito**:
 * significa "le dieci di sera, ovunque tu sia", e chi ha esportato quel file
 * intendeva le dieci di sera. Interpretarla come UTC la sposterebbe di due ore
 * in estate, che è precisamente il genere di errore che nessuno rilegge.
 */
export function istanteDa(riga: Riga): Istante {
	const valore = riga.valore.trim();

	if (riga.parametri.VALUE?.toUpperCase() === 'DATE' || FORMATO_DATA.test(valore)) {
		const g = FORMATO_DATA.exec(valore);
		return g ? { tipo: 'giornata', giorno: `${g[1]}-${g[2]}-${g[3]}` } : { tipo: 'illeggibile' };
	}

	const m = FORMATO_DATA_ORA.exec(valore);
	if (!m) return { tipo: 'illeggibile' };

	const parete = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
	const zulu = m[7] === 'Z';
	const tzid = riga.parametri.TZID;

	if (zulu) return { tipo: 'orario', locale: aLocaleInput(daLocaleAIstante(parete, 'UTC')) };

	if (tzid) {
		// Un `TZID` che `Intl` non conosce — le sigle Microsoft, per esempio,
		// che non sono nomi IANA — fa lanciare il formatter. Meglio prendere
		// l'ora alla lettera che perdere l'evento: la data e l'ora scritte nel
		// file restano la cosa più vicina al vero che abbiamo.
		try {
			return { tipo: 'orario', locale: aLocaleInput(daLocaleAIstante(parete, tzid), FUSO_APP) };
		} catch {
			return { tipo: 'orario', locale: parete };
		}
	}

	return { tipo: 'orario', locale: parete };
}

/* ------------------------------------------------------------------ *
 * Il luogo
 * ------------------------------------------------------------------ */

const CAP_CITTA = /\b(\d{5})\s+([^,]+?)(?:\s+\(?([A-Z]{2})\)?)?\s*$/;

export type LuogoIcs = {
	venueName: string | null;
	address: string | null;
	city: string | null;
	province: string | null;
};

/**
 * `LOCATION` è una stringa libera, e va sciolta a naso.
 *
 * La forma che scrivono quasi tutti — la nostra compresa — è «Nome del locale,
 * Via Tale 1, 06121 Perugia PG». Si tiene il primo pezzo come nome, si cerca
 * un CAP in coda e da lì si leggono città e provincia.
 *
 * Quando non si riconosce niente, **non si indovina**: il testo intero
 * diventa il nome del locale e la città resta vuota, così chi rivede il form
 * vede un campo obbligatorio da riempire invece di una città sbagliata che
 * sembra giusta.
 */
export function leggiLuogo(location: string): LuogoIcs {
	const pulito = location.trim();
	if (!pulito) return { venueName: null, address: null, city: null, province: null };

	const pezzi = pulito
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);

	const m = CAP_CITTA.exec(pulito);
	const city = m ? m[2].trim() : null;
	const province = m?.[3] ?? null;

	// Un `LOCATION` di un pezzo solo è il nome, non un indirizzo.
	if (pezzi.length <= 1) {
		return { venueName: pezzi[0] ?? pulito, address: null, city, province };
	}

	return {
		venueName: pezzi[0],
		address: pezzi.slice(1).join(', ') || null,
		city,
		province
	};
}

/* ------------------------------------------------------------------ *
 * Il VEVENT
 * ------------------------------------------------------------------ */

function primoVevent(righe: Riga[]): { evento: Riga[]; totale: number } {
	const eventi: Riga[][] = [];
	let corrente: Riga[] | null = null;

	for (const r of righe) {
		if (r.nome === 'BEGIN' && r.valore.trim().toUpperCase() === 'VEVENT') corrente = [];
		else if (r.nome === 'END' && r.valore.trim().toUpperCase() === 'VEVENT') {
			if (corrente) eventi.push(corrente);
			corrente = null;
		} else if (corrente) corrente.push(r);
	}

	return { evento: eventi[0] ?? [], totale: eventi.length };
}

/** Riconosce un calendario prima ancora di provare a leggerlo. */
export function sembraIcs(testo: string): boolean {
	return /^BEGIN:VCALENDAR\s*$/im.test(testo.replace(/\r\n/g, '\n'));
}

/**
 * Legge il primo `VEVENT` del file.
 *
 * **Uno solo, sempre**, anche quando il file ne contiene quaranta: l'import
 * assistito riempie un form, e un form è una data. Il conteggio torna al
 * chiamante perché va detto — un file con dieci date di cui ne compare una,
 * senza spiegazione, si legge come un parser rotto (ADR-0033).
 */
export function leggiIcs(testo: string): EsitoIcs {
	const righe = srotola(testo)
		.map(leggiRiga)
		.filter((r): r is Riga => r !== null);

	const { evento, totale } = primoVevent(righe);
	const b = bersaglioVuoto();
	if (!evento.length) {
		b.incerti.push('Il file non contiene nessun evento leggibile.');
		return { bersaglio: b, totaleEventi: 0 };
	}

	const primo = (nome: string) => evento.find((r) => r.nome === nome) ?? null;
	const testo1 = (nome: string) => {
		const r = primo(nome);
		return r ? sciogli(r.valore) || null : null;
	};

	b.title = testo1('SUMMARY');
	b.description = testo1('DESCRIPTION');
	b.externalUrl = testo1('URL');

	const location = testo1('LOCATION');
	if (location) {
		const luogo = leggiLuogo(location);
		b.venueName = luogo.venueName;
		b.address = luogo.address;
		b.city = luogo.city;
		b.province = luogo.province;
		if (!luogo.city) {
			b.incerti.push(
				`Il luogo dice «${location}», ma la città non si riconosce: va scritta a mano.`
			);
		}
	}

	// `CATEGORIES` può comparire più volte, e ogni riga è una lista.
	for (const r of evento.filter((x) => x.nome === 'CATEGORIES')) {
		for (const g of sciogli(r.valore).split(',')) {
			const nome = g.trim();
			if (nome && !b.genres.includes(nome)) b.genres.push(nome);
		}
	}

	const inizio = primo('DTSTART');
	const fine = primo('DTEND');

	if (!inizio) {
		b.incerti.push("L'evento non ha una data di inizio: va scritta a mano.");
	} else {
		const i = istanteDa(inizio);
		if (i.tipo === 'orario') b.startsAtLocal = i.locale;
		else if (i.tipo === 'giornata') {
			// Una giornata intera non ha un'ora, e inventarne una plausibile
			// sarebbe scriverla nel form come se il file l'avesse detta. Si
			// tiene il giorno giusto con un'ora palesemente da mettere, e lo si
			// dice: mezzanotte in un form di concerti non la scambia nessuno
			// per l'ora vera.
			b.startsAtLocal = `${i.giorno}T00:00`;
			b.incerti.push(
				'Il file dava una giornata intera, senza orario: l’ora è da mettere (adesso è mezzanotte).'
			);
		} else {
			b.incerti.push(`Data di inizio illeggibile: «${inizio.valore}».`);
		}
	}

	if (fine) {
		const f = istanteDa(fine);
		if (f.tipo === 'orario') b.endsAtLocal = f.locale;
		// Su una giornata intera `DTEND` è **esclusivo**: vale il giorno dopo.
		// Usarlo come orario di fine allungherebbe ogni concerto di un giorno,
		// ed è lo scivolone classico di chi legge un ICS. Si scarta.
		else if (f.tipo === 'giornata') {
			b.incerti.push('La fine indicata nel file vale l’intera giornata: non è stata riportata.');
		}
	}

	return { bersaglio: b, totaleEventi: totale };
}
