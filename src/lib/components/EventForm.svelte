<script lang="ts">
	/**
	 * Il form evento, condiviso fra creazione e modifica.
	 *
	 * È lungo per forza: una serata ha trenta campi. Le due cose che lo rendono
	 * sopportabile sono che quasi tutti sono facoltativi, e che i soli
	 * obbligatori — titolo, data, città — stanno tutti nel primo riquadro.
	 *
	 * La lineup usa nomi indicizzati (`lineup.0.artistName`) invece di un campo
	 * nascosto con dentro del JSON: così resta un form HTML vero, e il server
	 * lo legge con `righeIndicizzate()` senza dipendere dal fatto che
	 * JavaScript sia partito.
	 *
	 * I campi che l'interfaccia deve seguire mentre l'utente scrive (lo stato,
	 * l'ingresso libero, la lineup) tengono una copia locale che parte da
	 * `null` e vale "nessuna modifica": così i valori restano quelli delle
	 * prop finché l'utente non li tocca, e dopo un errore di validazione
	 * ricompare ciò che aveva scritto senza che il componente scriva mai
	 * dentro le prop.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ConflictWarning from '$lib/components/ConflictWarning.svelte';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ORDINE_SEVERITA, type AnteprimaConflitto } from '$lib/conflicts';
	import {
		DESCRIZIONI_STATO,
		ETICHETTE_LOCANDINA,
		ETICHETTE_STATO,
		type ValoriEvento,
		type VoceLineupForm
	} from '$lib/events';
	import { ETICHETTE_MOTIVO, type PropostaArtista } from '$lib/parse';
	import type { EventStatus } from '$lib/server/db/schema';

	type Genere = { slug: string; name: string; path: string; depth: number };
	type Locale = { id: string; name: string; city: string; province: string | null };
	type Organizzazione = { id: string; name: string };

	type Props = {
		valori: ValoriEvento;
		generi: Genere[];
		locali: Locale[];
		organizzazioni: Organizzazione[];
		statiAmmessi: readonly EventStatus[];
		errori?: Record<string, string>;
		erroreGenerale?: string | null;
		etichettaInvio: string;
		annullaHref: string;
		/** Presente in modifica: serve a non far scontrare la data con sé stessa. */
		eventId?: string | null;
		/**
		 * Band lette da un incolla che **potrebbero** essere schede
		 * dell'anagrafica (Fase 5, §9 punto 4).
		 *
		 * Sono proposte, non collegamenti: `artistId` resta vuoto finché
		 * qualcuno non sceglie. Un collegamento sbagliato non si vedrebbe —
		 * il campo mostra comunque il nome giusto — e falserebbe la regola R2,
		 * che confronta gli id e non i nomi (ADR-0031).
		 */
		proposteArtisti?: PropostaArtista[];
		/**
		 * Chiamato quando si cambia organizzazione, per chi sta fuori.
		 *
		 * Serve al pannello dell'incolla: il testo si legge **per conto di
		 * un'organizzazione**, e senza questo il pannello resterebbe fermo alla
		 * prima dell'elenco. Chi appartiene a due circoli sceglierebbe il
		 * secondo, incollerebbe, e si ritroverebbe il form tornato al primo
		 * senza nessun avviso — con il rischio di salvare la data sotto
		 * l'organizzazione sbagliata.
		 */
		onOrganizzazione?: (id: string) => void;
	};

	let {
		valori,
		generi,
		locali,
		organizzazioni,
		statiAmmessi,
		errori = {},
		erroreGenerale = null,
		etichettaInvio,
		annullaHref,
		eventId = null,
		proposteArtisti = [],
		onOrganizzazione
	}: Props = $props();

	/**
	 * Le proposte già evase: una scelta fatta, o messa da parte.
	 *
	 * Sparire dopo la scelta è il comportamento giusto — la proposta ha
	 * esaurito il suo scopo — ma sparire senza che nessuno abbia scelto no:
	 * `Ignora` è un modo di rispondere, e va reso possibile.
	 */
	let proposteEvase = $state<number[]>([]);

	function propostaPer(i: number): PropostaArtista | null {
		if (proposteEvase.includes(i)) return null;
		const p = proposteArtisti.find((x) => x.indice === i);
		// Se il nome nella riga è cambiato, la proposta parlava di un'altra
		// band e non vale più.
		return p && p.nome === lineup[i]?.artistName ? p : null;
	}

	function collega(i: number, candidato: { id: string; name: string }) {
		aggiornaVoce(i, { artistId: candidato.id, artistName: candidato.name });
		proposteEvase = [...proposteEvase, i];
		// `lineup.N.artistId` è ciò su cui lavora la regola R2: cambiandolo si
		// ricontrolla, come dopo una ricerca in anagrafica.
		pianificaAnteprima();
	}

	let statoScelto = $state<EventStatus | null>(null);
	let localeScelto = $state<string | null>(null);
	let cittaScritta = $state<string | null>(null);
	let provinciaScritta = $state<string | null>(null);
	let gratuitoScelto = $state<boolean | null>(null);
	let primarioScelto = $state<string | null>(null);
	let lineupModificata = $state<VoceLineupForm[] | null>(null);
	let linkModificati = $state<{ label: string; url: string }[] | null>(null);

	const stato = $derived(statoScelto ?? valori.status);
	const locale = $derived(localeScelto ?? valori.venueId);
	const citta = $derived(cittaScritta ?? valori.city);
	const provincia = $derived(provinciaScritta ?? valori.province);
	const gratuito = $derived(gratuitoScelto ?? valori.isFree);
	const primario = $derived(primarioScelto ?? valori.primaryGenreSlug);
	const lineup = $derived(lineupModificata ?? valori.lineup);
	const links = $derived(linkModificati ?? valori.links);

	/** Suggerimenti dell'anagrafica per il campo band su cui si sta scrivendo. */
	let suggerimenti = $state<{ id: string; name: string }[]>([]);
	let ultimaRicerca = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const vuota = (): VoceLineupForm => ({
		id: null,
		artistId: null,
		artistName: '',
		billing: 'support',
		stage: '',
		setStartsAtLocal: '',
		isAnnounced: false
	});

	function aggiornaVoce(i: number, modifiche: Partial<VoceLineupForm>) {
		lineupModificata = lineup.map((v, k) => (k === i ? { ...v, ...modifiche } : v));
	}

	function aggiungiVoce() {
		lineupModificata = [...lineup, vuota()];
	}

	function rimuoviVoce(i: number) {
		lineupModificata = lineup.filter((_, k) => k !== i);
		// Togliere una band può far sparire un conflitto: nessun `input` parte
		// da solo quando una riga se ne va, quindi il ricontrollo si chiede a
		// mano. Vedi `pianificaAnteprima`.
		pianificaAnteprima();
	}

	function spostaVoce(i: number, delta: number) {
		const j = i + delta;
		if (j < 0 || j >= lineup.length) return;
		const copia = [...lineup];
		[copia[i], copia[j]] = [copia[j], copia[i]];
		lineupModificata = copia;
	}

	async function cercaArtisti(q: string, i: number) {
		if (q.trim().length < 2) return;
		const richiesta = ++ultimaRicerca;
		const risposta = await fetch(`/api/artists/search?q=${encodeURIComponent(q)}`);
		if (!risposta.ok || richiesta !== ultimaRicerca) return;
		const esito = await risposta.json();
		suggerimenti = esito.locali ?? [];

		// Se il nome scritto coincide con una scheda dell'anagrafica, si
		// aggancia l'id: è quello che permette alla regola R2 di accorgersi
		// che è la stessa band. Senza `artistId` due nomi uguali scritti a
		// mano restano due band diverse (ADR-0006).
		const esatto = suggerimenti.find((a) => a.name.toLowerCase() === q.trim().toLowerCase());
		aggiornaVoce(i, { artistId: esatto ? esatto.id : null });

		// `lineup.N.artistId` è un campo nascosto: quando lo riempie Svelte
		// non parte nessun evento, quindi `forseRicontrolla` non lo vedrebbe
		// mai — ed è proprio il campo da cui dipende R2.
		pianificaAnteprima();
	}

	function suNomeBand(i: number, valore: string) {
		aggiornaVoce(i, { artistName: valore, artistId: null });
		clearTimeout(timer);
		timer = setTimeout(() => cercaArtisti(valore, i), 300);
	}

	/** Un locale scelto porta con sé la sua città: evita di doverla ridigitare. */
	function suLocale(id: string) {
		localeScelto = id;
		const l = locali.find((v) => v.id === id);
		if (l) {
			cittaScritta = l.city;
			provinciaScritta = l.province ?? '';
		}
	}

	const opzioniStato = $derived(
		[...new Set([valori.status, ...statiAmmessi])].map((s) => ({
			value: s,
			label: ETICHETTE_STATO[s]
		}))
	);

	const generiSecondari = $derived(generi.filter((g) => g.slug !== primario));

	/* ---------------- Anteprima dei conflitti (§6.5) ---------------- */

	/**
	 * Il controllo gira mentre si compila, non dopo il salvataggio: un
	 * conflitto scoperto dopo è già una telefonata imbarazzante, uno scoperto
	 * mentre si sceglie la data è solo una data diversa.
	 *
	 * Si manda il form **intero**, con `new FormData(elemento)`, e non un
	 * oggetto ricostruito a mano: il server lo legge con le stesse funzioni con
	 * cui legge un salvataggio, quindi l'anteprima parla per forza della stessa
	 * data che si sta per salvare.
	 */
	let elementoForm: HTMLFormElement;
	let conflitti = $state<AnteprimaConflitto[]>([]);
	let incompleto = $state<string | null>(null);
	let controlloInCorso = $state(false);
	let controlloFatto = $state(false);

	const RITARDO_MS = 600;
	let timerAnteprima: ReturnType<typeof setTimeout> | undefined;
	let ultimaAnteprima = 0;

	async function chiediAnteprima() {
		if (!elementoForm) return;

		const dati = new FormData(elementoForm);
		if (eventId) dati.set('eventId', eventId);

		const richiesta = ++ultimaAnteprima;
		controlloInCorso = true;
		try {
			const risposta = await fetch('/api/conflicts/preview', { method: 'POST', body: dati });
			// Una risposta sorpassata da una più recente si butta: senza questo
			// controllo, la lenta che arriva per ultima sovrascriverebbe la
			// veloce che è arrivata prima.
			if (richiesta !== ultimaAnteprima) return;

			if (!risposta.ok) {
				conflitti = [];
				incompleto = 'Il controllo dei conflitti non ha risposto. Riprova fra un momento.';
				return;
			}

			const esito = await risposta.json();
			conflitti = (esito.conflitti ?? []).sort(
				(a: AnteprimaConflitto, b: AnteprimaConflitto) =>
					ORDINE_SEVERITA[a.severity] - ORDINE_SEVERITA[b.severity]
			);
			incompleto = esito.incompleto ?? null;
			controlloFatto = true;
		} catch {
			if (richiesta !== ultimaAnteprima) return;
			// Degradazione elegante: il motore conflitti è un avviso, non un
			// prerequisito del salvataggio (ADR-0009).
			conflitti = [];
			incompleto =
				'Il controllo dei conflitti non è raggiungibile. Il salvataggio funziona lo stesso.';
		} finally {
			if (richiesta === ultimaAnteprima) controlloInCorso = false;
		}
	}

	/**
	 * Solo i campi che entrano davvero nelle quattro regole fanno ripartire il
	 * controllo. Il titolo, i prezzi e la locandina non cambiano nessun
	 * conflitto, e rilanciare la richiesta a ogni tasto sarebbe un modo di
	 * usare il geocoder senza motivo.
	 */
	const CAMPI_RILEVANTI = [
		'startsAtLocal',
		'endsAtLocal',
		'doorsAtLocal',
		'venueId',
		'city',
		'province',
		'conflictRadiusKm',
		'primaryGenreSlug',
		'secondaryGenreSlugs'
	];

	function rilevante(nome: string): boolean {
		return CAMPI_RILEVANTI.includes(nome) || /^lineup\.\d+\.isAnnounced$/.test(nome);
	}

	/** Ricontrolla fra poco, annullando la richiesta già in coda. */
	function pianificaAnteprima() {
		clearTimeout(timerAnteprima);
		timerAnteprima = setTimeout(chiediAnteprima, RITARDO_MS);
	}

	function forseRicontrolla(evento: Event) {
		const bersaglio = evento.target as HTMLElement & { name?: string };
		if (!bersaglio?.name || !rilevante(bersaglio.name)) return;
		pianificaAnteprima();
	}

	// Un primo controllo all'apertura: in modifica la data c'è già, e chi apre
	// il form per cambiare qualcosa deve vedere subito com'è messa.
	$effect(() => {
		if (eventId) chiediAnteprima();
		return () => clearTimeout(timerAnteprima);
	});
</script>

{#if erroreGenerale}
	<p class="text-destructive mb-4 text-sm" role="alert">{erroreGenerale}</p>
{/if}

<!-- I due gestori stanno sul form e non sui singoli campi: la lineup si
     costruisce mentre si compila, e agganciare a mano ogni input nuovo
     significherebbe dimenticarsene uno. `forseRicontrolla` filtra per nome. -->
<form
	method="POST"
	class="space-y-8"
	use:enhance
	bind:this={elementoForm}
	oninput={forseRicontrolla}
	onchange={forseRicontrolla}
>
	<!-- Dati indispensabili --------------------------------------------- -->
	<fieldset class="border-border space-y-5 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">La serata</legend>

		{#if organizzazioni.length > 1}
			<Field
				label="Organizzazione"
				name="organizationId"
				required
				value={valori.organizationId}
				options={organizzazioni.map((o) => ({ value: o.id, label: o.name }))}
				onInput={(id) => onOrganizzazione?.(id)}
			/>
		{:else}
			<input type="hidden" name="organizationId" value={valori.organizationId} />
		{/if}

		<Field label="Titolo" name="title" required value={valori.title} />
		{#if errori.title}<p class="text-destructive text-xs">{errori.title}</p>{/if}

		<Field label="Sottotitolo" name="subtitle" value={valori.subtitle} />

		<div class="space-y-1.5">
			<label class="text-sm font-medium" for="status">Stato</label>
			<select
				id="status"
				name="status"
				value={stato}
				onchange={(e) => (statoScelto = e.currentTarget.value as EventStatus)}
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				{#each opzioniStato as o (o.value)}
					<option value={o.value}>{o.label}</option>
				{/each}
			</select>
			<p class="text-muted-foreground text-xs">{DESCRIZIONI_STATO[stato]}</p>
			{#if errori.status}<p class="text-destructive text-xs">{errori.status}</p>{/if}
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<div>
				<Field
					label="Inizio"
					name="startsAtLocal"
					type="datetime-local"
					required
					value={valori.startsAtLocal}
					hint="Ora italiana."
				/>
				{#if errori.startsAtLocal}
					<p class="text-destructive text-xs">{errori.startsAtLocal}</p>
				{/if}
			</div>
			<div>
				<Field
					label="Fine stimata"
					name="endsAtLocal"
					type="datetime-local"
					value={valori.endsAtLocal}
					hint="Se la lasci vuota si assumono quattro ore."
				/>
				{#if errori.endsAtLocal}<p class="text-destructive text-xs">{errori.endsAtLocal}</p>{/if}
			</div>
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<div>
				<Field
					label="Apertura porte"
					name="doorsAtLocal"
					type="datetime-local"
					value={valori.doorsAtLocal}
				/>
				{#if errori.doorsAtLocal}<p class="text-destructive text-xs">{errori.doorsAtLocal}</p>{/if}
			</div>
			{#if stato === 'hold'}
				<div>
					<Field
						label="Annuncio previsto"
						name="announceAtLocal"
						type="datetime-local"
						value={valori.announceAtLocal}
						hint="Serve solo a ricordartelo: nessun altro la vede."
					/>
					{#if errori.announceAtLocal}
						<p class="text-destructive text-xs">{errori.announceAtLocal}</p>
					{/if}
				</div>
			{/if}
		</div>

		<label class="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				name="isMultiDay"
				checked={valori.isMultiDay}
				class="border-input rounded"
			/>
			Si svolge su più giorni (festival)
		</label>
	</fieldset>

	<!-- Dove ------------------------------------------------------------ -->
	<fieldset class="border-border space-y-5 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">Dove</legend>

		<div class="space-y-1.5">
			<label class="text-sm font-medium" for="venueId">
				Locale
				<span class="text-muted-foreground font-normal">· facoltativo finché è opzionata</span>
			</label>
			<select
				id="venueId"
				name="venueId"
				value={locale}
				onchange={(e) => suLocale(e.currentTarget.value)}
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				<option value="">Non ancora deciso</option>
				{#each locali as l (l.id)}
					<option value={l.id}>{l.name} — {l.city}{l.province ? ` (${l.province})` : ''}</option>
				{/each}
			</select>
			{#if errori.venueId}<p class="text-destructive text-xs">{errori.venueId}</p>{/if}
			<p class="text-muted-foreground text-xs">
				Manca un locale?
				<a href={resolve('/venues/new')} class="underline underline-offset-4">
					Aggiungilo all'anagrafica
				</a>.
			</p>
		</div>

		<div class="grid gap-5 sm:grid-cols-3">
			<div>
				<Field
					label="Città"
					name="city"
					required
					value={citta}
					onInput={(v) => (cittaScritta = v)}
				/>
				{#if errori.city}<p class="text-destructive text-xs">{errori.city}</p>{/if}
			</div>
			<Field
				label="Provincia"
				name="province"
				value={provincia}
				placeholder="PG"
				onInput={(v) => (provinciaScritta = v)}
			/>
			<Field label="Regione" name="region" value={valori.region} />
		</div>
		<input type="hidden" name="country" value="IT" />

		<div>
			<Field
				label="Raggio di conflitto"
				name="conflictRadiusKm"
				type="number"
				min={1}
				max={500}
				value={valori.conflictRadiusKm}
				hint="In km. Vuoto: si usa quello dell'organizzazione."
			/>
			{#if errori.conflictRadiusKm}
				<p class="text-destructive text-xs">{errori.conflictRadiusKm}</p>
			{/if}
		</div>
	</fieldset>

	<!-- Conflitti ------------------------------------------------------- -->
	<!--
		Sta qui, subito dopo data e luogo, e non in fondo alla pagina: sono
		questi due campi a produrre quasi tutti i conflitti, e serve saperlo
		*prima* di compilare gli altri venticinque. Un avviso alla fine
		arriverebbe quando la data è già stata scelta nella testa di chi scrive.

		Non blocca niente e non ha caselle da spuntare per proseguire
		(ADR-0009, ADR-0022): mostra, e propone di sentirsi.
	-->
	<section
		class="border-border space-y-3 rounded-lg border border-dashed p-4"
		aria-live="polite"
		aria-busy={controlloInCorso}
	>
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-sm font-medium">Sovrapposizioni</h2>
			{#if controlloInCorso}
				<span class="text-muted-foreground text-xs">controllo in corso…</span>
			{/if}
		</div>

		{#if conflitti.length}
			{#each conflitti as c (c.chiave)}
				<ConflictWarning conflitto={c} />
			{/each}
			<p class="text-muted-foreground text-xs">
				Puoi salvare lo stesso: questi avvisi non impediscono niente. Servono a farvi sentire
				adesso, invece che dopo l'annuncio.
			</p>
		{:else if controlloFatto}
			<p class="text-sm">Nessuna sovrapposizione con le date già inserite dagli altri.</p>
		{:else}
			<p class="text-muted-foreground text-sm">
				Scegli data e luogo: il controllo parte da solo e ti dice se qualcun altro ha già qualcosa
				in quella sera.
			</p>
		{/if}

		{#if incompleto}
			<p class="text-muted-foreground text-xs">{incompleto}</p>
		{/if}
	</section>

	<!-- Generi ---------------------------------------------------------- -->
	<fieldset class="border-border space-y-5 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">Generi della serata</legend>
		<p class="text-muted-foreground text-sm">
			Il genere principale è l'unica cosa che le altre organizzazioni vedono di una data opzionata,
			insieme al giorno e alla città.
		</p>

		<div class="space-y-1.5">
			<label class="text-sm font-medium" for="primaryGenreSlug">Genere principale</label>
			<select
				id="primaryGenreSlug"
				name="primaryGenreSlug"
				value={primario}
				onchange={(e) => (primarioScelto = e.currentTarget.value)}
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				<option value="">—</option>
				{#each generi as g (g.slug)}
					<option value={g.slug}>{'  '.repeat(g.depth)}{g.name}</option>
				{/each}
			</select>
			{#if errori.primaryGenreSlug}
				<p class="text-destructive text-xs">{errori.primaryGenreSlug}</p>
			{/if}
		</div>

		<fieldset>
			<legend class="mb-2 text-sm font-medium">
				Altri generi <span class="text-muted-foreground font-normal">· facoltativo</span>
			</legend>
			<div class="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
				{#each generiSecondari as g (g.slug)}
					<label class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							name="secondaryGenreSlugs"
							value={g.slug}
							checked={valori.secondaryGenreSlugs.includes(g.slug)}
							class="border-input rounded"
						/>
						{g.name}
					</label>
				{/each}
			</div>
			{#if errori.secondaryGenreSlugs}
				<p class="text-destructive text-xs">{errori.secondaryGenreSlugs}</p>
			{/if}
		</fieldset>
	</fieldset>

	<!-- Lineup ---------------------------------------------------------- -->
	<fieldset class="border-border space-y-4 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">Lineup</legend>
		<p class="text-muted-foreground text-sm">
			Una band resta invisibile alle altre organizzazioni finché non la marchi come annunciata,
			qualunque sia lo stato della data.
		</p>

		<datalist id="anagrafica-artisti">
			{#each suggerimenti as a (a.id)}
				<option value={a.name}></option>
			{/each}
		</datalist>

		{#each lineup as voce, i (i)}
			<div class="border-border space-y-3 rounded-md border p-3">
				<div class="flex items-start gap-2">
					<div class="flex-1 space-y-1.5">
						<label class="text-sm font-medium" for={`lineup-${i}-nome`}>Band</label>
						<input
							id={`lineup-${i}-nome`}
							name={`lineup.${i}.artistName`}
							list="anagrafica-artisti"
							value={voce.artistName}
							oninput={(e) => suNomeBand(i, e.currentTarget.value)}
							placeholder="Nome, oppure TBA"
							class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
						/>
						<input type="hidden" name={`lineup.${i}.artistId`} value={voce.artistId ?? ''} />
						<input type="hidden" name={`lineup.${i}.id`} value={voce.id ?? ''} />
						{#if voce.artistId}
							<p class="text-muted-foreground text-xs">Collegata all'anagrafica condivisa.</p>
						{/if}
						{#if errori[`lineup.${i}.artistName`]}
							<p class="text-destructive text-xs">{errori[`lineup.${i}.artistName`]}</p>
						{/if}

						<!-- Proposte dell'incolla (§9 punto 4). Il collegamento non
						     avviene mai da solo: sbagliarlo non si vedrebbe nel form,
						     perché il nome resterebbe quello giusto, e falserebbe la
						     regola R2, che confronta gli id (ADR-0031). -->
						{#if propostaPer(i)}
							{@const proposta = propostaPer(i)!}
							<div class="border-border bg-muted/40 mt-2 space-y-2 rounded-md border p-2">
								<p class="text-muted-foreground text-xs">
									In anagrafica {proposta.candidati.length === 1
										? 'c’è una scheda che potrebbe essere questa band'
										: 'ci sono schede che potrebbero essere questa band'}:
								</p>
								<div class="flex flex-wrap items-center gap-2">
									{#each proposta.candidati as c (c.id)}
										<button
											type="button"
											onclick={() => collega(i, c)}
											class="border-input hover:bg-background rounded border px-2 py-1 text-xs"
										>
											{c.name}
											<span class="text-muted-foreground">· {ETICHETTE_MOTIVO[c.motivo]}</span>
										</button>
									{/each}
									<button
										type="button"
										onclick={() => (proposteEvase = [...proposteEvase, i])}
										class="text-muted-foreground px-2 py-1 text-xs underline underline-offset-4"
									>
										Nessuna di queste
									</button>
								</div>
							</div>
						{/if}
					</div>

					<div class="flex gap-1 pt-6">
						<button
							type="button"
							onclick={() => spostaVoce(i, -1)}
							aria-label="Sposta su"
							class="border-input rounded border px-2 py-1 text-xs"
						>
							↑
						</button>
						<button
							type="button"
							onclick={() => spostaVoce(i, 1)}
							aria-label="Sposta giù"
							class="border-input rounded border px-2 py-1 text-xs"
						>
							↓
						</button>
						<button
							type="button"
							onclick={() => rimuoviVoce(i)}
							aria-label="Rimuovi dalla lineup"
							class="border-input rounded border px-2 py-1 text-xs"
						>
							✕
						</button>
					</div>
				</div>

				<div class="grid gap-3 sm:grid-cols-3">
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for={`lineup-${i}-billing`}>In locandina</label>
						<select
							id={`lineup-${i}-billing`}
							name={`lineup.${i}.billing`}
							value={voce.billing}
							onchange={(e) =>
								aggiornaVoce(i, { billing: e.currentTarget.value as VoceLineupForm['billing'] })}
							class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
						>
							{#each Object.entries(ETICHETTE_LOCANDINA) as [valore, etichetta] (valore)}
								<option value={valore}>{etichetta}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for={`lineup-${i}-palco`}>Palco</label>
						<input
							id={`lineup-${i}-palco`}
							name={`lineup.${i}.stage`}
							value={voce.stage}
							oninput={(e) => aggiornaVoce(i, { stage: e.currentTarget.value })}
							class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
						/>
					</div>
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for={`lineup-${i}-set`}>Orario del set</label>
						<input
							id={`lineup-${i}-set`}
							type="datetime-local"
							name={`lineup.${i}.setStartsAtLocal`}
							value={voce.setStartsAtLocal}
							oninput={(e) => aggiornaVoce(i, { setStartsAtLocal: e.currentTarget.value })}
							class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
						/>
					</div>
				</div>

				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name={`lineup.${i}.isAnnounced`}
						checked={voce.isAnnounced}
						onchange={(e) => aggiornaVoce(i, { isAnnounced: e.currentTarget.checked })}
						class="border-input rounded"
					/>
					Già annunciata pubblicamente
				</label>
			</div>
		{/each}

		<Button type="button" variant="outline" onclick={aggiungiVoce}>Aggiungi band</Button>
	</fieldset>

	<!-- Ingresso -------------------------------------------------------- -->
	<fieldset class="border-border space-y-5 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">Ingresso</legend>

		<div class="flex flex-wrap gap-6">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="isFree"
					checked={gratuito}
					onchange={(e) => (gratuitoScelto = e.currentTarget.checked)}
					class="border-input rounded"
				/>
				Ingresso libero
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="isMembersOnly"
					checked={valori.isMembersOnly}
					class="border-input rounded"
				/>
				Riservato ai tesserati
			</label>
		</div>
		{#if errori.isFree}<p class="text-destructive text-xs">{errori.isFree}</p>{/if}

		{#if !gratuito}
			<div class="grid gap-5 sm:grid-cols-2">
				<Field label="Prezzo in prevendita" name="pricePresale" value={valori.pricePresale} />
				<Field label="Prezzo alla porta" name="priceDoor" value={valori.priceDoor} />
			</div>
		{/if}
		<input type="hidden" name="currency" value="EUR" />

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Link ai biglietti" name="ticketUrl" value={valori.ticketUrl} />
			<Field label="Età minima" name="ageRestriction" value={valori.ageRestriction} />
		</div>

		<Field
			label="Pubblico atteso"
			name="capacityExpected"
			type="number"
			min={1}
			value={valori.capacityExpected}
		/>
	</fieldset>

	<!-- Materiali ------------------------------------------------------- -->
	<fieldset class="border-border space-y-5 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">Materiali e link</legend>

		<Field label="Descrizione" name="description" rows={5} value={valori.description} />
		<Field label="Locandina (URL)" name="posterUrl" value={valori.posterUrl} />

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Evento Facebook" name="facebookEventUrl" value={valori.facebookEventUrl} />
			<Field label="Post Instagram" name="instagramPostUrl" value={valori.instagramPostUrl} />
		</div>
		<Field label="Altro link principale" name="externalUrl" value={valori.externalUrl} />

		{#each links as link, i (i)}
			<div class="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
				<input
					name={`links.${i}.label`}
					value={link.label}
					placeholder="Etichetta"
					aria-label="Etichetta del link"
					class="border-input bg-background rounded-md border px-3 py-2 text-sm"
				/>
				<input
					name={`links.${i}.url`}
					value={link.url}
					placeholder="https://"
					aria-label="Indirizzo del link"
					class="border-input bg-background rounded-md border px-3 py-2 text-sm"
				/>
				<button
					type="button"
					onclick={() => (linkModificati = links.filter((_, k) => k !== i))}
					class="border-input rounded border px-2 text-xs"
					aria-label="Rimuovi link"
				>
					✕
				</button>
				{#if errori[`links.${i}.url`]}
					<p class="text-destructive text-xs sm:col-span-3">{errori[`links.${i}.url`]}</p>
				{/if}
			</div>
		{/each}

		<Button
			type="button"
			variant="outline"
			onclick={() => (linkModificati = [...links, { label: '', url: '' }])}
		>
			Aggiungi link
		</Button>
	</fieldset>

	<!-- Riservato ------------------------------------------------------- -->
	<fieldset class="border-border space-y-5 rounded-lg border p-4">
		<legend class="px-1 text-sm font-medium">Solo per la tua organizzazione</legend>
		<Field
			label="Note interne"
			name="internalNotes"
			rows={4}
			value={valori.internalNotes}
			hint="Cachet, accordi, promemoria. Non escono mai dalla tua organizzazione, in nessuno stato."
		/>
	</fieldset>

	{#if conflitti.length}
		<p class="text-sm">
			{conflitti.length === 1
				? 'C’è una sovrapposizione'
				: `Ci sono ${conflitti.length} sovrapposizioni`}
			con le date di altri, più su in questa pagina. Il salvataggio procede comunque.
		</p>
	{/if}

	<div class="flex flex-wrap items-center gap-3">
		<Button type="submit">{etichettaInvio}</Button>
		<!-- `annullaHref` arriva già risolto da chi usa il componente: la regola
		     non riesce a vederlo attraverso la prop. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={annullaHref} class="text-muted-foreground text-sm underline underline-offset-4">
			Annulla
		</a>
	</div>
</form>
