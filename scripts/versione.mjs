/**
 * La versione che finisce **dentro l'artefatto**, e quindi in produzione.
 *
 * Serve a rispondere a una domanda sola, che prima non aveva risposta: guardando
 * l'applicazione online, quale codice c'è dentro? Un difetto segnalato da un
 * organizzatore vale poco se non si sa a quale commit riferirlo, e il numero in
 * `package.json` da solo non basta — dice a che punto è il rilascio, non se
 * quello che gira è davvero quello.
 *
 * Da qui esce una stringa come `0.7.0+5250817`, cioè il numero di rilascio più
 * il commit da cui la build è partita. Il suffisso `-modificato` compare quando
 * l'albero di lavoro non era pulito: `npm run rilascia` non lo permette, ma
 * `npm run deploy` da solo sì, e un artefatto che non corrisponde a nessun
 * commit è precisamente la cosa che questo file esiste per non lasciar passare
 * in silenzio.
 *
 * **Non solleva mai.** Se git non risponde — una copia del sorgente senza
 * repository, un container spoglio — resta il solo numero di `package.json`.
 * Fermare una build perché non si è potuto scrivere un'etichetta sarebbe il
 * contrario del principio 5 di ARCHITECTURE.md §2.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACCHETTO = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * `stderr` scartato di proposito: fuori da un repository git scrive
 * `not a git repository` sul terminale, che qui non è un errore da mostrare
 * ma la condizione normale del ramo di riserva.
 *
 * @param {...string} argomenti
 * @returns {string}
 */
function git(...argomenti) {
	return execFileSync('git', argomenti, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	}).trim();
}

export function versioneCorrente() {
	const { version } = JSON.parse(readFileSync(PACCHETTO, 'utf8'));

	try {
		const sha = git('rev-parse', '--short', 'HEAD');
		const sporco = git('status', '--porcelain') !== '';
		return `${version}+${sha}${sporco ? '-modificato' : ''}`;
	} catch {
		return version;
	}
}
