/**
 * Ferma build e deploy quando si lavora dalla cartella dal **nome localizzato**.
 *
 * Su Windows in italiano `C:\Users\<tu>\Documenti` è una giunzione di sistema
 * che punta a `C:\Users\<tu>\Documents`. Non è un alias innocuo: Windows le
 * mette una ACL che **nega l'elenco del contenuto**, e lascia solo la
 * traversata. Un percorso che ci passa dentro funziona per aprire un file e
 * fallisce appena qualcuno prova a leggere la directory.
 *
 * Le due facce che ha mostrato, in due punti diversi della catena:
 *
 * - `vite build` — le chiavi del manifest sono percorsi relativi alla radice.
 *   Con la radice a `Documenti` e i moduli sotto `Documents`, quel percorso
 *   risale con `../..` e non corrisponde a nessuna chiave:
 *   `Could not find file … in Vite manifest`;
 * - `wrangler deploy` — esbuild prova a leggere la cartella `../../Documenti`
 *   e prende `Accesso negato`.
 *
 * **Non si aggiusta dall'interno.** C'è stato un tentativo di `process.chdir()`
 * qui in `vite.config.ts`: sposta la radice, ma gli `import` dei moduli girano
 * prima e SvelteKit ha già letto la cwd vecchia. Il risultato era peggiore del
 * problema — una build che passa e produce un artefatto con dentro percorsi
 * illeggibili, cioè un guasto spostato più avanti, dove costa di più.
 *
 * Quindi si ferma subito e si dice come uscirne. Una riga di `cd`.
 *
 * Perché non capita a tutti: il `cd` di PowerShell conserva il nome con cui ti
 * sei spostato e lo passa ai processi figli; Git Bash consegna a Node il
 * percorso fisico. Stesso comando, stessa cartella, due esiti.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function controllaCartella() {
	const radice = process.cwd();

	let reale;
	try {
		reale = realpathSync(radice);
	} catch {
		// Se il percorso non si risolve non è questo il problema: si lascia
		// passare e si va a sbattere altrove, con un errore più pertinente.
		return;
	}

	if (radice === reale) return;

	throw new Error(
		[
			'',
			'Stai lavorando da un percorso che è un collegamento:',
			'',
			`  ${radice}`,
			'',
			'mentre la cartella vera è:',
			'',
			`  ${reale}`,
			'',
			'Su Windows la prima non si può elencare, solo attraversare: la build',
			'produce percorsi che poi wrangler non riesce a leggere, e il guasto',
			'salta fuori al deploy invece che adesso.',
			'',
			'Rilancia da lì:',
			'',
			`  cd ${reale}`,
			''
		].join('\n')
	);
}

/**
 * Eseguito direttamente (`node scripts/controlla-cartella.mjs`)? Serve a
 * `npm run deploy`, che non passa da Vite e quindi non ha altro modo di
 * accorgersene.
 *
 * Il confronto è fra **percorsi reali**, e non è pignoleria: la prima stesura
 * confrontava `import.meta.url` con `process.argv[1]`, ed è stata battuta
 * esattamente dall'alias che questo file esiste per segnalare. Node risolve il
 * primo alla cartella vera, mentre il secondo conserva il nome con cui l'hai
 * scritto: da `Documenti` i due non coincidevano mai e il controllo taceva —
 * che per un guard è il modo peggiore di essere sbagliato.
 */
function eseguitoDaRigaDiComando() {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (eseguitoDaRigaDiComando()) {
	try {
		controllaCartella();
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}
}
