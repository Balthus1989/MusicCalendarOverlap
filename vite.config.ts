import { realpathSync } from 'node:fs';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

/**
 * Su Windows le cartelle note hanno un nome localizzato: `C:/Users/x/Documenti`
 * e `C:/Users/x/Documents` sono **la stessa cartella**. Vite confronta i
 * percorsi della allow-list come stringhe, quindi avviando il dev server dal
 * nome localizzato ogni modulo generato in `.svelte-kit` risulta "outside of
 * Vite serving allow list" e la pagina non si carica.
 *
 * Autorizzare entrambe le forme rende indifferente da quale delle due si parte.
 */
const radice = process.cwd();
const radiceReale = (() => {
	try {
		return realpathSync(radice);
	} catch {
		return radice;
	}
})();
const cartelleConsentite = [...new Set([radice, radiceReale])];

/**
 * Se ci si trova nella cartella dal **nome localizzato**, ci si sposta su
 * quello vero prima che qualunque altra cosa legga `process.cwd()`.
 *
 * Non è la stessa cosa dell'allow-list qui sopra, che riguarda il dev server.
 * Questo riguarda la **build**, e il sintomo è tutt'altro:
 *
 *     Could not find file "../../Documents/.../node_modules/@sveltejs/kit/..."
 *     in Vite manifest
 *
 * SvelteKit costruisce le chiavi del manifest come percorsi **relativi alla
 * radice**. Con la radice a `Documenti` e i moduli risolti sotto `Documents`,
 * quel percorso relativo comincia a risalire con `../..` e non corrisponde più
 * a nessuna chiave. La build muore su un file che c'è.
 *
 * Perché non capita sempre: `cd` di PowerShell conserva il nome con cui ci si
 * è spostati, e lo passa così ai processi figli; Git Bash invece consegna a
 * Node il percorso fisico, quindi da lì la build passa. Lo stesso comando,
 * nella stessa cartella, con due esiti diversi a seconda della shell — che è
 * il motivo per cui vale la pena toglierlo di mezzo qui invece di scriverlo
 * solo nel runbook.
 *
 * `chdir` e non un `root` esplicito: SvelteKit calcola quei percorsi da
 * `process.cwd()`, e cambiare la radice di Vite lascerebbe il conto a metà.
 * La cartella di destinazione è comunque la stessa, quindi non si sposta
 * niente: cambia solo il nome con cui la si chiama.
 */
if (radice !== radiceReale) {
	process.chdir(radiceReale);
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// ADR-0002: deploy su Cloudflare Workers. La via di fuga documentata in
			// ARCHITECTURE.md §3 è adapter-vercel, senza toccare il codice applicativo.
			adapter: adapter()
		})
	],
	server: {
		fs: { allow: cartelleConsentite },
		// Su questa macchina `localhost` risolve in `::1`, e Vite di default si
		// lega **solo** a quello. Un browser che preferisce `127.0.0.1` non
		// trova nessuno in ascolto — e su Windows il SYN verso una porta
		// loopback IPv4 senza listener viene scartato invece che rifiutato:
		// niente errore, la scheda resta in caricamento per sempre.
		//
		// `host: true` mette il dev server in ascolto su entrambi gli stack, e
		// rende indifferente quale dei due indirizzi si apra. Comporta che il
		// server risponda anche agli altri dispositivi della rete locale:
		// accettabile per un server di sviluppo su una macchina personale, e
		// comodo per provare l'interfaccia dal telefono. Vale solo per
		// `vite dev`, non ha alcun effetto sul deploy.
		host: true,
		/**
		 * Il feed ICS è l'unica cosa di questo prodotto che **non si può
		 * provare da soli**: il criterio di fine della Fase 4 chiede che una
		 * sottoscrizione funzioni in Google Calendar, e i server di Google
		 * `localhost` non lo raggiungono. La prova si fa esponendo il dev
		 * server con un tunnel `cloudflared`, che assegna un nome sotto
		 * `trycloudflare.com`.
		 *
		 * Da Vite 6 il dev server **rifiuta** le richieste con un `Host` che
		 * non sia locale — difesa contro il DNS rebinding — e risponde
		 * `Blocked request. This host is not allowed.`. Verso il tunnel
		 * significa che Google riceverebbe quella riga invece del calendario,
		 * cioè un guasto che sembra un feed vuoto.
		 *
		 * Si autorizza il solo dominio dei tunnel usa-e-getta, non `true`: la
		 * differenza conta il giorno in cui questa riga resta qui e qualcuno
		 * apre il dev server su una rete che non controlla.
		 */
		allowedHosts: ['.trycloudflare.com']
	},
	environments: {
		client: {
			optimizeDeps: {
				// FullCalendar è importata da una sola pagina, `/calendar`, che è
				// anche la prima che si apre dopo il login. Senza questa
				// dichiarazione Vite scopre le quattro dipendenze solo al momento
				// di servirla: si ferma a ri-ottimizzarle e impone un reload
				// completo della pagina, proprio nell'istante meno opportuno.
				//
				// **Va dichiarata qui dentro, sotto `environments.client`, e non
				// in un `optimizeDeps` al livello principale.** In Vite 8 quello
				// vale per tutti gli ambienti, SSR compreso: ri-ottimizzando
				// l'SSR finisce nel pre-bundle anche `postgres`, e da lì la
				// connessione al database resta appesa per sempre. L'app risponde
				// su ogni pagina che non tocca il database e si blocca su tutte le
				// altre, senza un errore da nessuna parte.
				include: [
					'@fullcalendar/core',
					'@fullcalendar/core/locales/it',
					'@fullcalendar/daygrid',
					'@fullcalendar/timegrid',
					'@fullcalendar/list'
				]
			}
		}
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node'
	}
});
