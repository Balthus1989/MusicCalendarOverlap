<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Locali · Calendario Eventi Condiviso</title></svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">Locali</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			L'anagrafica è condivisa: quello che inserisci lo trovano tutti gli altri organizzatori.
		</p>
	</div>
	<Button href={resolve('/venues/new')}>Aggiungi locale</Button>
</header>

<form method="GET" class="mb-6 flex gap-2">
	<input
		name="q"
		value={data.q}
		placeholder="Cerca per nome o città"
		aria-label="Cerca locale"
		class="border-input bg-background ring-ring/40 w-full max-w-sm rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
	/>
	<Button type="submit" variant="outline">Cerca</Button>
</form>

{#if data.venues.length === 0}
	<p class="text-muted-foreground text-sm">
		{data.q ? 'Nessun locale trovato.' : 'Nessun locale in anagrafica.'}
	</p>
{:else}
	<div class="border-border overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground text-left">
				<tr>
					<th class="px-3 py-2 font-medium">Nome</th>
					<th class="px-3 py-2 font-medium">Città</th>
					<th class="px-3 py-2 font-medium">Capienza</th>
				</tr>
			</thead>
			<tbody>
				{#each data.venues as v (v.id)}
					<tr class="border-border border-t">
						<td class="px-3 py-2">
							<a href={resolve(`/venues/${v.id}`)} class="underline underline-offset-4">{v.name}</a>
						</td>
						<td class="px-3 py-2">{v.city}{v.province ? ` (${v.province})` : ''}</td>
						<td class="px-3 py-2 tabular-nums">{v.capacity ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="text-muted-foreground mt-3 text-xs">Dati geografici © contributori OpenStreetMap</p>
{/if}
