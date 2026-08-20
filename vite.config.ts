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
		host: true
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
