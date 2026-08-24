/**
 * Configurazione degli smoke test (ARCHITECTURE.md §15).
 *
 * Tre note che spiegano quasi tutto il file.
 *
 * **Un worker solo, niente parallelismo.** I test condividono un database
 * vero: due che inseriscono la stessa data nella stessa sera si darebbero
 * fastidio a vicenda, e il motore conflitti troverebbe conflitti che non
 * appartengono a nessuno dei due.
 *
 * **Un progetto di preparazione e uno di pulizia.** Il secondo è dichiarato
 * come `teardown` del primo, quindi gira anche quando i test falliscono: la
 * pulizia dopo un fallimento è proprio quella che serve di più.
 *
 * **`reuseExistingServer`.** In locale il dev server è quasi sempre già
 * acceso; in CI non lo è mai, e Playwright lo avvia da sé.
 */
import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
	testDir: 'tests/e2e',
	// Un flusso completo con login, salvataggio e ricalcolo dei conflitti non
	// sta in trenta secondi su un database remoto.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	// In CI un `test.only` dimenticato non deve far passare una suite dimezzata.
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['list']] : [['list']],

	use: {
		baseURL,
		locale: 'it-IT',
		// Il prodotto ragiona in `Europe/Rome` (§16). Un browser su un altro
		// fuso trasformerebbe ogni asserzione sugli orari in un rompicapo.
		timezoneId: 'Europe/Rome',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},

	projects: [
		{
			name: 'prepara',
			testMatch: /prepara\.setup\.ts/,
			teardown: 'pulisci'
		},
		{
			name: 'pulisci',
			testMatch: /pulisci\.teardown\.ts/
		},
		{
			name: 'smoke',
			testMatch: /.*\.spec\.ts/,
			dependencies: ['prepara'],
			use: { ...devices['Desktop Chrome'] }
		}
	],

	webServer: {
		command: 'npm run dev',
		url: baseURL,
		reuseExistingServer: true,
		timeout: 120_000,
		stdout: 'ignore',
		stderr: 'pipe'
	}
});
