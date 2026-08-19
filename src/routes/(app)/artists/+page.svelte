<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Artisti · Calendario Eventi Condiviso</title></svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">Artisti</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Anagrafica condivisa, contatti booking compresi. È metà del senso di questo calendario.
		</p>
	</div>
	<Button href={resolve('/artists/new')}>Aggiungi artista</Button>
</header>

<form method="GET" class="mb-6 flex gap-2">
	<input
		name="q"
		value={data.q}
		placeholder="Cerca band"
		aria-label="Cerca artista"
		class="border-input bg-background ring-ring/40 w-full max-w-sm rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
	/>
	<Button type="submit" variant="outline">Cerca</Button>
</form>

{#if data.artists.length === 0}
	<p class="text-muted-foreground text-sm">
		{data.q ? 'Nessun artista trovato.' : 'Nessun artista in anagrafica.'}
	</p>
{:else}
	<ul class="border-border divide-border divide-y rounded-lg border">
		{#each data.artists as a (a.id)}
			<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5">
				<a
					href={resolve(`/artists/${a.id}`)}
					class="text-sm font-medium underline underline-offset-4"
				>
					{a.name}
				</a>
				{#if a.generi.length}
					<span class="text-muted-foreground text-xs">{a.generi.join(' · ')}</span>
				{/if}
				{#if a.country}
					<span class="text-muted-foreground text-xs">{a.country}</span>
				{/if}
				<span class="ml-auto flex gap-2">
					{#if a.mbid}
						<span
							class="border-border rounded border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase"
							title="Collegata a MusicBrainz: due omonime restano distinguibili"
						>
							MBID
						</span>
					{/if}
					{#if a.isVerified}
						<span
							class="border-border rounded border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase"
							title="Scheda curata da un moderatore"
						>
							verificata
						</span>
					{/if}
				</span>
			</li>
		{/each}
	</ul>

	{#if data.senzaMbid > 0}
		<p class="text-muted-foreground mt-3 text-xs">
			{data.senzaMbid}
			{data.senzaMbid === 1 ? 'scheda è' : 'schede sono'} senza MusicBrainz ID. Senza, due band omonime
			non possono coesistere in anagrafica.
		</p>
	{/if}
{/if}
