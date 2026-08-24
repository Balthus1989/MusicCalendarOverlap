<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { cambi, etichettaAzione, nomeAttore } from '$lib/audit';
	import ConflictWarning from '$lib/components/ConflictWarning.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ORDINE_SEVERITA } from '$lib/conflicts';
	import { ETICHETTE_LOCANDINA, ETICHETTE_STATO } from '$lib/events';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const e = $derived(data.evento);
	const completo = $derived(e.visibilita === 'completa' ? e : null);

	const giornoEsteso = $derived(
		new Intl.DateTimeFormat('it-IT', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'Europe/Rome'
		}).format(new Date(`${e.giorno}T12:00:00Z`))
	);

	const ora = (istante: Date | string | null) =>
		istante
			? new Intl.DateTimeFormat('it-IT', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Europe/Rome'
				}).format(new Date(istante))
			: null;

	const prezzo = (v: string | null) =>
		v === null ? null : `${Number(v).toFixed(2).replace('.', ',')} €`;

	/**
	 * I conflitti stanno **prima** di tutto il resto, non in fondo alla
	 * colonna laterale.
	 *
	 * ADR-0022 ha deciso che un conflitto aperto non impedisce di confermare
	 * una data, e in cambio ha assunto un impegno di interfaccia: che chi
	 * conferma l'abbia visto. Un avviso sotto la piega non mantiene
	 * quell'impegno.
	 */
	const conflitti = $derived(
		[...data.conflitti].sort((a, b) => ORDINE_SEVERITA[a.severity] - ORDINE_SEVERITA[b.severity])
	);

	/* --- Copy per i social (ADR-0012) ------------------------------------ */

	const PIATTAFORME = [
		{ id: 'instagram', nome: 'Instagram' },
		{ id: 'facebook', nome: 'Facebook' },
		{ id: 'telegram', nome: 'Telegram' }
	] as const;

	let piattaforma = $state<(typeof PIATTAFORME)[number]['id'] | null>(null);
	let copy = $state<{ testo: string; caratteri: number; avvisi: string[] } | null>(null);
	let motivoCopy = $state<string | null>(null);
	let caricoCopy = $state(false);
	let testoCopiato = $state(false);

	async function generaCopy(id: (typeof PIATTAFORME)[number]['id']) {
		piattaforma = id;
		caricoCopy = true;
		copy = null;
		motivoCopy = null;
		testoCopiato = false;
		try {
			const res = await fetch(`/api/events/${page.params.id}/social-copy?platform=${id}`);
			const dati = await res.json();
			copy = dati.copy ?? null;
			motivoCopy = dati.motivo ?? null;
		} catch {
			motivoCopy = 'Non sono riuscito a generare il testo. Riprova fra un momento.';
		} finally {
			caricoCopy = false;
		}
	}

	async function copiaNegliAppunti() {
		if (!copy) return;
		try {
			await navigator.clipboard.writeText(copy.testo);
			testoCopiato = true;
			setTimeout(() => (testoCopiato = false), 2500);
		} catch {
			// Il testo resta selezionabile nella textarea: non serve un errore.
		}
	}
</script>

<svelte:head>
	<title>{completo ? completo.title : giornoEsteso} · Calendario Eventi Condiviso</title>
	{#if data.jsonLd}
		<!--
			JSON-LD schema.org/MusicEvent (ARCHITECTURE.md §8).

			Compare solo per le date **annunciate**: `aMusicEvent` restituisce
			`null` per una bozza, per un'opzione e per tutto ciò che si vede in
			visibilità ridotta. Descrivere in un formato leggibile dalle macchine
			una data che ADR-0005 tiene riservata sarebbe annunciarla.

			`{@html}` è l'unico modo di emettere un `<script>` da un template
			Svelte, e qui non è un varco: il contenuto è `JSON.stringify` di un
			oggetto costruito dal server, e ogni `<` viene sostituito da `\u003c`
			— che in JSON vale esattamente lo stesso carattere. Nessuna stringa
			proveniente dai dati può quindi chiudere il tag.
		-->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html `<script type="application/ld+json">${JSON.stringify(data.jsonLd).replace(/</g, '\\u003c')}</` +
			`script>`}
	{/if}
</svelte:head>

<nav class="mb-4 text-sm">
	<a href={resolve('/calendar')} class="text-muted-foreground underline underline-offset-4">
		← Calendario
	</a>
</nav>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<div class="mb-2 flex flex-wrap items-center gap-2">
			<span class="border-border rounded border px-2 py-0.5 text-xs tracking-wide uppercase">
				{ETICHETTE_STATO[e.status]}
			</span>
			{#if e.proprio}
				<span class="text-muted-foreground text-xs">La tua organizzazione</span>
			{/if}
		</div>

		<h1 class="text-xl font-semibold tracking-tight">
			{#if completo}{completo.title}{:else}Data opzionata da {e.organizzazione.name}{/if}
		</h1>

		{#if completo?.subtitle}
			<p class="text-muted-foreground mt-1 text-sm">{completo.subtitle}</p>
		{/if}
	</div>

	{#if data.puoModificare}
		<Button variant="outline" href={resolve(`/events/${page.params.id}/edit`)}>Modifica</Button>
	{/if}
</header>

{#if form?.errore}
	<p class="text-destructive mb-4 text-sm" role="alert">{form.errore}</p>
{/if}
{#if form?.statoCambiato}
	<p class="mb-4 text-sm">Stato aggiornato: {form.statoCambiato}.</p>
{/if}

{#if e.status === 'cancelled'}
	<p class="border-border mb-6 rounded-md border p-3 text-sm">
		Questa data è stata annullata. Resta visibile perché lo slot è di nuovo libero.
	</p>
{/if}

{#if conflitti.length}
	<section class="mb-8 space-y-3" aria-labelledby="titolo-conflitti">
		<h2 id="titolo-conflitti" class="text-sm font-medium">
			{conflitti.length === 1
				? 'C’è un conflitto aperto su questa data'
				: `Ci sono ${conflitti.length} conflitti aperti su questa data`}
		</h2>
		{#each conflitti as c (c.id)}
			<ConflictWarning conflitto={c} />
		{/each}
		<p class="text-muted-foreground text-xs">
			Nessuno di questi avvisi ti impedisce di confermare: la decisione è vostra, e con essa la
			responsabilità di esservi sentiti.
			<a href={resolve('/conflicts')} class="underline underline-offset-4">
				Gestiscili dalla dashboard
			</a>.
		</p>
	</section>
{/if}

<div class="grid gap-8 lg:grid-cols-[2fr_1fr]">
	<div class="space-y-8">
		<!-- Quando e dove ------------------------------------------------ -->
		<section>
			<h2 class="mb-3 text-sm font-medium">Quando e dove</h2>
			<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
				<dt class="text-muted-foreground">Giorno</dt>
				<dd>{giornoEsteso}</dd>

				{#if completo}
					<dt class="text-muted-foreground">Orario</dt>
					<dd>
						{ora(completo.startsAt)}
						{#if completo.endsAt}– {ora(completo.endsAt)}{/if}
						{#if completo.doorsAt}
							<span class="text-muted-foreground">· porte {ora(completo.doorsAt)}</span>
						{/if}
					</dd>
				{/if}

				<dt class="text-muted-foreground">Città</dt>
				<dd>{e.city}{e.province ? ` (${e.province})` : ''}</dd>

				{#if completo?.venue}
					<dt class="text-muted-foreground">Locale</dt>
					<dd>
						<a href={resolve(`/venues/${completo.venue.id}`)} class="underline underline-offset-4">
							{completo.venue.name}
						</a>
						{#if completo.venue.address}
							<span class="text-muted-foreground">· {completo.venue.address}</span>
						{/if}
					</dd>
				{/if}
			</dl>
		</section>

		<!-- Generi -------------------------------------------------------- -->
		<section>
			<h2 class="mb-3 text-sm font-medium">Generi</h2>
			{#if completo}
				{#if completo.generi.length}
					<ul class="flex flex-wrap gap-2">
						{#each completo.generi as g (g.slug)}
							<li class="border-border rounded border px-2 py-0.5 text-xs">
								{g.name}{#if g.isPrimary}<span class="text-muted-foreground">
										· principale</span
									>{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-muted-foreground text-sm">Nessun genere indicato.</p>
				{/if}
			{:else if e.generePrimario}
				<p class="text-sm">{e.generePrimario.name}</p>
			{:else}
				<p class="text-muted-foreground text-sm">Non indicato.</p>
			{/if}
		</section>

		<!-- Lineup -------------------------------------------------------- -->
		{#if completo}
			<section>
				<h2 class="mb-3 text-sm font-medium">Lineup</h2>
				{#if completo.lineup.length}
					<ul class="space-y-2 text-sm">
						{#each completo.lineup as v (v.id)}
							<li class="flex flex-wrap items-baseline gap-2">
								<span class="font-medium">
									{#if v.artistId}
										<a href={resolve(`/artists/${v.artistId}`)} class="underline underline-offset-4"
											>{v.nome}</a
										>
									{:else}{v.nome}{/if}
								</span>
								<span class="text-muted-foreground text-xs">{ETICHETTE_LOCANDINA[v.billing]}</span>
								{#if v.setStartsAt}
									<span class="text-muted-foreground text-xs">· {ora(v.setStartsAt)}</span>
								{/if}
								{#if e.proprio && !v.isAnnounced}
									<span class="border-border rounded border px-1.5 text-xs">non annunciata</span>
								{/if}
							</li>
						{/each}
					</ul>
					{#if e.proprio}
						<p class="text-muted-foreground mt-2 text-xs">
							Le band non annunciate non escono mai da qui: nessun'altra organizzazione le vede.
						</p>
					{/if}
				{:else}
					<p class="text-muted-foreground text-sm">Ancora nessuna band annunciata.</p>
				{/if}
			</section>
		{/if}

		<!-- Ingresso ------------------------------------------------------ -->
		{#if completo}
			<section>
				<h2 class="mb-3 text-sm font-medium">Ingresso</h2>
				<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
					<dt class="text-muted-foreground">Prezzo</dt>
					<dd>
						{#if completo.isFree}
							Ingresso libero
						{:else if completo.pricePresale || completo.priceDoor}
							{#if completo.pricePresale}{prezzo(completo.pricePresale)} in prevendita{/if}
							{#if completo.pricePresale && completo.priceDoor}
								·
							{/if}
							{#if completo.priceDoor}{prezzo(completo.priceDoor)} alla porta{/if}
						{:else}
							Non indicato
						{/if}
					</dd>

					{#if completo.isMembersOnly}
						<dt class="text-muted-foreground">Accesso</dt>
						<dd>Riservato ai tesserati</dd>
					{/if}

					{#if completo.ageRestriction}
						<dt class="text-muted-foreground">Età</dt>
						<dd>{completo.ageRestriction}</dd>
					{/if}

					{#if completo.ticketUrl}
						<dt class="text-muted-foreground">Biglietti</dt>
						<dd>
							<a
								href={completo.ticketUrl}
								rel="noreferrer noopener external"
								class="underline underline-offset-4">Prevendita</a
							>
						</dd>
					{/if}
				</dl>
			</section>
		{/if}

		{#if completo?.description}
			<section>
				<h2 class="mb-3 text-sm font-medium">Descrizione</h2>
				<p class="text-sm whitespace-pre-line">{completo.description}</p>
			</section>
		{/if}

		{#if completo && (completo.links.length || completo.facebookEventUrl || completo.externalUrl)}
			<section>
				<h2 class="mb-3 text-sm font-medium">Link</h2>
				<ul class="space-y-1 text-sm">
					{#if completo.facebookEventUrl}
						<li>
							<a
								href={completo.facebookEventUrl}
								rel="noreferrer noopener external"
								class="underline underline-offset-4">Evento Facebook</a
							>
						</li>
					{/if}
					{#if completo.externalUrl}
						<li>
							<a
								href={completo.externalUrl}
								rel="noreferrer noopener external"
								class="underline underline-offset-4">Sito dell'evento</a
							>
						</li>
					{/if}
					{#each completo.links as l (l.url)}
						<li>
							<a
								href={l.url}
								rel="noreferrer noopener external"
								class="underline underline-offset-4">{l.label}</a
							>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Riservato ------------------------------------------------------ -->
		{#if completo?.internalNotes}
			<section class="border-border rounded-lg border p-4">
				<h2 class="mb-2 text-sm font-medium">Note interne</h2>
				<p class="text-sm whitespace-pre-line">{completo.internalNotes}</p>
				<p class="text-muted-foreground mt-2 text-xs">
					Visibili solo alla tua organizzazione, in qualunque stato.
				</p>
			</section>
		{/if}
	</div>

	<!-- Colonna laterale --------------------------------------------------- -->
	<aside class="space-y-6">
		<section class="border-border rounded-lg border p-4">
			<h2 class="mb-2 text-sm font-medium">Organizza</h2>
			<p class="text-sm">{e.organizzazione.name}</p>
			{#if e.organizzazione.city}
				<p class="text-muted-foreground text-sm">
					{e.organizzazione.city}{e.organizzazione.province
						? ` (${e.organizzazione.province})`
						: ''}
				</p>
			{/if}

			{#if !e.proprio}
				<div class="mt-3 space-y-1 text-sm">
					{#if e.organizzazione.emailContact}
						<p>
							<a
								rel="external"
								href={`mailto:${e.organizzazione.emailContact}?subject=${encodeURIComponent(`Data del ${e.giorno} a ${e.city}`)}`}
								class="underline underline-offset-4"
							>
								Scrivi a {e.organizzazione.emailContact}
							</a>
						</p>
					{/if}
					{#if e.organizzazione.website}
						<p>
							<a
								href={e.organizzazione.website}
								rel="noreferrer noopener external"
								class="underline underline-offset-4">Sito</a
							>
						</p>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Porta via la data ------------------------------------------------ -->
		<section class="border-border rounded-lg border p-4">
			<h2 class="mb-2 text-sm font-medium">Nel tuo calendario</h2>
			<ul class="space-y-1 text-sm">
				<li>
					<a
						href={resolve('/api/events/[id].ics', { id: page.params.id! })}
						data-sveltekit-reload
						class="underline underline-offset-4">Scarica il file .ics</a
					>
				</li>
				<li>
					<a
						href={data.linkCalendario.google}
						rel="noreferrer noopener external"
						class="underline underline-offset-4">Aggiungi a Google Calendar</a
					>
				</li>
				<li>
					<a
						href={data.linkCalendario.outlook}
						rel="noreferrer noopener external"
						class="underline underline-offset-4">Aggiungi a Outlook</a
					>
				</li>
			</ul>
			<p class="text-muted-foreground mt-2 text-xs">
				Un file scaricato non si aggiorna più: se la data si sposta, nel tuo calendario resta
				dov’era. Per averle sempre allineate conviene
				<a href={resolve('/settings/feeds')} class="underline underline-offset-4">
					sottoscrivere un feed</a
				>.
			</p>
		</section>

		<!-- Copy per i social (ADR-0012) -------------------------------------- -->
		{#if completo}
			<section class="border-border rounded-lg border p-4">
				<h2 class="mb-2 text-sm font-medium">Testo per i social</h2>
				<p class="text-muted-foreground mb-3 text-xs">
					Pronto da copiare e incollare. Il calendario non pubblica niente da solo: su Meta non è
					possibile, e prometterlo sarebbe una bugia.
				</p>

				<div class="flex flex-wrap gap-2">
					{#each PIATTAFORME as p (p.id)}
						<Button
							variant="outline"
							onclick={() => generaCopy(p.id)}
							aria-pressed={piattaforma === p.id}
						>
							{p.nome}
						</Button>
					{/each}
				</div>

				{#if caricoCopy}
					<p class="text-muted-foreground mt-3 text-xs">Preparo il testo…</p>
				{/if}

				{#if motivoCopy}
					<p class="mt-3 text-xs" role="status">{motivoCopy}</p>
				{/if}

				{#if copy}
					<label class="mt-3 block">
						<span class="sr-only">Testo generato</span>
						<textarea
							readonly
							rows="12"
							value={copy.testo}
							onfocus={(ev) => ev.currentTarget.select()}
							class="border-input bg-background w-full rounded-md border px-3 py-2 text-xs"
						></textarea>
					</label>
					<div class="mt-2 flex flex-wrap items-center gap-3">
						<Button variant="outline" onclick={copiaNegliAppunti}>
							{testoCopiato ? 'Copiato' : 'Copia'}
						</Button>
						<span class="text-muted-foreground text-xs">{copy.caratteri} caratteri</span>
					</div>
					{#each copy.avvisi as avviso (avviso)}
						<p class="mt-2 text-xs">{avviso}</p>
					{/each}
				{/if}
			</section>
		{/if}

		{#if e.visibilita === 'ridotta'}
			<section class="border-border rounded-lg border border-dashed p-4">
				<h2 class="mb-2 text-sm font-medium">Perché vedi così poco</h2>
				<p class="text-muted-foreground text-sm">
					Questa data è opzionata, non ancora annunciata. Chi la organizza ha condiviso il giorno,
					la città e il genere proprio per permetterti di accorgerti di una sovrapposizione. Orario,
					locale e lineup restano riservati finché non la conferma.
				</p>
				<p class="text-muted-foreground mt-2 text-sm">
					Se pensi di avere una data in conflitto, la cosa da fare è scrivergli.
				</p>
			</section>
		{/if}

		{#if data.puoModificare && data.transizioni.length}
			<section class="border-border rounded-lg border p-4">
				<h2 class="mb-3 text-sm font-medium">Cambia stato</h2>
				<div class="flex flex-wrap gap-2">
					{#each data.transizioni as t (t)}
						<form method="POST" action="?/stato" use:enhance>
							<input type="hidden" name="nuovoStato" value={t} />
							<Button type="submit" variant="outline">{ETICHETTE_STATO[t]}</Button>
						</form>
					{/each}
				</div>
				{#if conflitti.length && data.transizioni.includes('confirmed')}
					<p class="text-muted-foreground mt-3 text-xs">
						Confermare significa annunciare: il conflitto qui sopra diventa definitivo. Puoi farlo
						comunque — il calendario non decide al posto vostro — ma è il momento giusto per una
						telefonata.
					</p>
				{/if}
				{#if completo?.announceAt}
					<p class="text-muted-foreground mt-3 text-xs">
						Annuncio previsto per il {new Intl.DateTimeFormat('it-IT', {
							dateStyle: 'medium',
							timeZone: 'Europe/Rome'
						}).format(new Date(completo.announceAt))}.
					</p>
				{/if}
			</section>
		{/if}

		{#if data.storia.length}
			<section class="border-border rounded-lg border p-4">
				<h2 class="mb-2 text-sm font-medium">Storia della data</h2>
				<p class="text-muted-foreground mb-3 text-xs">
					Chi ha cambiato cosa. La vede solo la tua organizzazione.
				</p>
				<ol class="grid gap-2 text-xs">
					{#each data.storia as voce (voce.id)}
						<li>
							<time class="text-muted-foreground" datetime={new Date(voce.createdAt).toISOString()}>
								{new Intl.DateTimeFormat('it-IT', {
									dateStyle: 'short',
									timeStyle: 'short',
									timeZone: 'Europe/Rome'
								}).format(new Date(voce.createdAt))}
							</time>
							— {nomeAttore(voce.attore)}:
							{#if cambi(voce).length}
								{cambi(voce)
									.map((c) => `${c.campo} ${c.prima} → ${c.dopo}`)
									.join(', ')}
							{:else}
								{etichettaAzione(voce.action)}
							{/if}
						</li>
					{/each}
				</ol>
				<p class="text-muted-foreground mt-3 text-xs">
					<a class="underline underline-offset-4" href={resolve('/audit')}>Registro completo</a>
				</p>
			</section>
		{/if}

		{#if data.puoEliminare}
			<section class="border-border rounded-lg border p-4">
				<h2 class="mb-2 text-sm font-medium">Cancella</h2>
				<p class="text-muted-foreground mb-3 text-xs">
					Serve solo per le date inserite per errore. Se la serata salta, annullala: agli altri
					organizzatori interessa sapere che lo slot si è liberato.
				</p>
				<form
					method="POST"
					action="?/elimina"
					use:enhance={({ cancel }) => {
						if (!confirm('Cancellare definitivamente questa data?')) cancel();
					}}
				>
					<Button type="submit" variant="outline">Cancella definitivamente</Button>
				</form>
			</section>
		{/if}
	</aside>
</div>
