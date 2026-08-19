<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let modifica = $state(false);
	let submitting = $state(false);

	const v = $derived(data.venue);
</script>

<svelte:head><title>{v.name} · Calendario Eventi Condiviso</title></svelte:head>

<nav class="mb-4 text-sm">
	<a href={resolve('/venues')} class="text-muted-foreground underline underline-offset-4">
		← Tutti i locali
	</a>
</nav>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">{v.name}</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			{[v.address, v.city, v.province && `(${v.province})`].filter(Boolean).join(', ')}
		</p>
	</div>
	{#if data.puoModificare}
		<Button variant="outline" onclick={() => (modifica = !modifica)}>
			{modifica ? 'Annulla' : 'Modifica'}
		</Button>
	{/if}
</header>

{#if form?.error}
	<p class="text-destructive mb-4 text-sm" role="alert">{form.error}</p>
{/if}
{#if form?.salvato}
	<p class="mb-4 text-sm">Salvato.</p>
{/if}

{#if !data.puoModificare}
	<p class="border-border mb-6 rounded-md border p-3 text-sm">
		Questa scheda l'ha inserita {data.autore ?? 'un altro organizzatore'}. Puoi consultarla; per
		correggerla serve il ruolo di moderatore.
	</p>
{/if}

{#if modifica}
	<form
		method="POST"
		action="?/salva"
		class="max-w-2xl space-y-5"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
				modifica = false;
			};
		}}
	>
		<Field label="Nome" name="name" required value={v.name} />
		<Field label="Indirizzo" name="address" value={v.address} />

		<div class="grid gap-5 sm:grid-cols-3">
			<Field label="Città" name="city" required value={v.city} />
			<Field label="Provincia" name="province" value={v.province} />
			<Field label="CAP" name="postalCode" value={v.postalCode} />
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Latitudine" name="lat" required value={v.lat} />
			<Field label="Longitudine" name="lon" required value={v.lon} />
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Capienza" name="capacity" type="number" min={1} value={v.capacity} />
			<Field label="Telefono" name="phone" value={v.phone} />
			<Field label="Email" name="email" type="email" value={v.email} />
			<Field label="Sito" name="website" type="url" value={v.website} />
			<Field label="Instagram" name="instagramUrl" type="url" value={v.instagramUrl} />
			<Field label="Facebook" name="facebookUrl" type="url" value={v.facebookUrl} />
		</div>

		<Field label="Note" name="notes" rows={3} value={v.notes} />

		<Button type="submit" size="lg" disabled={submitting}>
			{submitting ? 'Salvataggio…' : 'Salva'}
		</Button>
	</form>
{:else}
	<dl class="grid max-w-2xl gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
		<dt class="text-muted-foreground text-sm">Coordinate</dt>
		<dd class="text-sm tabular-nums">{v.lat.toFixed(5)}, {v.lon.toFixed(5)}</dd>

		<dt class="text-muted-foreground text-sm">Capienza</dt>
		<dd class="text-sm">{v.capacity ?? '—'}</dd>

		<dt class="text-muted-foreground text-sm">Contatti</dt>
		<dd class="text-sm">
			{[v.phone, v.email].filter(Boolean).join(' · ') || '—'}
		</dd>

		<dt class="text-muted-foreground text-sm">Link</dt>
		<dd class="flex flex-wrap gap-3 text-sm">
			{#each [['Sito', v.website], ['Instagram', v.instagramUrl], ['Facebook', v.facebookUrl]] as [etichetta, href] (etichetta)}
				{#if href}
					<a {href} rel="noreferrer noopener external" class="underline underline-offset-4">
						{etichetta}
					</a>
				{/if}
			{/each}
			{#if !v.website && !v.instagramUrl && !v.facebookUrl}—{/if}
		</dd>

		{#if v.notes}
			<dt class="text-muted-foreground text-sm">Note</dt>
			<dd class="text-sm whitespace-pre-line">{v.notes}</dd>
		{/if}

		<dt class="text-muted-foreground text-sm">Inserito da</dt>
		<dd class="text-sm">{data.autore ?? '—'}</dd>
	</dl>

	{#if v.geocodeSource}
		<p class="text-muted-foreground mt-6 text-xs">
			Coordinate da {v.geocodeSource} · dati geografici © contributori OpenStreetMap
		</p>
	{/if}
{/if}
