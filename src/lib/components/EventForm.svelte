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
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		DESCRIZIONI_STATO,
		ETICHETTE_LOCANDINA,
		ETICHETTE_STATO,
		type ValoriEvento,
		type VoceLineupForm
	} from '$lib/events';
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
		annullaHref
	}: Props = $props();

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
		// aggancia l'id: è quello che permetterà alla regola sugli artisti
		// sovrapposti, in Fase 3, di accorgersi che è la stessa band.
		const esatto = suggerimenti.find((a) => a.name.toLowerCase() === q.trim().toLowerCase());
		aggiornaVoce(i, { artistId: esatto ? esatto.id : null });
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
</script>

{#if erroreGenerale}
	<p class="text-destructive mb-4 text-sm" role="alert">{erroreGenerale}</p>
{/if}

<form method="POST" class="space-y-8" use:enhance>
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
