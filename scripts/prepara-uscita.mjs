/**
 * Toglie di mezzo `.svelte-kit/cloudflare` **prima** che ci provi l'adapter.
 *
 * L'adapter Cloudflare comincia rimuovendo la propria cartella di uscita, e su
 * Windows quella rimozione fallisce con `EPERM` quando qualcuno sta guardando
 * `.svelte-kit`: il dev server acceso, o l'editor che indicizza i file appena
 * scritti. Non è un guasto del progetto ed è transitorio — al secondo tentativo
 * di solito passa — ma arriva **in fondo**, dopo la build intera, ed è
 * esattamente il punto in cui costa di più: dentro `npm run rilascia` succede
 * dopo i controlli, dopo gli smoke test e dopo che il tag è già stato creato.
 *
 * La differenza qui è una sola: `rmSync` di Node ha `maxRetries` e `retryDelay`
 * proprio per questa condizione, e SvelteKit non li passa. Riprovando per un
 * secondo la cartella si libera; se non si libera, ci si ferma **prima** della
 * build invece che dopo, e si perdono due secondi invece di due minuti.
 *
 * Se la cartella non esiste non c'è niente da fare: `force: true` non solleva,
 * e la rimozione dell'adapter su un percorso che non c'è è un'operazione nulla.
 */
import { rmSync } from 'node:fs';

const USCITA = '.svelte-kit/cloudflare';

try {
	rmSync(USCITA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
} catch (err) {
	console.error(
		[
			'',
			`Non si riesce a rimuovere ${USCITA}:`,
			'',
			`  ${err instanceof Error ? err.message : err}`,
			'',
			'Su Windows una cartella osservata non si cancella. I due sospetti, in',
			"quest'ordine: il dev server acceso (`npm run dev`), e l'editor con il",
			'progetto aperto.',
			'',
			'Chiudi il primo, o riprova fra qualche secondo: il secondo caso passa',
			'da sé.',
			''
		].join('\n')
	);
	process.exit(1);
}
