import { realpathSync } from 'node:fs';
import { controllaCartella } from './scripts/controlla-cartella.mjs';
import { versioneCorrente } from './scripts/versione.mjs';
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
 * Ci si ferma subito se si sta lavorando dal nome localizzato della cartella.
 *
 * Il perché sta per esteso in `scripts/controlla-cartella.mjs`, insieme alla
 * storia del tentativo precedente — un `process.chdir()` proprio qui, che
 * spostava la radice troppo tardi e produceva un artefatto rotto invece di un
 * errore.
 */
controllaCartella();

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
	/**
	 * La versione viene murata nell'artefatto al momento della build.
	 *
	 * È l'unico modo perché l'applicazione in esecuzione sappia da quale commit
	 * proviene: a runtime non c'è nessun repository da interrogare, il Worker è
	 * un bundle. Da qui esce in due posti — il piè di pagina e `/api/version` —
	 * e serve a legare una segnalazione a un punto preciso della storia
	 * (ADR-0046).
	 *
	 * `define` è una sostituzione testuale, quindi il nome deve essere
	 * impossibile da incontrare per caso: di qui le due sottolineature.
	 */
	define: {
		__VERSIONE__: JSON.stringify(versioneCorrente())
	},
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
					'@fullcalendar/core/internal',
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
