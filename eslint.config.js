import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	},
	{
		// Componenti generati da `shadcn-svelte add`: sono codice vendorizzato,
		// generico per costruzione. Un `<a href>` che accetta qualunque valore è
		// il loro contratto, non una svista, e la regola non può saperlo.
		files: ['src/lib/components/ui/**'],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'.wrangler/',
			'node_modules/',
			'src/lib/server/db/migrations/'
		]
	}
);
