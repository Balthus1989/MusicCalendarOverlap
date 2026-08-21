<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import EventForm from '$lib/components/EventForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const valori = $derived(form?.valori ?? data.valori);
	const dettaglio = $derived(resolve(`/events/${page.params.id}`));
</script>

<svelte:head><title>Modifica {data.titolo} · Calendario Eventi Condiviso</title></svelte:head>

<nav class="mb-4 text-sm">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={dettaglio} class="text-muted-foreground underline underline-offset-4">
		← Torna alla data
	</a>
</nav>

<header class="mb-6">
	<h1 class="text-xl font-semibold tracking-tight">Modifica</h1>
	<p class="text-muted-foreground mt-1 text-sm">{data.titolo}</p>
</header>

<EventForm
	{valori}
	generi={data.generi}
	locali={data.locali}
	organizzazioni={data.organizzazioni}
	statiAmmessi={data.statiAmmessi}
	errori={form?.errori ?? {}}
	erroreGenerale={form?.erroreGenerale ?? null}
	etichettaInvio="Salva le modifiche"
	annullaHref={dettaglio}
	eventId={page.params.id}
/>
