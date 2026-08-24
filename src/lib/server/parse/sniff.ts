/**
 * Da che cosa è fatto l'incollato.
 *
 * ARCHITECTURE.md §9 dice che il parsing deterministico è **da preferire
 * quando la fonte lo permette**. Perché quella preferenza valga qualcosa,
 * qualcuno deve accorgersi che la fonte lo permette: è questo modulo, ed è la
 * prima cosa che gira su ogni incolla. Se riconosce un calendario o una
 * tabella, il modello non viene chiamato affatto — niente chiave API, niente
 * latenza, niente da indovinare, e un risultato che si riproduce identico.
 *
 * **L'asimmetria delle due soglie è deliberata.** Sbagliare in un verso costa
 * una chiamata al modello che non serviva; sbagliare nell'altro significa far
 * leggere come una tabella un post di Facebook, e produrre in silenzio un form
 * pieno di spazzatura. Quindi: si dichiara `csv` solo davanti a intestazioni
 * che si riconoscono davvero, e nel dubbio si va di testo.
 */
import type { Sorgente } from '$lib/parse';
import { dividiCsv, intestazioniRiconosciute, separatoreProbabile } from './csv';
import { sembraIcs } from './ics';

export type { Sorgente };

/**
 * Quante colonne devono essere riconoscibili perché sia una tabella.
 *
 * Due, e devono essere due colonne **diverse**. Una sola non basta: la parola
 * "data" o "titolo" da sola compare in qualunque testo, e basterebbe una
 * locandina che comincia con «Data, luogo e orari» per far scattare la
 * lettura sbagliata.
 */
const COLONNE_MINIME = 2;

export function riconosciSorgente(testo: string): Sorgente {
	if (sembraIcs(testo)) return 'ics';

	const separatore = separatoreProbabile(testo);
	const righe = dividiCsv(testo, separatore);

	// Una tabella ha almeno un'intestazione e una riga di dati. Un file con la
	// sola intestazione non è un import, è un file vuoto — e mandarlo al
	// modello, che risponderà che non c'è niente, è la risposta giusta.
	if (righe.length < 2) return 'testo';
	if (intestazioniRiconosciute(righe[0]) < COLONNE_MINIME) return 'testo';

	// Un'intestazione plausibile su una riga lunghissima è un falso positivo:
	// nessun CSV ha una prima riga di duemila caratteri, un post sì.
	if (righe[0].join('').length > 500) return 'testo';

	return 'csv';
}
