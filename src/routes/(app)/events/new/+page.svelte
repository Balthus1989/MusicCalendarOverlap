<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '$lib/components/EventForm.svelte';
	import PastePanel from '$lib/components/PastePanel.svelte';
	import type { EsitoImport } from '$lib/parse';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * Ciò che ha prodotto l'incolla, quando c'è stato.
	 *
	 * L'ordine di precedenza è quello di quanto è recente il gesto: i valori
	 * tornati da un salvataggio fallito vengono prima di tutto — sono le
	 * ultime cose scritte a mano, e perderle sarebbe imperdonabile — poi
	 * l'incolla, poi i valori di partenza.
	 */
	let daIncolla = $state<EsitoImport | null>(null);

	/**
	 * Cambia a ogni incolla riuscito, e rimonta il form.
	 *
	 * Serve perché `EventForm` tiene una copia locale dei campi che
	 * l'interfaccia deve seguire mentre si scrive — lo stato, la lineup, i
	 * generi — e quelle copie, una volta toccate, hanno la precedenza sulle
	 * prop. Senza il rimontaggio, chi incolla dopo aver già scritto qualcosa
	 * vedrebbe cambiare metà form e l'altra metà no, che è il modo peggiore
	 * di comportarsi: sembra funzionare.
	 */
	let generazione = $state(0);

	/**
	 * L'organizzazione scelta nel menù del form, se qualcuno l'ha toccato.
	 *
	 * Il pannello dell'incolla ne ha bisogno: si legge un testo **per conto di
	 * un'organizzazione**, e la scelta vive dentro il form, non qui. Senza,
	 * chi appartiene a due circoli sceglierebbe il secondo, incollerebbe, e si
	 * ritroverebbe il form riportato al primo senza un avviso.
	 */
	let organizzazioneScelta = $state<string | null>(null);

	const valori = $derived(form?.valori ?? daIncolla?.valori ?? data.valori);
	const organizzazione = $derived(organizzazioneScelta ?? valori.organizationId);
	const proposte = $derived(form?.valori ? [] : (daIncolla?.proposte ?? []));

	function suEsito(esito: EsitoImport) {
		daIncolla = esito;
		generazione += 1;
	}
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

<PastePanel
	organizationId={organizzazione}
	llmDisponibile={data.llmDisponibile}
	onEsito={suEsito}
/>

{#key generazione}
	<EventForm
		{valori}
		onOrganizzazione={(id) => (organizzazioneScelta = id)}
		generi={data.generi}
		locali={data.locali}
		organizzazioni={data.organizzazioni}
		statiAmmessi={data.statiAmmessi}
		proposteArtisti={proposte}
		errori={form?.errori ?? {}}
		erroreGenerale={form?.erroreGenerale ?? null}
		etichettaInvio="Salva la data"
		annullaHref={resolve('/calendar')}
	/>
{/key}
