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

	/**
	 * Sotto `md:` il calendario cambia forma, e non per stile.
	 *
	 * La griglia del mese su un telefono dà colonne da circa 34px: ci sta il
	 * numero del giorno e nient'altro, e il titolo di una data non ci entra in
	 * nessun modo. Non è una vista poco leggibile da migliorare col CSS, è una
	 * vista che su quella larghezza non può funzionare. `listMonth` mostra le
	 * stesse date per esteso — giorno, titolo, città, organizzazione — e nasce
	 * già in colonna.
	 */
	const STRETTO = '(max-width: 767px)';
	let compatto = $state(false);
	let vista = $state<string>('dayGridMonth');

	/**
	 * L'ultima vista guardata a schermo largo, per rimetterla quando si torna
	 * larghi. Non è `$state`: la legge solo il gestore del breakpoint, e farne
	 * uno stato la renderebbe una dipendenza dell'effetto qui sotto — che a
	 * quel punto ricostruirebbe il calendario per ricordarsene.
	 */
	let vistaDaLarghi = 'dayGridMonth';

	const VISTE = [
		{ id: 'dayGridMonth', label: 'Mese' },
		{ id: 'timeGridWeek', label: 'Settimana' },
		{ id: 'listMonth', label: 'Elenco' }
	] as const;

	/**
	 * Due barre diverse, perché quella da desktop sul telefono collassava.
	 *
	 * `left: 'prev,next oggi'` sono **due gruppi** nello stesso angolo: sotto i
	 * 400px il secondo usciva dal primo e si sovrapponeva al suo bordo, e il
	 * titolo andava a capo addosso ai pulsanti di vista. Su mobile l'angolo
	 * sinistro tiene una cosa sola, e la scelta della vista esce del tutto dalla
	 * barra di FullCalendar per diventare un controllo nostro a tutta larghezza:
	 * tre pulsanti larghi invece di tre francobolli attaccati.
	 */
	const barra = (stretto: boolean) =>
		stretto
			? { left: 'prev,next', center: 'title', right: 'oggi' }
			: {
					left: 'prev,next oggi',
					center: 'title',
					right: 'dayGridMonth,timeGridWeek,listMonth'
				};

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
		const stretto = window.matchMedia(STRETTO).matches;
		compatto = stretto;

		calendario = new Calendar(contenitore, {
			plugins: [dayGridPlugin, timeGridPlugin, listPlugin],
			locale: itLocale,
			// Il fuso è quello del prodotto, non quello del browser: un
			// organizzatore in viaggio deve vedere gli stessi orari di sempre.
			timeZone: 'Europe/Rome',
			initialView: stretto ? 'listMonth' : 'dayGridMonth',
			headerToolbar: barra(stretto),
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
			// Tiene allineato il selettore di vista qui sotto con quella davvero
			// in pagina, anche quando a cambiarla è FullCalendar da solo.
			datesSet: (info) => {
				vista = info.view.type;
				// A schermo largo la vista in pagina è anche quella scelta: si
				// annota, perché è quella a cui tornare dopo un giro sotto il
				// breakpoint. `untrack` per il motivo di `caricaEventi`: qui si è
				// dentro `render()`, cioè dentro l'effetto che costruisce il
				// calendario, e leggere `compatto` senza lo farebbe ricostruire
				// tutto proprio mentre si attraversa il breakpoint.
				if (!untrack(() => compatto)) vistaDaLarghi = info.view.type;
			},
			eventClick: (info) => {
				info.jsEvent.preventDefault();
				goto(resolve(`/events/${info.event.id}`));
			},
			eventDidMount: (info) => {
				const p = info.event.extendedProps as EventoCalendario['extendedProps'];
				const luogo = [p.citta, p.provincia && `(${p.provincia})`].filter(Boolean).join(' ');
				const descrizione = p.ridotto
					? `${p.statusEtichetta} · ${luogo} · ${p.organizzazione} — data opzionata: orario, locale e lineup non sono visibili`
					: `${p.statusEtichetta} · ${luogo}${p.locale ? ` · ${p.locale}` : ''} · ${p.organizzazione}`;

				info.el.title = descrizione;

				/**
				 * Lo stesso testo come **nome accessibile**, e non solo come
				 * tooltip: un `title` non lo legge nessuno screen reader in
				 * modo affidabile, e senza, la voce del calendario si annuncia
				 * come il solo titolo — che per una data opzionata altrui è
				 * "Metal · Associazione X", cioè non dice né quando né dove.
				 *
				 * Comprende il titolo perché `aria-label` sostituisce il
				 * contenuto, non lo affianca.
				 */
				info.el.setAttribute('aria-label', `${info.event.title} — ${descrizione}`);

				/**
				 * Nella vista elenco lo stato si **scrive**.
				 *
				 * Nelle viste a griglia si legge dal tratteggio del bordo, ma una
				 * voce di elenco è una riga di tabella: un bordo tratteggiato
				 * attorno a un `<tr>` non si disegna in modo affidabile, e sotto
				 * `md:` l'elenco è la vista predefinita — cioè quella dove chi
				 * apre l'applicazione dal telefono passa tutto il tempo. Perdere
				 * lì la differenza fra una data confermata e una opzionata
				 * significherebbe perderla e basta.
				 *
				 * È un elemento vero e non uno `::after`: così lo legge anche chi
				 * ascolta la pagina, e usa le stesse parole di `ETICHETTE_STATO`.
				 */
				if (info.view.type.startsWith('list') && p.status !== 'confirmed') {
					const titolo = info.el.querySelector('.fc-list-event-title');
					if (titolo) {
						const etichetta = document.createElement('span');
						etichetta.className = 'stato-elenco';
						etichetta.textContent = p.statusEtichetta;
						titolo.append(' ', etichetta);
					}
				}
			}
		});

		calendario.render();
		return () => calendario?.destroy();
	});

	/**
	 * Attraversare il breakpoint, senza ricostruire il calendario.
	 *
	 * Sul telefono succede ruotandolo; su un desktop, restringendo la finestra.
	 * La barra segue sempre la larghezza, e la **vista** anche: a schermo
	 * stretto nessuna delle due viste a griglia sta in larghezza, quindi si
	 * scende sempre all'elenco; risalendo si rimette quella di prima.
	 *
	 * Il ritorno guarda `vistaDaLarghi` e non la sola larghezza, perché
	 * l'elenco non è per forza una vista imposta: chi lo sceglie a schermo
	 * largo se lo ritrova, e chi tocca "Mese" da stretto se lo tiene tornando
	 * largo, perché in quel caso la vista in pagina non è più l'elenco e non
	 * c'è niente da annullare. Si annulla solo il passaggio che avevamo
	 * forzato noi.
	 */
	$effect(() => {
		const mq = window.matchMedia(STRETTO);
		const cambia = (e: MediaQueryListEvent) => {
			compatto = e.matches;
			const cal = untrack(() => calendario);
			if (!cal) return;
			cal.setOption('headerToolbar', barra(e.matches));
			if (e.matches) {
				if (cal.view.type !== 'listMonth') cal.changeView('listMonth');
			} else if (cal.view.type === 'listMonth') {
				cal.changeView(vistaDaLarghi);
			}
		};
		mq.addEventListener('change', cambia);
		return () => mq.removeEventListener('change', cambia);
	});

	/**
	 * I filtri partono chiusi solo dove rubano lo schermo.
	 *
	 * Aperti occupano circa 310px: sul telefono erano tutto ciò che si vedeva
	 * aprendo il calendario, e del calendario restava una riga di griglia
	 * tagliata in fondo. Sopra `md:` non danno fastidio a nessuno e restano
	 * aperti, come sono sempre stati.
	 */
	let filtriAperti = $derived(!compatto);

	/** Quanti filtri restringono davvero l'elenco, per dirlo a pannello chiuso. */
	const filtriAttivi = $derived(
		(statiScelti.length !== STATI.length ? 1 : 0) +
			(genereScelto ? 1 : 0) +
			(orgScelta ? 1 : 0) +
			(raggio ? 1 : 0)
	);

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

<header class="mb-4 flex flex-wrap items-start justify-between gap-4 sm:mb-6">
	<div>
		<h1 class="text-lg font-semibold tracking-tight sm:text-xl">Calendario</h1>
		<!--
			Nascosta sotto `sm:`, e non è un taglio di contenuto: la nota in fondo
			alla pagina dice la stessa cosa — che delle date opzionate altrui si
			vede il giorno, la città e il genere — ed è lì che serve, accanto alle
			date tratteggiate che descrive. Tenerle tutte e due su un telefono
			significa spendere tre righe di schermo per ripetersi prima ancora di
			mostrare qualcosa.
		-->
		<p class="text-muted-foreground mt-1 hidden max-w-2xl text-sm sm:block">
			Le date opzionate delle altre organizzazioni si vedono come giorno, città e genere: è quanto
			basta per accorgersi di una sovrapposizione e alzare il telefono.
		</p>
	</div>
	<!--
		Sotto `md:` la stessa azione sta nella barra in basso, sotto il pollice.
		Due porte per la stessa stanza, a mezzo metro di distanza, si scambiano
		per due stanze.
	-->
	<div class="hidden gap-2 md:flex">
		<!--
			La segnalazione sta accanto e non dentro "Nuova data": sono due gesti
			diversi — una è la propria data, l'altra è quella di un estraneo — e
			un interruttore dentro il form lungo li farebbe confondere proprio a
			chi ha fretta (ADR-0044).
		-->
		<Button href={resolve('/events/segnala')} variant="outline">Segnala una data</Button>
		<Button href={resolve('/events/new')}>Nuova data</Button>
	</div>
</header>

<details bind:open={filtriAperti} class="border-border mb-4 rounded-lg border sm:mb-6">
	<summary
		class="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium select-none md:hidden [&::-webkit-details-marker]:hidden"
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			class="size-4 shrink-0"
			style={filtriAperti ? 'transform: rotate(90deg)' : ''}
			aria-hidden="true"
		>
			<path d="M9 6l6 6-6 6" />
		</svg>
		Filtri
		{#if filtriAttivi > 0}
			<span class="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
				{filtriAttivi} attiv{filtriAttivi === 1 ? 'o' : 'i'}
			</span>
		{/if}
	</summary>

	<fieldset class="space-y-4 px-4 pt-1 pb-4 md:pt-4">
		<legend class="sr-only">Filtri del calendario</legend>

		<fieldset>
			<legend class="mb-1 text-sm font-medium sm:mb-2">Stato</legend>
			<div class="flex flex-wrap gap-x-4 gap-y-1">
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
	</fieldset>
</details>

{#if errore}
	<p class="text-destructive mb-4 text-sm" role="alert">{errore}</p>
{/if}

<!--
	Il selettore di vista, solo sotto `md:`: sopra resta quello di FullCalendar
	nell'angolo destro della barra, dov'è sempre stato.
	`aria-pressed` e non `aria-current`: non sono destinazioni, sono tre
	interruttori di cui uno solo è premuto.
-->
<div role="group" aria-label="Vista del calendario" class="mb-3 md:hidden">
	<div class="border-border grid grid-cols-3 gap-1 rounded-lg border p-1">
		{#each VISTE as v (v.id)}
			<button
				type="button"
				aria-pressed={vista === v.id}
				onclick={() => calendario?.changeView(v.id)}
				class={[
					'rounded-md px-2 py-2 text-sm',
					vista === v.id
						? 'bg-secondary text-secondary-foreground font-medium'
						: 'text-muted-foreground'
				]}
			>
				{v.label}
			</button>
		{/each}
	</div>
</div>

<div bind:this={contenitore} class="calendario"></div>

<noscript>
	<p class="border-border mt-4 rounded-md border p-3 text-sm">
		Il calendario ha bisogno di JavaScript. Le date restano consultabili una per una dalle pagine di
		dettaglio.
	</p>
</noscript>

<!--
	La legenda nomina tutte e due le forme, perché sotto `md:` la vista
	predefinita è l'elenco e lì il tratteggio non c'è: dire solo "in grigio
	tratteggiato" significherebbe descrivere una schermata che chi legge dal
	telefono non ha davanti.
-->
<p class="text-muted-foreground mt-4 text-xs">
	Delle date opzionate da altre organizzazioni si conosce il giorno, la città e il genere: non
	l'orario, non il locale. Nell'elenco si riconoscono dall'etichetta accanto al titolo, nella
	griglia dal bordo tratteggiato.
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
	   il colore da solo esclude chi non lo distingue.

	   Queste due voci hanno sfondo trasparente, quindi il testo poggia sulla
	   cella e va tinto di conseguenza. Non basta però `color` sull'elemento
	   esterno: gli eventi resi a blocco — le date opzionate altrui, che sono
	   "tutto il giorno" perché l'orario non si vede — contengono un
	   `.fc-event-main` che FullCalendar dipinge con `--fc-event-text-color`,
	   pensato per il testo *sopra* uno sfondo pieno. Quel valore vince sul
	   `color` ereditato. Si riscrive quindi la variabile sull'evento stesso,
	   così scende anche nell'elemento interno. */
	.calendario :global(.evento--hold) {
		--fc-event-text-color: var(--muted-foreground);
		background: transparent;
		border: 1px dashed currentColor;
		color: var(--muted-foreground);
	}

	.calendario :global(.evento--draft) {
		--fc-event-text-color: var(--muted-foreground);
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

	/* Nella vista elenco le quattro regole qui sopra colpiscono una riga di
	   tabella: il bordo tratteggiato non si disegna in modo affidabile su un
	   `<tr>`, e il `line-through` di una data annullata cancellerebbe anche
	   l'ora nella sua colonna. Lì lo stato lo dice l'etichetta che
	   `eventDidMount` aggiunge al titolo. */
	.calendario :global(.fc-list-event) {
		border: 0;
	}

	.calendario :global(.fc-list-event.evento--cancelled) {
		text-decoration: none;
	}

	.calendario :global(.fc-list-event.evento--cancelled) :global(.fc-list-event-title) {
		text-decoration: line-through;
	}

	.calendario :global(.stato-elenco) {
		/* `inline-block` non è cosmetico: `text-decoration` si propaga ai
		   discendenti e **non si annulla dall'interno**, quindi su una data
		   annullata la riga barrata attraversava anche questa etichetta. Un
		   riquadro inline-block apre un contesto nuovo e la barratura si ferma
		   al titolo, che è la cosa annullata. */
		display: inline-block;
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		padding: 0 0.3rem;
		font-size: 0.6875rem;
		font-style: normal;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		text-decoration: none;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	/* La barra, sotto `md:`.

	   Il titolo predefinito è `1.75em`: con "agosto 2026" andava a capo su due
	   righe e la seconda finiva addosso ai pulsanti dell'angolo destro. Il
	   margine sotto è `1.5em`, quasi 40px su uno schermo dove lo spazio
	   verticale è la risorsa scarsa.

	   `!important` perché i selettori di FullCalendar sono più specifici di
	   quanto possa esserlo una regola scoped di Svelte: `.fc .fc-toolbar.fc-header-toolbar`
	   sta a tre classi, e non c'è modo di pareggiarlo dall'esterno senza
	   inseguirlo. */
	@media (max-width: 767px) {
		.calendario :global(.fc-toolbar-title) {
			font-size: 1.05rem !important;
		}

		.calendario :global(.fc-header-toolbar) {
			margin-bottom: 0.75rem !important;
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		/* L'elenco è la vista predefinita sul telefono: le sue righe portano il
		   testo che nelle celle non entrava, e vanno lette comode. */
		.calendario :global(.fc-list-event-title) {
			line-height: 1.4;
		}
	}
</style>
