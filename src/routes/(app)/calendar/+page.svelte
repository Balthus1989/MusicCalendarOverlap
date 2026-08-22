<script lang="ts">
	import { untrack } from 'svelte';
	import { Calendar } from '@fullcalendar/core';
	import itLocale from '@fullcalendar/core/locales/it';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import listPlugin from '@fullcalendar/list';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { ETICHETTE_STATO, type EventoCalendario } from '$lib/events';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let contenitore: HTMLDivElement;
	let calendario: Calendar | null = null;
	let errore = $state<string | null>(null);

	/* Filtri. Restano nello stato del componente: la finestra visibile la
	   decide FullCalendar, e tenere tutto nell'URL vorrebbe dire ricaricare la
	   pagina a ogni cambio di mese. */
	/**
	 * Tutti gli stati accesi di partenza.
	 *
	 * Le date annullate **devono** vedersi senza doverle chiedere: liberare uno
	 * slot è esattamente l'informazione che interessa a un altro organizzatore
	 * (ADR-0005), e un filtro spento di default la nasconderebbe proprio a chi
	 * potrebbe approfittarne. Le bozze sono le proprie e nessun altro le vede:
	 * escluderle significherebbe aprire il calendario e non trovare la data
	 * appena salvata.
	 */
	let statiScelti = $state<string[]>(['hold', 'confirmed', 'cancelled', 'draft']);
	let genereScelto = $state('');
	let orgScelta = $state('');
	let raggio = $state<number | ''>('');

	const STATI = ['hold', 'confirmed', 'cancelled', 'draft'] as const;

	function parametri(da: Date, a: Date): string {
		const coppie: [string, string][] = [
			['da', da.toISOString()],
			['a', a.toISOString()],
			...statiScelti.map((s): [string, string] => ['stato', s])
		];
		if (genereScelto) coppie.push(['genere', genereScelto]);
		if (orgScelta) coppie.push(['org', orgScelta]);
		if (raggio && data.centro) {
			coppie.push(['raggio', String(raggio)]);
			coppie.push(['lat', String(data.centro.lat)]);
			coppie.push(['lon', String(data.centro.lon)]);
		}
		return coppie.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
	}

	async function caricaEventi(info: { start: Date; end: Date }): Promise<EventoCalendario[]> {
		// `untrack`: FullCalendar può chiamare questa funzione durante
		// `render()`, cioè dentro l'`$effect` che costruisce il calendario. Senza,
		// i filtri letti qui diventerebbero dipendenze dell'effetto, e cambiarne
		// uno distruggerebbe e ricostruirebbe il calendario invece di
		// ricaricarne le date — perdendo per giunta il mese che si stava
		// guardando.
		const query = untrack(() => parametri(info.start, info.end));
		const risposta = await fetch(`/api/events?${query}`);
		if (!risposta.ok) {
			errore = 'Non è stato possibile caricare le date. Riprova fra un momento.';
			return [];
		}
		errore = null;
		return risposta.json();
	}

	$effect(() => {
		calendario = new Calendar(contenitore, {
			plugins: [dayGridPlugin, timeGridPlugin, listPlugin],
			locale: itLocale,
			// Il fuso è quello del prodotto, non quello del browser: un
			// organizzatore in viaggio deve vedere gli stessi orari di sempre.
			timeZone: 'Europe/Rome',
			initialView: 'dayGridMonth',
			headerToolbar: {
				left: 'prev,next oggi',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,listMonth'
			},
			customButtons: {
				oggi: { text: 'Oggi', click: () => calendario?.today() }
			},
			buttonText: { month: 'Mese', week: 'Settimana', list: 'Elenco' },
			height: 'auto',
			firstDay: 1,
			nowIndicator: true,
			events: (info, successo, fallimento) => {
				caricaEventi(info).then(successo).catch(fallimento);
			},
			eventClick: (info) => {
				info.jsEvent.preventDefault();
				goto(resolve(`/events/${info.event.id}`));
			},
			eventDidMount: (info) => {
				const p = info.event.extendedProps as EventoCalendario['extendedProps'];
				const luogo = [p.citta, p.provincia && `(${p.provincia})`].filter(Boolean).join(' ');
				info.el.title = p.ridotto
					? `${p.statusEtichetta} · ${luogo} · ${p.organizzazione} — data opzionata: orario, locale e lineup non sono visibili`
					: `${p.statusEtichetta} · ${luogo}${p.locale ? ` · ${p.locale}` : ''} · ${p.organizzazione}`;
			}
		});

		calendario.render();
		return () => calendario?.destroy();
	});

	/** Cambiare filtro non ricarica la pagina: ricarica solo le date. */
	function applicaFiltri() {
		calendario?.refetchEvents();
	}

	function alternaStato(stato: string) {
		statiScelti = statiScelti.includes(stato)
			? statiScelti.filter((s) => s !== stato)
			: [...statiScelti, stato];
		applicaFiltri();
	}
</script>

<svelte:head><title>Calendario · Calendario Eventi Condiviso</title></svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">Calendario</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Le date opzionate delle altre organizzazioni si vedono come giorno, città e genere: è quanto
			basta per accorgersi di una sovrapposizione e alzare il telefono.
		</p>
	</div>
	<Button href={resolve('/events/new')}>Nuova data</Button>
</header>

<section aria-label="Filtri" class="border-border mb-6 space-y-4 rounded-lg border p-4">
	<fieldset>
		<legend class="mb-2 text-sm font-medium">Stato</legend>
		<div class="flex flex-wrap gap-3">
			{#each STATI as stato (stato)}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={statiScelti.includes(stato)}
						onchange={() => alternaStato(stato)}
						class="border-input rounded"
					/>
					{ETICHETTE_STATO[stato]}
					{#if stato === 'draft'}
						<span class="text-muted-foreground text-xs">(solo le tue)</span>
					{/if}
				</label>
			{/each}
		</div>
	</fieldset>

	<div class="grid gap-4 sm:grid-cols-3">
		<label class="space-y-1.5 text-sm">
			<span class="font-medium">Genere</span>
			<select
				bind:value={genereScelto}
				onchange={applicaFiltri}
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				<option value="">Tutti</option>
				{#each data.generi as g (g.slug)}
					<option value={g.slug}>{g.name}</option>
				{/each}
			</select>
			<span class="text-muted-foreground block text-xs">Include i sottogeneri.</span>
		</label>

		<label class="space-y-1.5 text-sm">
			<span class="font-medium">Organizzazione</span>
			<select
				bind:value={orgScelta}
				onchange={applicaFiltri}
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				<option value="">Tutte</option>
				{#each data.organizzazioni as o (o.id)}
					<option value={o.id}>{o.name}</option>
				{/each}
			</select>
		</label>

		{#if data.centro}
			<label class="space-y-1.5 text-sm">
				<span class="font-medium">Distanza da {data.centro.etichetta}</span>
				<select
					bind:value={raggio}
					onchange={applicaFiltri}
					class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
				>
					<option value="">Ovunque</option>
					<option value={30}>Entro 30 km</option>
					<option value={data.centro.raggioPredefinito}>
						Entro {data.centro.raggioPredefinito} km
					</option>
					<option value={150}>Entro 150 km</option>
				</select>
			</label>
		{/if}
	</div>
</section>

{#if errore}
	<p class="text-destructive mb-4 text-sm" role="alert">{errore}</p>
{/if}

<div bind:this={contenitore} class="calendario"></div>

<noscript>
	<p class="border-border mt-4 rounded-md border p-3 text-sm">
		Il calendario ha bisogno di JavaScript. Le date restano consultabili una per una dalle pagine di
		dettaglio.
	</p>
</noscript>

<p class="text-muted-foreground mt-4 text-xs">
	Le date in grigio tratteggiato sono opzionate da altre organizzazioni: se ne conosce il giorno, la
	città e il genere, non l'orario né il locale.
</p>

<style>
	/* FullCalendar porta il proprio CSS via JS, con una tavolozza chiara
	   cablata nei valori predefiniti: `--fc-page-bg-color` è `#fff`,
	   `--fc-neutral-bg-color` un grigio chiaro, i pulsanti un blu scuro.
	   Il testo invece eredita il colore del resto della pagina.

	   In tema scuro le due cose si scontrano: l'intestazione delle colonne sta
	   in una riga "appiccicata" che usa `--fc-page-bg-color`, quindi restava
	   bianca sotto un testo bianco — illeggibile.

	   Si rimappano quindi **tutte** le variabili sui token del progetto, non
	   solo quelle che danno fastidio oggi. I token cambiano già da soli con
	   `prefers-color-scheme`, quindi non serve un blocco separato per il tema
	   scuro: mappate una volta, seguono il tema in entrambi i versi.

	   Le variabili vanno su `.calendario` e **non** su `.calendario .fc`:
	   FullCalendar non crea un elemento figlio, aggiunge le proprie classi al
	   contenitore che gli si passa. Il selettore discendente non corrisponde a
	   niente, e per un pezzo qui non ha corrisposto — motivo per cui anche
	   `--fc-border-color`, scritto molto prima, non è mai entrato in vigore. */
	.calendario {
		--fc-page-bg-color: var(--background);
		--fc-neutral-bg-color: var(--muted);
		--fc-neutral-text-color: var(--muted-foreground);
		--fc-border-color: var(--border);
		--fc-today-bg-color: color-mix(in oklab, var(--accent) 40%, transparent);
		--fc-highlight-color: color-mix(in oklab, var(--accent) 50%, transparent);
		--fc-non-business-color: color-mix(in oklab, var(--muted) 50%, transparent);
		--fc-now-indicator-color: var(--destructive);

		--fc-button-bg-color: var(--secondary);
		--fc-button-border-color: var(--border);
		--fc-button-text-color: var(--secondary-foreground);
		--fc-button-hover-bg-color: var(--accent);
		--fc-button-hover-border-color: var(--border);
		--fc-button-active-bg-color: var(--accent);
		--fc-button-active-border-color: var(--border);

		--fc-event-bg-color: var(--primary);
		--fc-event-border-color: var(--primary);
		--fc-event-text-color: var(--primary-foreground);
		--fc-more-link-bg-color: var(--muted);
		--fc-more-link-text-color: var(--muted-foreground);
		--fc-list-event-hover-bg-color: var(--muted);

		color: var(--foreground);
		font-size: 0.875rem;
	}

	/* Le intestazioni di colonna e di giorno sono ancore: senza questo
	   ereditano il colore dei link del browser, che sul fondo scuro è quasi
	   invisibile quanto il bianco su bianco di prima. */
	.calendario :global(.fc-col-header-cell-cushion),
	.calendario :global(.fc-daygrid-day-number),
	.calendario :global(.fc-list-day-text),
	.calendario :global(.fc-list-day-side-text) {
		color: var(--foreground);
		text-decoration: none;
	}

	.calendario :global(.fc-col-header-cell) {
		font-weight: 600;
	}

	.calendario :global(.fc-event) {
		cursor: pointer;
		border-radius: 0.25rem;
		padding: 0 0.25rem;
	}

	/* Lo stato si legge dal bordo e dal tratteggio, non dal solo colore:
	   il colore da solo esclude chi non lo distingue. */
	.calendario :global(.evento--hold) {
		background: transparent;
		border: 1px dashed currentColor;
		color: var(--muted-foreground);
	}

	.calendario :global(.evento--draft) {
		background: transparent;
		border: 1px dotted currentColor;
		color: var(--muted-foreground);
		font-style: italic;
	}

	.calendario :global(.evento--cancelled) {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.calendario :global(.evento--proprio) {
		font-weight: 600;
	}
</style>
