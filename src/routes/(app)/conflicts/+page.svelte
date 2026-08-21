<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ConflictWarning from '$lib/components/ConflictWarning.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ETICHETTE_STATO_CONFLITTO } from '$lib/conflicts';
	import { ETICHETTE_STATO } from '$lib/events';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** Il conflitto per cui è aperto il riquadro della nota. Uno per volta. */
	let notaAperta = $state<string | null>(null);
</script>

<svelte:head>
	<title>Conflitti · Calendario Eventi Condiviso</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">
			{data.archivio ? 'Conflitti chiusi' : 'Conflitti da trattare'}
		</h1>
		<p class="text-muted-foreground mt-1 max-w-2xl text-sm">
			{#if data.archivio}
				Quelli già risolti o archiviati. Non si cancellano: fra sei mesi, quando la stessa data
				tornerà in discussione, questa è l'unica traccia che dice se ne avevate già parlato.
			{:else}
				Il calendario segnala, non decide. Nessuno di questi avvisi ti impedisce di confermare una
				data: servono a farvi sentire prima dell'annuncio, non dopo.
			{/if}
		</p>
	</div>

	<Button
		variant="outline"
		href={data.archivio ? resolve('/conflicts') : `${resolve('/conflicts')}?archivio=1`}
	>
		{data.archivio ? 'Torna a quelli aperti' : 'Vedi lo storico'}
	</Button>
</header>

{#if form?.errore}
	<p class="text-destructive mb-4 text-sm" role="alert">{form.errore}</p>
{/if}
{#if form?.fatto}
	<p class="mb-4 text-sm">{form.fatto}</p>
{/if}

{#if !data.conflitti.length}
	<div class="border-border rounded-lg border border-dashed p-6">
		<p class="text-sm">
			{#if data.archivio}
				Non c'è ancora niente nello storico.
			{:else}
				Nessun conflitto aperto sulle tue date.
			{/if}
		</p>
		{#if !data.archivio}
			<p class="text-muted-foreground mt-2 text-sm">
				Vale la pena ricordare che il controllo funziona solo sulle date che qualcuno ha caricato.
				Se opzioni una serata prima di annunciarla, gli altri se ne accorgono in tempo — ed è
				l'unico motivo per cui questo calendario esiste.
			</p>
		{/if}
	</div>
{:else}
	<ul class="space-y-4">
		{#each data.conflitti as c (c.id)}
			<li>
				<ConflictWarning conflitto={c}>
					<div class="space-y-3">
						<!-- Di quale delle proprie date si parla ------------------ -->
						<p class="text-xs">
							<span class="text-muted-foreground">Riguarda la tua data:</span>
							<a href={resolve(`/events/${c.mia.id}`)} class="underline underline-offset-4"
								>{c.mia.title}</a
							>
							<span class="text-muted-foreground">
								· {ETICHETTE_STATO[c.mia.status]} · {c.mia.giorno}
							</span>
						</p>

						<p class="text-muted-foreground text-xs">
							Stato: {ETICHETTE_STATO_CONFLITTO[c.status]}
							{#if c.presoAtto && c.presoAttoDallAltro}
								· ne avete preso atto entrambi
							{:else if c.presoAtto}
								· tu ne hai preso atto, l'altra organizzazione non ancora
							{:else if c.presoAttoDallAltro}
								· l'altra organizzazione ne ha preso atto
							{/if}
						</p>

						{#if c.resolutionNote}
							<p class="border-border rounded border p-2 text-xs">
								<span class="text-muted-foreground">Nota:</span>
								{c.resolutionNote}
							</p>
						{/if}

						<!-- Azioni ------------------------------------------------ -->
						<div class="flex flex-wrap items-center gap-2">
							{#if data.archivio}
								<form method="POST" action="?/riapri" use:enhance>
									<input type="hidden" name="conflictId" value={c.id} />
									<Button type="submit" variant="outline">Riapri</Button>
								</form>
							{:else}
								{#if !c.presoAtto}
									<form method="POST" action="?/prendiAtto" use:enhance>
										<input type="hidden" name="conflictId" value={c.id} />
										<Button type="submit" variant="outline">L'abbiamo visto</Button>
									</form>
								{/if}
								<Button
									type="button"
									variant="outline"
									onclick={() => (notaAperta = notaAperta === c.id ? null : c.id)}
								>
									{notaAperta === c.id ? 'Chiudi' : 'Chiudi con una nota'}
								</Button>
							{/if}
						</div>

						{#if notaAperta === c.id}
							<!-- Un solo form per le due chiusure, distinte da `formaction`: la
							     nota è la stessa, e con due form separati quella scritta
							     finirebbe solo in uno dei due. -->
							<form
								method="POST"
								action="?/risolvi"
								use:enhance
								class="border-border space-y-3 rounded-md border p-3"
							>
								<input type="hidden" name="conflictId" value={c.id} />

								<label class="block text-xs font-medium" for={`nota-${c.id}`}> Com'è andata </label>
								<textarea
									id={`nota-${c.id}`}
									name="nota"
									rows="3"
									placeholder="Es. sentiti al telefono: loro spostano al sabato dopo."
									class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
								></textarea>

								<div class="flex flex-wrap gap-2">
									<Button type="submit">Risolto</Button>
									<Button type="submit" formaction="?/archivia" variant="outline">
										Va bene così
									</Button>
								</div>

								<p class="text-muted-foreground text-xs">
									<strong>Risolto</strong> vuol dire che il conflitto non c'è più: una delle due
									date è cambiata. <strong>Va bene così</strong> vuol dire che c'è ancora e che avete
									deciso di tenerlo — due serate a quaranta chilometri con pubblici diversi convivono
									benissimo, e questo lo sapete voi, non il calendario.
								</p>
							</form>
						{/if}
					</div>
				</ConflictWarning>
			</li>
		{/each}
	</ul>
{/if}
