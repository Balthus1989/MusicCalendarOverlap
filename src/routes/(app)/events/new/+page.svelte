<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Dopo un errore tornano i valori digitati, non quelli iniziali.
	const valori = $derived(form?.valori ?? data.valori);
</script>

<svelte:head><title>Nuova data · Calendario Eventi Condiviso</title></svelte:head>

<nav class="mb-4 text-sm">
	<a href={resolve('/calendar')} class="text-muted-foreground underline underline-offset-4">
		← Calendario
	</a>
</nav>

<header class="mb-6">
	<h1 class="text-xl font-semibold tracking-tight">Nuova data</h1>
	<p class="text-muted-foreground mt-1 text-sm">
		Puoi salvarla in bozza e completarla dopo. Opzionala appena la data è decisa: è così che gli
		altri organizzatori si accorgono di una sovrapposizione prima di annunciare.
	</p>
</header>

<EventForm
	{valori}
	generi={data.generi}
	locali={data.locali}
	organizzazioni={data.organizzazioni}
	statiAmmessi={data.statiAmmessi}
	errori={form?.errori ?? {}}
	erroreGenerale={form?.erroreGenerale ?? null}
	etichettaInvio="Salva la data"
	annullaHref={resolve('/calendar')}
/>
