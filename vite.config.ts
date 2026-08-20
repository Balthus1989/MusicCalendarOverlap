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
		fs: { allow: cartelleConsentite }
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node'
	}
});
