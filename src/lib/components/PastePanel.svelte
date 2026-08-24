<script lang="ts">
	/**
	 * Il pannello dell'incolla (ARCHITECTURE.md §9, Fase 5).
	 *
	 * Sta **sopra** il form della data, non in una pagina a parte: il
	 * risultato dell'incolla è un form pre-compilato da rivedere, e mettere
	 * fra le due cose un cambio di pagina significherebbe portarsi dietro
	 * trenta campi in una sessione o in un querystring, per separare due
	 * momenti che sono lo stesso momento.
	 *
	 * Non salva niente. Chiede al server di leggere il testo, riceve dei
	 * valori, li consegna al form. La data la crea una persona, premendo il
	 * pulsante che c'era anche prima (ADR-0031).
	 *
	 * Il testo incollato non viene mai svuotato dopo un'estrazione: se il
	 * risultato è sbagliato, la prima cosa che serve è rileggere che cosa si
	 * era incollato, non ricopiarlo.
	 */
	import { Button } from '$lib/components/ui/button';
	import { comeLetto, etichettaCampo, type EsitoImport } from '$lib/parse';

	type Props = {
		organizationId: string;
		/** Chiamato quando l'estrazione è riuscita: il form si ricostruisce. */
		onEsito: (esito: EsitoImport) => void;
		/** Falso quando manca `LLM_API_KEY`: il testo libero non si può leggere. */
		llmDisponibile?: boolean;
	};

	let { organizationId, onEsito, llmDisponibile = true }: Props = $props();

	let aperto = $state(false);
	let testo = $state('');
	let inCorso = $state(false);
	let errore = $state<string | null>(null);
	let ultimo = $state<EsitoImport | null>(null);

	async function analizza() {
		if (!testo.trim() || inCorso) return;

		inCorso = true;
		errore = null;

		try {
			const dati = new FormData();
			dati.set('testo', testo);
			dati.set('organizationId', organizationId);

			const risposta = await fetch('/api/parse', { method: 'POST', body: dati });
			if (!risposta.ok) {
				errore = 'Il riconoscimento non ha risposto. Puoi compilare il form a mano.';
				return;
			}

			const esito: EsitoImport = await risposta.json();
			if (esito.errore) {
				// Il form resta com'era: un errore non deve anche svuotare i
				// campi che c'erano.
				errore = esito.errore;
				ultimo = null;
				return;
			}

			ultimo = esito;
			onEsito(esito);
		} catch {
			// Degradazione elegante (principio 5): il parser è una comodità,
			// l'inserimento manuale è il prodotto.
			errore = 'Non è stato possibile contattare il server. Puoi compilare il form a mano.';
		} finally {
			inCorso = false;
		}
	}

	const campiLeggibili = $derived(
		[...new Set((ultimo?.compilati ?? []).map(etichettaCampo))].join(', ')
	);

	/** Gli a-capo in un `placeholder` servono un attributo, non del testo. */
	const ESEMPIO = [
		'Esempio:',
		'',
		'SABATO 12 OTTOBRE',
		'BASSA MAREA + NERO SABBIA',
		'Circolo Arci Lupo Bianco, Perugia',
		'Porte 21:00 · inizio 22:00 · ingresso 8€'
	].join('\n');
</script>

<section class="border-border mb-6 rounded-lg border">
	<button
		type="button"
		onclick={() => (aperto = !aperto)}
		aria-expanded={aperto}
		class="flex w-full items-center justify-between px-4 py-3 text-left"
	>
		<span class="text-sm font-medium">Hai già il testo dell'annuncio? Incollalo qui</span>
		<span class="text-muted-foreground text-xs">{aperto ? 'Chiudi' : 'Apri'}</span>
	</button>

	{#if aperto}
		<div class="border-border space-y-3 border-t p-4">
			<p class="text-muted-foreground text-sm">
				Incolla il testo di un post, oppure il contenuto di un file <code>.ics</code> o di un CSV. I
				campi che si riconoscono finiscono nel form qui sotto, dove li rivedi prima di salvare:
				<strong>niente viene creato da solo.</strong>
			</p>

			{#if !llmDisponibile}
				<p class="text-muted-foreground text-xs">
					Il riconoscimento del testo libero non è configurato su questo server. I file di
					calendario e le tabelle si leggono lo stesso: non passano da nessun modello.
				</p>
			{/if}

			<label class="sr-only" for="incolla">Testo da riconoscere</label>
			<textarea
				id="incolla"
				bind:value={testo}
				rows="8"
				placeholder={ESEMPIO}
				class="border-input bg-background ring-ring/40 w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
			></textarea>

			<div class="flex items-center gap-3">
				<Button type="button" onclick={analizza} disabled={inCorso || !testo.trim()}>
					{inCorso ? 'Leggo…' : 'Compila il form'}
				</Button>
				{#if testo.trim()}
					<button
						type="button"
						onclick={() => {
							testo = '';
							ultimo = null;
							errore = null;
						}}
						class="text-muted-foreground text-sm underline underline-offset-4"
					>
						Svuota
					</button>
				{/if}
			</div>

			{#if errore}
				<p class="text-destructive text-sm" role="alert">{errore}</p>
			{/if}

			{#if ultimo}
				<div class="border-border bg-muted/40 space-y-2 rounded-md border p-3 text-sm">
					<p class="text-muted-foreground text-xs">{comeLetto(ultimo.sorgente)}</p>

					{#if campiLeggibili}
						<p><strong>Compilati:</strong> {campiLeggibili}.</p>
					{/if}

					<!-- Gli avvisi sono la parte che serve davvero. Un campo lasciato
					     vuoto senza dirlo si legge come «nel testo non c'era», e chi
					     rivede non va a ricontrollare. -->
					{#if ultimo.avvisi.length}
						<div>
							<p class="font-medium">Da controllare:</p>
							<ul class="text-muted-foreground list-disc space-y-0.5 pl-5">
								{#each ultimo.avvisi as avviso (avviso)}
									<li>{avviso}</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if ultimo.proposte.length}
						<p class="text-muted-foreground text-xs">
							{ultimo.proposte.length === 1 ? 'Una band' : `${ultimo.proposte.length} band`} potrebbe
							corrispondere a una scheda dell'anagrafica: la proposta è accanto alla riga, in fondo al
							form.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</section>
