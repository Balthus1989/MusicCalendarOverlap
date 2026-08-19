<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Calendario · Calendario Eventi Condiviso</title>
</svelte:head>

<h1 class="text-xl font-semibold tracking-tight">Calendario</h1>

<p class="text-muted-foreground mt-2 text-sm">
	Sei autenticato come <strong class="text-foreground">{data.profile.email}</strong>.
</p>

<div class="border-border mt-6 rounded-lg border border-dashed p-8 text-center">
	<p class="text-muted-foreground text-sm">
		La vista FullCalendar con i filtri arriva in Fase 2, insieme allo schema eventi e a
		<code>serializeEvent()</code>.
	</p>
</div>
