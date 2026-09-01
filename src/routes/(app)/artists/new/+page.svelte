<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import { OPZIONI_BACKLINE, OPZIONI_VOLUME } from '$lib/scheda';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `ActionData` è l'unione di tutti gli esiti dell'action: leggere un campo
	// dopo un `{#if}` fa restringere il tipo in modi poco utili dentro il
	// template. Estrarli qui una volta è più leggibile e compila.
	const errore = $derived(form && 'error' in form ? form.error : null);
	const vaiA = $derived(form && 'vaiA' in form ? form.vaiA : null);
	const doppioni = $derived(form && 'doppioni' in form ? (form.doppioni ?? []) : []);

	let submitting = $state(false);
	let nome = $state('');
	let mbid = $state('');
	let paese = $state('');
	let anno = $state('');
	let statoMb = $state<'idle' | 'cerco' | 'fatto'>('idle');
	let risultatiMb = $state<
		Array<{
			mbid: string;
			name: string;
			descrizione: string;
			country: string | null;
			beginYear: number | null;
			giaPresente: boolean;
		}>
	>([]);

	/**
	 * MusicBrainz ammette una richiesta al secondo: la cerchiamo su richiesta
	 * esplicita, non a ogni tasto premuto.
	 */
	async function cercaMusicBrainz() {
		if (nome.trim().length < 2) return;
		statoMb = 'cerco';
		try {
			const res = await fetch(`/api/artists/search?remote=1&q=${encodeURIComponent(nome.trim())}`);
			const dati = await res.json();
			risultatiMb = dati.remoti ?? [];
		} catch {
			risultatiMb = [];
		}
		statoMb = 'fatto';
	}

	function collega(r: (typeof risultatiMb)[number]) {
		mbid = r.mbid;
		nome = r.name;
		if (r.country) paese = r.country;
		if (r.beginYear) anno = String(r.beginYear);
		risultatiMb = [];
		statoMb = 'idle';
	}
</script>

<svelte:head><title>Nuovo artista · Calendario Eventi Condiviso</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<header class="mb-6 space-y-2">
		<h1 class="text-xl font-semibold tracking-tight">Nuovo artista</h1>
		<p class="text-muted-foreground text-sm">
			Collegare la band a MusicBrainz è la cosa più utile che puoi fare qui: è ciò che permette a
			due band omonime di coesistere, e al calendario di accorgersi che la stessa band suona due
			volte in zona.
		</p>
	</header>

	{#if errore}
		<p class="text-destructive mb-4 text-sm" role="alert">
			{errore}
			{#if vaiA}
				<a href={resolve(`/artists/${vaiA}`)} class="underline underline-offset-4"
					>Vai alla scheda</a
				>
			{/if}
		</p>
	{/if}

	{#if doppioni.length}
		<div class="border-border bg-card mb-6 rounded-lg border p-4">
			<p class="text-sm font-medium">Forse esiste già</p>
			<ul class="mt-2 space-y-1 text-sm">
				{#each doppioni as d (d.id)}
					<li>
						<a href={resolve(`/artists/${d.id}`)} class="underline underline-offset-4">{d.name}</a>
						<span class="text-muted-foreground text-xs">
							— {d.motivo === 'nome-identico' ? 'stesso nome' : 'nome molto simile'}
						</span>
					</li>
				{/each}
			</ul>
			<p class="text-muted-foreground mt-2 text-xs">
				Se è davvero un'altra band, conferma qui sotto. Meglio ancora: collegala a MusicBrainz, così
				resta distinguibile per sempre.
			</p>
		</div>
	{/if}

	<form
		method="POST"
		class="space-y-5"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<Field label="Nome" name="name" required bind:value={nome} />

		<div class="border-border rounded-lg border p-4">
			<div class="flex flex-wrap items-center gap-3">
				<Button type="button" variant="outline" onclick={cercaMusicBrainz}>
					Cerca su MusicBrainz
				</Button>
				<p class="text-muted-foreground text-sm">
					{#if statoMb === 'cerco'}
						Cerco…
					{:else if statoMb === 'fatto' && risultatiMb.length === 0}
						Nessun risultato. Puoi inserirla lo stesso.
					{:else if mbid}
						Collegata: <code class="text-xs">{mbid}</code>
					{:else}
						Facoltativo, ma consigliato.
					{/if}
				</p>
			</div>

			{#if risultatiMb.length}
				<ul class="divide-border mt-3 divide-y text-sm">
					{#each risultatiMb as r (r.mbid)}
						<li class="flex flex-wrap items-baseline gap-2 py-2">
							<span class="font-medium">{r.name}</span>
							{#if r.descrizione}
								<span class="text-muted-foreground text-xs">{r.descrizione}</span>
							{/if}
							<span class="ml-auto">
								{#if r.giaPresente}
									<span class="text-muted-foreground text-xs">già in anagrafica</span>
								{:else}
									<Button type="button" size="xs" variant="outline" onclick={() => collega(r)}>
										Collega
									</Button>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="mt-4">
				<Field
					label="MusicBrainz ID"
					name="mbid"
					bind:value={mbid}
					hint="Si compila da solo scegliendo un risultato qui sopra."
				/>
			</div>
		</div>

		<div class="grid gap-5 sm:grid-cols-3">
			<Field label="Paese" name="country" placeholder="IT" bind:value={paese} />
			<Field label="Città" name="city" />
			<Field label="Anno di formazione" name="formedYear" type="number" bind:value={anno} />
		</div>

		<div class="space-y-1.5">
			<span class="text-sm font-medium">
				Generi <span class="text-muted-foreground font-normal">· facoltativo</span>
			</span>
			<select
				name="genreSlugs"
				multiple
				size="8"
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				{#each data.generi as g (g.slug)}
					<option value={g.slug}>{' '.repeat(g.depth * 3)}{g.name}</option>
				{/each}
			</select>
			<p class="text-muted-foreground text-xs">
				Il primo selezionato è il primario. Tieni premuto Ctrl (o Cmd) per sceglierne più di uno.
			</p>
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Email booking" name="bookingEmail" type="email" />
			<Field label="Agenzia booking" name="bookingAgency" />
			<Field label="Bandcamp" name="bandcampUrl" type="url" />
			<Field label="Sito" name="websiteUrl" type="url" />
			<Field label="Instagram" name="instagramUrl" type="url" />
			<Field label="Facebook" name="facebookUrl" type="url" />
			<Field label="Spotify" name="spotifyUrl" type="url" />
			<Field label="YouTube" name="youtubeUrl" type="url" />
		</div>

		<!-- I fatti dichiarati della scheda operativa: si leggono da un rider e
		     valgono per chiunque la ingaggi (ADR-0048). Stanno anche qui e non
		     solo nella modifica, perché chi inserisce una band di solito ha il
		     rider davanti proprio in quel momento. Il prezzo non c'è e non ci
		     starà: quello si annota da una data passata. -->
		<fieldset class="border-border space-y-4 rounded-md border p-4">
			<legend class="px-1 text-sm font-medium">Scheda operativa</legend>
			<p class="text-muted-foreground text-xs">
				Facoltativi, e si aggiungono anche dopo. Quello che è successo in una serata — cachet,
				minuti suonati — non si scrive qui ma dalla data, quando è passata.
			</p>
			<div class="grid gap-5 sm:grid-cols-2">
				<Field label="Volume attrezzatura" name="volumeAttrezzatura" options={OPZIONI_VOLUME} />
				<Field label="Backline richiesta" name="richiedeBackline" options={OPZIONI_BACKLINE} />
				<Field
					label="Persone in viaggio"
					name="personeInViaggio"
					type="number"
					min={1}
					max={60}
					hint="Band più tecnici: è il numero che decide cena e posti letto."
				/>
				<Field
					label="Durata massima del set"
					name="durataSetMaxDichiarata"
					type="number"
					min={1}
					max={600}
					hint="Minuti, come da rider."
				/>
			</div>
		</fieldset>

		<Field label="Note" name="bio" rows={3} />

		<div class="flex flex-wrap gap-3">
			<Button type="submit" size="lg" disabled={submitting}>
				{submitting ? 'Salvataggio…' : 'Salva artista'}
			</Button>
			{#if doppioni.length}
				<Button type="submit" size="lg" variant="outline" name="confermaDoppione" value="1">
					È un'altra band, salva comunque
				</Button>
			{/if}
		</div>
	</form>
</div>
