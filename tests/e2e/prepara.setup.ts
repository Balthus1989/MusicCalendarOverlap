/**
 * Preparazione degli smoke test.
 *
 * Fa due cose, e l'ordine fra le due non è negoziabile: prima **entra** con i
 * due utenti di prova, poi semina i dati. Il profilo applicativo nasce al primo
 * accesso (`ensureProfile`), quindi prima del login non c'è nessuna riga
 * `profiles` a cui agganciare una membership.
 *
 * Il login passa dalla porta vera: un `token_hash` generato con il ruolo di
 * servizio e appeso a `/auth/callback`, che è esattamente ciò che finisce nel
 * magic link. Nessun cookie iniettato a mano — se il flusso di accesso si
 * rompe, questi test se ne accorgono invece di aggirarlo.
 */
import { expect, test as setup } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
	ALFA,
	BETA,
	apriAdmin,
	apriDb,
	assicuraUtente,
	FILE_AMBIENTE,
	seminaAmbiente,
	tokenDiAccesso
} from './dati.ts';

setup('prepara utenti, sessioni e dati', async ({ browser }) => {
	setup.setTimeout(120_000);

	const admin = apriAdmin();
	const { sql, db } = apriDb();

	try {
		mkdirSync('tests/e2e/.auth', { recursive: true });

		for (const chi of [ALFA, BETA]) {
			await assicuraUtente(admin, chi.email, chi.nome);

			const contesto = await browser.newContext();
			const pagina = await contesto.newPage();

			const token = await tokenDiAccesso(admin, chi.email);
			await pagina.goto(`/auth/callback?token_hash=${token}&type=magiclink`);

			// Al primo accesso il profilo non appartiene a nessuna organizzazione
			// e il layout manda all'onboarding: è un atterraggio legittimo, e
			// significa comunque che la sessione c'è. Basta non essere rimasti
			// sul login.
			await expect(pagina).not.toHaveURL(/\/login/);

			await contesto.storageState({ path: chi.statoFile });
			await contesto.close();
		}

		const ambiente = await seminaAmbiente(db);
		// Gli id finiscono in un file: i test hanno bisogno di quello della data
		// di Beta per aprirla, e ricavarlo navigando sarebbe un giro di prove
		// dentro una preparazione.
		writeFileSync(FILE_AMBIENTE, JSON.stringify(ambiente, null, '	'));
		console.log(
			`Ambiente pronto: la sera del ${ambiente.giorno}, con la data di Beta già confermata.`
		);
	} finally {
		await sql.end({ timeout: 5 }).catch(() => {});
	}
});
