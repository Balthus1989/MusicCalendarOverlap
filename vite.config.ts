import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

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
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node'
	}
});
