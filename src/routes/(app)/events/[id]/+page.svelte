<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
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
</script>

<svelte:head>
	<title>{completo ? completo.title : giornoEsteso} · Calendario Eventi Condiviso</title>
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
