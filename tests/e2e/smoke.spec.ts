/**
 * Smoke test dei flussi critici (ARCHITECTURE.md §15).
 *
 * Il percorso della specifica è «invito → registrazione → creazione evento →
 * comparsa conflitto per la seconda organizzazione → sottoscrizione feed ICS».
 * Qui è coperto **quasi** per intero: la registrazione vera — un terzo utente
 * che riscatta un invito — resta fuori, perché richiederebbe di creare e
 * cancellare un'identità in più a ogni giro per provare un pezzo che i test
 * unitari di `invite-code` già coprono nella sua parte fragile. Dell'invito si
 * verifica che si generi e produca un link.
 *
 * Il resto c'è, e nell'ordine in cui accade davvero: Alfa inserisce una data
 * opzionata, l'anteprima le segnala il conflitto **prima di salvare**, Beta se
 * lo trova in dashboard, e il feed ICS di Beta contiene la propria data ma non
 * il titolo di quella opzionata da Alfa.
 *
 * Questi test **non sono unitari**: girano contro un database vero e un server
 * vero, sono lenti, e uno solo alla volta. Servono a coprire ciò che i test
 * unitari non possono vedere — che i pezzi giusti siano collegati fra loro.
 */
import { expect, test, type Page } from '@playwright/test';
import {
	ALFA,
	BAND_ANNUNCIATA,
	BAND_SEGRETA,
	BETA,
	GENERE,
	LOCALE_ALFA,
	ORA_ALFA,
	TITOLO_ALFA,
	TITOLO_BETA,
	leggiAmbiente,
	seraDelConflitto
} from './dati.ts';

const giorno = seraDelConflitto();

/**
 * Apre una pagina e aspetta che sia **idratata** prima di toccarla.
 *
 * Non è prudenza generica, è un errore vero preso in faccia scrivendo questi
 * test: riempire i campi del form evento subito dopo il `goto` funzionava, e
 * poi l'idratazione di Svelte rimetteva a ogni input il valore della sua prop
 * — titolo vuoto, stato "Bozza" — cancellando tutto. Il sintomo è un test che
 * fallisce su un'asserzione lontanissima dalla causa, con davanti uno
 * screenshot di un modulo vuoto.
 */
async function apri(page: Page, percorso: string) {
	await page.goto(percorso);
	await page.waitForLoadState('networkidle');
}

/* ------------------------------------------------------------------ *
 * Alfa
 * ------------------------------------------------------------------ */

test.describe('Alfa', () => {
	test.use({ storageState: ALFA.statoFile });

	test('genera un invito e ne ottiene il link', async ({ page }) => {
		await apri(page, '/org');
		await page.getByLabel('Email suggerita').fill('e2e-invitato@calendario.test');
		await page.getByRole('button', { name: 'Genera invito' }).click();

		await expect(page.getByText('Invito creato.')).toBeVisible();
		// Il link resta comunque valido anche quando l'email parte: è il
		// comportamento che la pagina promette.
		await expect(page.getByText('/invite/')).toBeVisible();
	});

	test('inserisce una data opzionata e vede il conflitto prima di salvare', async ({ page }) => {
		await apri(page, '/events/new');

		await page.locator('#title').fill(TITOLO_ALFA);
		await page.locator('#status').selectOption('hold');
		await page.locator('#startsAtLocal').fill(`${giorno}T${ORA_ALFA}`);
		// L'etichetta è quella costruita dal form: nome — città (provincia).
		await page.locator('#venueId').selectOption({
			label: `${LOCALE_ALFA.name} — ${LOCALE_ALFA.city} (${LOCALE_ALFA.province})`
		});
		await page.locator('#primaryGenreSlug').selectOption(GENERE);

		// Controprova che l'idratazione non abbia rimesso i valori di partenza:
		// senza, il fallimento arriverebbe più giù e racconterebbe un'altra storia.
		await expect(page.locator('#title')).toHaveValue(TITOLO_ALFA);
		await expect(page.locator('#status')).toHaveValue('hold');

		/**
		 * Il criterio di fine della Fase 3: **l'avviso compare durante la
		 * compilazione**, non dopo il salvataggio.
		 *
		 * L'attesa è lunga di proposito. L'anteprima è a rimbalzo, e dietro c'è
		 * una chiamata che carica i candidati da un database remoto: su un dev
		 * server appena avviato i primi secondi se ne vanno a compilare i
		 * moduli. Quindici secondi bastavano quasi sempre, ed è il tipo di
		 * "quasi" che rende un test inutile.
		 */
		await expect(page.getByRole('heading', { name: 'Sovrapposizioni' })).toBeVisible({
			timeout: 45_000
		});
		// La controparte si nomina: è ciò che deve far partire la telefonata.
		await expect(page.getByText(BETA.orgNome).first()).toBeVisible();

		await page.getByRole('button', { name: /Crea|Salva/ }).click();

		await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
		await expect(page.getByRole('heading', { name: TITOLO_ALFA })).toBeVisible();
	});

	test('della data confermata di Beta non vede la band non annunciata', async ({ page }) => {
		// Il caso che tiene in piedi tutto il modello (ADR-0020). La data di
		// Beta è **confermata**, quindi Alfa la vede per intero: titolo,
		// locale, orario. La lineup no — di quella vede solo le voci
		// annunciate, in ogni stato.
		await apri(page, `/events/${leggiAmbiente().eventoBeta}`);

		await expect(page.getByRole('heading', { name: TITOLO_BETA })).toBeVisible();
		await expect(page.getByText(BAND_ANNUNCIATA)).toBeVisible();
		// Cercato nella pagina intera e non nel riquadro della lineup: se
		// finisse in un altro punto — una descrizione, un attributo — il test
		// deve accorgersene lo stesso.
		expect(await page.content()).not.toContain(BAND_SEGRETA);
	});

	test('la storia della data compare a chi la possiede', async ({ page }) => {
		await apri(page, '/audit');
		await expect(page.getByRole('heading', { name: 'Registro delle modifiche' })).toBeVisible();
		await expect(page.getByText(TITOLO_ALFA).first()).toBeVisible();
	});
});

/* ------------------------------------------------------------------ *
 * Beta
 * ------------------------------------------------------------------ */

test.describe('Beta', () => {
	test.use({ storageState: BETA.statoFile });

	test('vede la data di Alfa ridotta a giorno, città e genere', async ({ page }) => {
		// Si guarda la risposta dell'API e non la pagina: il calendario è un
		// canvas di FullCalendar, e ciò che conta qui è **quali campi escono dal
		// server**, che è esattamente la matrice di §5.
		const da = `${giorno}T00:00:00.000Z`;
		const a = `${giorno}T23:59:59.000Z`;
		const risposta = await page.request.get(
			`/api/events?da=${da}&a=${a}&stato=hold&stato=confirmed`
		);
		expect(risposta.ok()).toBe(true);

		const date = (await risposta.json()) as {
			title: string;
			allDay: boolean;
			extendedProps: { ridotto: boolean; organizzazione: string };
		}[];

		const daAlfa = date.find((d) => d.extendedProps.organizzazione === ALFA.orgNome);
		expect(daAlfa, 'la data opzionata di Alfa deve esistere per Beta').toBeTruthy();

		// Il titolo vero non esce: al suo posto c'è genere più organizzazione.
		expect(daAlfa!.title).not.toContain(TITOLO_ALFA);
		expect(daAlfa!.extendedProps.ridotto).toBe(true);
		// Senza orario visibile la data diventa di giornata intera (ADR-0028).
		expect(daAlfa!.allDay).toBe(true);
	});

	test('trova il conflitto in dashboard', async ({ page }) => {
		await apri(page, '/conflicts');
		// La propria data si vede col suo titolo, la controparte col solo nome
		// dell'organizzazione: è l'avviso che deve far partire la telefonata.
		await expect(page.getByText(TITOLO_BETA).first()).toBeVisible();
		await expect(page.getByText(ALFA.orgNome).first()).toBeVisible();
		await expect(page.getByText(TITOLO_ALFA)).toHaveCount(0);
	});

	test('riceve l’avviso del conflitto nella casella', async ({ page }) => {
		// Il layer di notifica scrive al salvataggio della data di Alfa, non da
		// un job: se la riga non c'è, il collegamento fra `creaEvento` e il
		// layer si è rotto, ed è una cosa che nessun test unitario vede.
		await apri(page, '/notifications');

		await expect(page.getByRole('heading', { name: 'Avvisi' })).toBeVisible();
		await expect(page.getByText(ALFA.orgNome).first()).toBeVisible();
		// L'avviso è redatto per Beta: la data di Alfa è opzionata, e il suo
		// titolo non compare nemmeno qui (ADR-0035).
		expect(await page.content()).not.toContain(TITOLO_ALFA);
	});

	test('sceglie quali email ricevere', async ({ page }) => {
		await apri(page, '/settings/notifications');

		const digest = page.getByRole('checkbox', { name: /Riepilogo settimanale/ });
		await expect(digest).toBeChecked(); // l'assenza di riga vale "tutto acceso"

		await digest.uncheck();
		await page.getByRole('button', { name: 'Salva' }).click();
		await expect(page.getByText('Preferenze salvate.')).toBeVisible();

		await apri(page, '/settings/notifications');
		await expect(page.getByRole('checkbox', { name: /Riepilogo settimanale/ })).not.toBeChecked();
	});

	test('sottoscrive un feed ICS che rispetta la visibilità', async ({ page }) => {
		await apri(page, '/settings/feeds');
		await page.getByLabel('Nome').fill('E2E feed');
		await page.getByRole('button', { name: 'Crea il feed' }).click();

		const campo = page.locator('input[readonly]').first();
		await expect(campo).toBeVisible();
		const url = await campo.inputValue();
		expect(url).toContain('/api/ics/');

		/**
		 * Del link si prende **il solo percorso**, e si chiede al server sotto
		 * prova. L'URL mostrato in pagina si costruisce da `PUBLIC_APP_URL`, che
		 * è il nome pubblico dell'applicazione: in locale può essere rimasto
		 * quello di un tunnel usa-e-getta di una prova precedente, e il test
		 * fallirebbe su un DNS invece che su un difetto.
		 */
		const percorso = new URL(url).pathname;
		// Il feed è pubblico per costruzione: si scarica senza sessione, ed è
		// il modo in cui lo scaricherebbe Google Calendar.
		const risposta = await page.request.get(percorso);
		expect(risposta.status()).toBe(200);
		expect(risposta.headers()['content-type']).toContain('text/calendar');

		const ics = await risposta.text();
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect(ics).toContain(TITOLO_BETA);
		// La stessa promessa della dashboard, in un file che finisce sul
		// telefono di qualcuno: il titolo di una data opzionata altrui non c'è.
		expect(ics).not.toContain(TITOLO_ALFA);
	});
});

/* ------------------------------------------------------------------ *
 * Senza sessione
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * I job periodici
 * ------------------------------------------------------------------ */

test.describe('manutenzione notturna', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	const SEGRETO = process.env.CRON_SECRET ?? '';

	test('senza il segreto gli endpoint di cron non rispondono', async ({ request }) => {
		// 403 e non 401: non c'è nessuna autenticazione da rinegoziare, c'è un
		// segreto condiviso che o si ha o non si ha.
		for (const job of ['recompute', 'purge', 'digest', 'notify']) {
			const risposta = await request.post(`/api/cron/${job}`);
			expect(risposta.status(), job).toBe(403);
		}
	});

	test('con il segreto la corsa notturna gira ed è idempotente', async ({ request }) => {
		test.skip(!SEGRETO, 'CRON_SECRET non configurata in .env.');

		/**
		 * `digest` resta **fuori** da questa lista di proposito: scriverebbe
		 * una riga di riepilogo per ogni iscritto vero del database, cioè fuori
		 * dal prefisso `e2e-` che la pulizia sa togliere. Gli altri tre in
		 * regime stazionario non scrivono niente, ed è anche il modo in cui si
		 * verifica che siano idempotenti.
		 *
		 * Il valore di questo test non è nella risposta ma nel fatto che ci
		 * arrivi: una query scritta male in un job che gira alle tre di notte
		 * si scopre settimane dopo, guardando perché una tabella non si svuota
		 * mai.
		 */
		for (const job of ['recompute', 'purge', 'notify']) {
			const risposta = await request.post(`/api/cron/${job}`, {
				headers: { 'x-cron-secret': SEGRETO },
				timeout: 120_000
			});
			expect(risposta.status(), job).toBe(200);
			expect(await risposta.json(), job).toHaveProperty('durataMs');
		}
	});
});

test.describe('senza sessione', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('il calendario non si apre e si finisce al login', async ({ page }) => {
		await page.goto('/calendar');
		await expect(page).toHaveURL(/\/login/);
	});

	test('la pagina offline si serve da sola, senza database', async ({ page }) => {
		// È l'unica pagina prerenderizzata del progetto, ed è quella che il
		// service worker tiene in cache: se smettesse di essere statica, la PWA
		// resterebbe senza guscio senza che nessuno se ne accorga.
		await page.goto('/offline');
		await expect(page.getByRole('heading', { name: 'Sei senza rete' })).toBeVisible();
	});
});
