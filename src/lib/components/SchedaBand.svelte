<script lang="ts">
	/**
	 * La scheda operativa di una band (ARCHITECTURE.md §4.7, ADR-0048/0049/0051).
	 *
	 * Il componente non decide **niente** su chi vede cosa: riceve una scheda già
	 * serializzata da `serializeArtistCard`, e le tre parole che non compaiono in
	 * questo file — organizzazione, chi, quando di preciso — non ci sono perché
	 * non arrivano fin qui.
	 *
	 * Due scelte di interfaccia che vale la pena non rimangiarsi:
	 * - sotto soglia si dice «non abbastanza osservazioni» e **non** quante ne
	 *   mancano, perché il numero mancante è già un'informazione sul conteggio;
	 * - non esiste nessun campo di testo libero, in nessuna forma (ADR-0050).
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		ETICHETTE_FASCE,
		ETICHETTE_FRESCHEZZA,
		ETICHETTE_INCLUDE,
		ETICHETTE_RUOLO,
		ETICHETTE_VOLUME,
		MESI_FINESTRA,
		OPZIONI_FASCIA,
		OPZIONI_INCLUDE,
		OPZIONI_VOLUME,
		type MiaOsservazione,
		type SchedaSerializzata
	} from '$lib/scheda';

	type Props = {
		scheda: SchedaSerializzata | null;
		nome: string;
		schedaSpenta: boolean;
		organizzazioni: { id: string; name: string }[];
		puoRiferire: boolean;
		puoSpegnere: boolean;
	};

	let { scheda, nome, schedaSpenta, organizzazioni, puoRiferire, puoSpegnere }: Props = $props();

	let apriRiferita = $state(false);
	const annoCorrente = new Date().getFullYear();

	const opzioniAnno = Array.from({ length: 3 }, (_, i) => {
		const anno = annoCorrente - i;
		return { value: String(anno), label: String(anno) };
	});

	const opzioniOrg = $derived(organizzazioni.map((o) => ({ value: o.id, label: o.name })));

	const cachet = $derived(scheda?.comune.cachet);
	const durata = $derived(scheda?.comune.durata);
	const volume = $derived(scheda?.comune.volume);
	const riferite = $derived(scheda?.comune.riferite);
	const dichiarati = $derived(scheda?.dichiarati);

	/** Una riga propria in una frase sola: fascia, minuti, volume, nell'ordine. */
	function riassunto(o: MiaOsservazione): string {
		const pezzi: string[] = [];
		if (o.fasciaCachet) {
			const incluso = o.cachetInclude ? `, ${ETICHETTE_INCLUDE[o.cachetInclude]}` : '';
			pezzi.push(`${ETICHETTE_FASCE[o.fasciaCachet]}${incluso}`);
		}
		if (o.durataSetMinuti !== null) pezzi.push(`${o.durataSetMinuti} minuti`);
		if (o.volumeOsservato) pezzi.push(ETICHETTE_VOLUME[o.volumeOsservato]);
		return pezzi.join(' · ');
	}

	function contesto(o: MiaOsservazione): string {
		if (o.origine === 'riferita') return `sentito dire · ${o.dataRiferimento.slice(0, 4)}`;
		const pezzi = [o.dataRiferimento];
		if (o.ruolo) pezzi.push(ETICHETTE_RUOLO[o.ruolo] ?? o.ruolo);
		if (o.capienzaVenue !== null) pezzi.push(`${o.capienzaVenue} posti`);
		return pezzi.join(' · ');
	}
</script>

<section class="border-border mt-10 border-t pt-8">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold">Scheda operativa</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				Quanto costa portarla, quanto spazio occupa, quanto suona.
			</p>
		</div>
		{#if puoSpegnere}
			<form method="POST" action="?/scheda" use:enhance>
				<input type="hidden" name="spenta" value={schedaSpenta ? '0' : '1'} />
				<Button type="submit" variant="ghost">
					{schedaSpenta ? 'Riaccendi la scheda' : 'Spegni su richiesta della band'}
				</Button>
			</form>
		{/if}
	</header>

	{#if schedaSpenta}
		<p class="border-border rounded-md border p-3 text-sm">
			<strong>{nome}</strong> ha chiesto di non avere una scheda operativa, e la richiesta vale per tutti.
			Il resto dell'anagrafica resta: serve a rilevare le sovrapposizioni, e non è ciò a cui si oppone
			chi si oppone.
		</p>

		<!-- L'art. 17 come pulsante e non come promessa, e solo qui: la
		     cancellazione è definitiva e tocca righe di altre organizzazioni,
		     quindi non deve stare a un clic da chi stava facendo altro. -->
		{#if puoSpegnere}
			<form method="POST" action="?/cancellaAnnotazioni" class="mt-3" use:enhance>
				<p class="text-muted-foreground mb-2 max-w-2xl text-xs">
					Spegnere ferma il trattamento e basta. Se la band ha chiesto anche la cancellazione,
					questo elimina definitivamente tutte le annotazioni, comprese quelle di altre
					organizzazioni.
				</p>
				<button
					type="submit"
					class="text-destructive text-xs underline underline-offset-4"
					onclick={(e) => {
						if (!confirm(`Cancellare definitivamente tutte le annotazioni su ${nome}?`))
							e.preventDefault();
					}}
				>
					Cancella tutte le annotazioni
				</button>
			</form>
		{/if}
	{:else if scheda}
		<!-- 1. I fatti dichiarati: uguali per tutti, si leggono da un rider. -->
		<dl class="grid max-w-2xl gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
			<dt class="text-muted-foreground text-sm">Attrezzatura</dt>
			<dd class="text-sm">
				{#if dichiarati?.volumeAttrezzatura}
					{ETICHETTE_VOLUME[dichiarati.volumeAttrezzatura]}
					{#if dichiarati.richiedeBackline === true}<span class="text-muted-foreground">
							· si aspettano la backline sul posto</span
						>{:else if dichiarati.richiedeBackline === false}<span class="text-muted-foreground">
							· portano tutto</span
						>{/if}
				{:else}
					<span class="text-muted-foreground">non lo sappiamo</span>
				{/if}
			</dd>

			<dt class="text-muted-foreground text-sm">In viaggio</dt>
			<dd class="text-sm">
				{dichiarati?.personeInViaggio ? `${dichiarati.personeInViaggio} persone` : '—'}
			</dd>

			<dt class="text-muted-foreground text-sm">Durata del set</dt>
			<dd class="text-sm">
				{#if durata?.medianaMinuti !== null && durata?.medianaMinuti !== undefined}
					{durata.medianaMinuti} minuti in mediana
					<span class="text-muted-foreground">
						· su {durata.osservazioni}
						{durata.osservazioni === 1 ? 'serata' : 'serate'}
					</span>
					{#if durata.perRuolo.length}
						<span class="text-muted-foreground block text-xs">
							{durata.perRuolo
								.map((r) => `${ETICHETTE_RUOLO[r.ruolo] ?? r.ruolo}: ${r.minuti} min`)
								.join(' · ')}
						</span>
					{/if}
				{:else}
					<span class="text-muted-foreground">nessuna serata annotata</span>
				{/if}
				{#if dichiarati?.durataSetMaxDichiarata}
					<span class="text-muted-foreground block text-xs">
						massimo dichiarato: {dichiarati.durataSetMaxDichiarata} minuti
					</span>
				{/if}
			</dd>

			{#if volume?.modale}
				<dt class="text-muted-foreground text-sm">Visto sul posto</dt>
				<dd class="text-sm">
					{ETICHETTE_VOLUME[volume.modale]}
					<span class="text-muted-foreground">
						· su {volume.osservazioni}
						{volume.osservazioni === 1 ? 'serata' : 'serate'}
					</span>
				</dd>
			{/if}

			<!-- 2. Il cachet: l'unico campo con una soglia davanti. -->
			<dt class="text-muted-foreground text-sm">Fascia di cachet</dt>
			<dd class="text-sm">
				{#if cachet?.stato === 'disponibile'}
					<strong>{ETICHETTE_FASCE[cachet.fascia]}</strong>
					<span class="text-muted-foreground block text-xs">
						{cachet.osservazioni} osservazioni da {cachet.organizzazioni} organizzazioni ·
						{ETICHETTE_FRESCHEZZA[cachet.freschezza]}
						{#if cachet.include}
							· di solito {ETICHETTE_INCLUDE[cachet.include]}
						{/if}
					</span>
				{:else if cachet?.stato === 'sotto_soglia'}
					<span class="text-muted-foreground">Non abbastanza osservazioni.</span>
					<span class="text-muted-foreground block text-xs">
						La fascia compare con almeno tre osservazioni da due organizzazioni diverse, negli
						ultimi {MESI_FINESTRA} mesi. Sotto quel numero un dato comune si riporta a chi l'ha scritto.
					</span>
				{:else}
					<span class="text-muted-foreground">Nessuno ha ancora annotato niente.</span>
				{/if}
			</dd>

			<!-- 3. Il sentito dire, contato a parte e mai mescolato. -->
			{#if riferite && riferite.conteggio > 0}
				<dt class="text-muted-foreground text-sm">Sentito dire</dt>
				<dd class="text-sm">
					{#if riferite.fascia}
						{ETICHETTE_FASCE[riferite.fascia]}
					{:else}
						<span class="text-muted-foreground">senza fascia</span>
					{/if}
					<span class="text-muted-foreground block text-xs">
						{riferite.conteggio}
						{riferite.conteggio === 1 ? 'segnalazione' : 'segnalazioni'} senza una data dietro. Non entrano
						nella fascia comune.
					</span>
				</dd>
			{/if}
		</dl>

		<!-- 4. Le proprie righe, per intero: sono le sole che portano un nome. -->
		{#if scheda.mie.length}
			<div class="mt-8">
				<h3 class="mb-2 text-sm font-medium">
					Quello che hai annotato tu
					<span class="text-muted-foreground font-normal">· lo vedi solo tu</span>
				</h3>
				<ul class="border-border divide-border divide-y rounded-md border">
					{#each scheda.mie as o (o.id)}
						<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3 text-sm">
							<span>
								{riassunto(o)}
								<span class="text-muted-foreground block text-xs">
									{contesto(o)}
									{#if o.eventId && o.titoloEvento}
										·
										<a href={resolve(`/events/${o.eventId}`)} class="underline underline-offset-4"
											>{o.titoloEvento}</a
										>
									{/if}
								</span>
							</span>
							<form method="POST" action="?/ritira" use:enhance>
								<input type="hidden" name="osservazioneId" value={o.id} />
								<button
									type="submit"
									class="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
								>
									ritira
								</button>
							</form>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- 5. Il sentito dire si lascia da qui; l'osservazione vera no, quella
		     parte da una propria data passata (ADR-0048). -->
		{#if puoRiferire && organizzazioni.length}
			<div class="mt-8">
				{#if !apriRiferita}
					<Button variant="outline" onclick={() => (apriRiferita = true)}>
						Lascia un sentito dire
					</Button>
					<p class="text-muted-foreground mt-2 max-w-2xl text-xs">
						Per una band che hai davvero ospitato non si passa da qui: l'annotazione si scrive dalla
						tua data passata, così porta con sé la serata, il ruolo in cartellone e la capienza.
						Questo modulo è per ciò che hai solo sentito dire.
					</p>
				{:else}
					<form
						method="POST"
						action="?/riferisci"
						class="border-border max-w-2xl space-y-4 rounded-md border p-4"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								apriRiferita = false;
							}}
					>
						<p class="text-sm font-medium">Sentito dire</p>
						<p class="text-muted-foreground text-xs">
							Una per organizzazione: se ne lasci un'altra, sostituisce la precedente. Resta
							separata dalla fascia comune e non concorre a farla comparire.
						</p>

						{#if organizzazioni.length > 1}
							<Field
								label="A nome di"
								name="organizationId"
								required
								options={opzioniOrg}
								value={organizzazioni[0].id}
							/>
						{:else}
							<input type="hidden" name="organizationId" value={organizzazioni[0].id} />
						{/if}

						<div class="grid gap-4 sm:grid-cols-2">
							<Field label="Fascia di cachet" name="fasciaCachet" options={OPZIONI_FASCIA} />
							<Field label="Che cosa comprendeva" name="cachetInclude" options={OPZIONI_INCLUDE} />
							<Field label="Minuti di set" name="durataSetMinuti" type="number" min={1} max={600} />
							<Field label="Attrezzatura" name="volumeOsservato" options={OPZIONI_VOLUME} />
							<Field
								label="Anno a cui si riferisce"
								name="annoRiferimento"
								required
								options={opzioniAnno}
								value={String(annoCorrente)}
							/>
						</div>

						<div class="flex gap-2">
							<Button type="submit">Salva</Button>
							<Button type="button" variant="ghost" onclick={() => (apriRiferita = false)}>
								Annulla
							</Button>
						</div>
					</form>
				{/if}
			</div>
		{/if}
	{/if}
</section>
