<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ETICHETTE_STATO } from '$lib/events';
	import { STATI_FEED_PREDEFINITI, type StatoFeed } from '$lib/schemas/feed';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const urlFeed = (token: string) => `${data.baseUrl}/api/ics/${token}.ics`;

	const FORMATI = [
		{ formato: 'json', etichetta: 'Scarica JSON', nota: 'struttura completa, per il reimport' },
		{ formato: 'csv', etichetta: 'Scarica CSV', nota: 'una riga per data, lineup concatenata' },
		{
			formato: 'jsonld',
			etichetta: 'Scarica JSON-LD',
			nota: 'solo le date annunciate, in schema.org/MusicEvent'
		}
	] as const;

	const urlExport = (formato: string) => `${resolve('/api/export')}?format=${formato}`;

	const stati: StatoFeed[] = STATI_FEED_PREDEFINITI;

	let copiato = $state<string | null>(null);

	async function copia(token: string) {
		try {
			await navigator.clipboard.writeText(urlFeed(token));
			copiato = token;
			setTimeout(() => (copiato = null), 2500);
		} catch {
			// Senza permesso sugli appunti resta il campo di testo accanto, che
			// è selezionabile: non serve nessun messaggio d'errore.
		}
	}

	const dataBreve = (d: Date | string | null) =>
		d
			? new Intl.DateTimeFormat('it-IT', {
					dateStyle: 'medium',
					timeStyle: 'short',
					timeZone: 'Europe/Rome'
				}).format(new Date(d))
			: null;

	function descriviFiltri(f: PageData['feeds'][number]['filtri']): string {
		const parti: string[] = [];
		parti.push(f.stati.map((s) => ETICHETTE_STATO[s].toLowerCase()).join(', '));
		if (f.generi.length) parti.push(`generi: ${f.generi.join(', ')}`);
		if (f.organizzazioni.length) {
			const nomi = f.organizzazioni.map(
				(id) => data.organizzazioni.find((o) => o.id === id)?.name ?? 'organizzazione rimossa'
			);
			parti.push(`solo ${nomi.join(', ')}`);
		}
		if (f.centro && f.raggioKm) parti.push(`entro ${f.raggioKm} km da ${f.centro.citta}`);
		return parti.join(' · ');
	}

	/** L'ultimo feed creato: l'URL va mostrato subito, è l'unica cosa che serve. */
	const appenaCreato = $derived(
		form && 'creato' in form ? data.feeds.find((f) => f.token === form.creato) : undefined
	);
</script>

<svelte:head><title>Feed ed export · Calendario Eventi Condiviso</title></svelte:head>

<header class="mb-8 max-w-2xl space-y-2">
	<h1 class="text-xl font-semibold tracking-tight">Feed ed export</h1>
	<p class="text-muted-foreground text-sm">
		Un feed è un indirizzo che incolli in Google Calendar o in Calendario di Apple: da lì in poi le
		date compaiono accanto ai tuoi appuntamenti e si aggiornano da sole, circa ogni dodici ore.
	</p>
	<p class="text-muted-foreground text-sm">
		L’indirizzo contiene un segreto e <strong>non richiede di fare login</strong>: chi ce l’ha vede
		il calendario come lo vedi tu. Trattalo come una password, e se finisce nel posto sbagliato
		disdicilo — gli altri continuano a funzionare.
	</p>
</header>

{#if form && 'errore' in form && form.errore}
	<p class="text-destructive mb-4 text-sm" role="alert">{form.errore}</p>
{/if}

{#if appenaCreato}
	<div class="border-border mb-8 rounded-lg border p-4">
		<p class="text-sm font-medium">Feed creato: {appenaCreato.label}</p>
		<p class="text-muted-foreground mt-1 text-xs">
			Copia questo indirizzo e incollalo nel tuo calendario. In Google: Altri calendari → Da URL. Su
			Apple: File → Nuova iscrizione calendario.
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<input
				readonly
				value={urlFeed(appenaCreato.token)}
				onfocus={(e) => e.currentTarget.select()}
				class="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs"
			/>
			<Button variant="outline" onclick={() => copia(appenaCreato.token)}>
				{copiato === appenaCreato.token ? 'Copiato' : 'Copia'}
			</Button>
		</div>
	</div>
{/if}

<div class="grid gap-10 lg:grid-cols-[1fr_1fr]">
	<!-- I feed esistenti -------------------------------------------------- -->
	<section>
		<h2 class="mb-3 text-sm font-medium">I tuoi feed</h2>

		{#if !data.feeds.length}
			<p class="text-muted-foreground text-sm">
				Non ne hai ancora nessuno. Il modulo accanto ne crea uno in pochi secondi.
			</p>
		{:else}
			<ul class="space-y-4">
				{#each data.feeds as feed (feed.id)}
					<li class="border-border rounded-lg border p-4" class:opacity-60={feed.revokedAt}>
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p class="text-sm font-medium">
									{feed.label}
									{#if feed.revokedAt}
										<span class="border-border ml-1 rounded border px-1.5 py-0.5 text-xs">
											disdetto
										</span>
									{/if}
								</p>
								<p class="text-muted-foreground mt-1 text-xs">{descriviFiltri(feed.filtri)}</p>
							</div>

							{#if !feed.revokedAt}
								<form
									method="POST"
									action="?/revoca"
									use:enhance={({ cancel }) => {
										if (
											!confirm(
												`Disdire "${feed.label}"? Chi ha l’indirizzo smetterà di ricevere aggiornamenti, e le date già scaricate resteranno nel suo calendario ferme a oggi.`
											)
										) {
											cancel();
										}
									}}
								>
									<input type="hidden" name="id" value={feed.id} />
									<Button type="submit" variant="outline">Disdici</Button>
								</form>
							{/if}
						</div>

						{#if !feed.revokedAt}
							<div class="mt-3 flex flex-wrap items-center gap-2">
								<input
									readonly
									value={urlFeed(feed.token)}
									onfocus={(e) => e.currentTarget.select()}
									class="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs"
								/>
								<Button variant="outline" onclick={() => copia(feed.token)}>
									{copiato === feed.token ? 'Copiato' : 'Copia'}
								</Button>
							</div>
						{/if}

						<p class="text-muted-foreground mt-2 text-xs">
							Creato il {dataBreve(feed.createdAt)} ·
							{#if feed.lastAccessedAt}
								ultima lettura {dataBreve(feed.lastAccessedAt)}
							{:else}
								mai letto da nessun calendario
							{/if}
						</p>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Export ---------------------------------------------------------- -->
		<h2 class="mt-10 mb-3 text-sm font-medium">Portati via i dati</h2>
		<p class="text-muted-foreground mb-3 text-sm">
			Tutto ciò che vedi, in un file. Nessun lock-in: il JSON è pensato per essere reimportato, il
			CSV per aprirsi in un foglio di calcolo, il JSON-LD per gli aggregatori di eventi.
		</p>
		<ul class="space-y-1 text-sm">
			{#each FORMATI as f (f.formato)}
				<li>
					<!--
						`resolve()` non prende una query string, quindi la si aggiunge
						qui: la rotta resta risolta e verificata dal compilatore, e
						`?format=` è un parametro dell'endpoint, non una navigazione.
					-->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={urlExport(f.formato)} data-sveltekit-reload class="underline underline-offset-4">
						{f.etichetta}
					</a>
					<span class="text-muted-foreground text-xs">· {f.nota}</span>
				</li>
			{/each}
		</ul>
		<p class="text-muted-foreground mt-2 text-xs">
			Gli export coprono dai tre mesi passati ai diciotto futuri, e contengono esattamente ciò che
			vedi tu: le date opzionate da altri restano ridotte a giorno, città e genere.
		</p>
	</section>

	<!-- Nuovo feed --------------------------------------------------------- -->
	<section>
		<h2 class="mb-3 text-sm font-medium">Nuovo feed</h2>

		<form method="POST" action="?/crea" use:enhance class="space-y-5">
			<Field
				label="Nome"
				name="label"
				required
				value={form && 'valori' in form ? form.valori?.label : ''}
				hint="Serve a te, per ritrovarlo: “Tutto”, “Solo metal in Umbria”…"
				placeholder="Tutte le date"
			/>
			{#if form && 'errori' in form && form.errori?.label}
				<p class="text-destructive text-xs" role="alert">{form.errori.label}</p>
			{/if}

			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">Stati da includere</legend>
				<p class="text-muted-foreground text-xs">
					Le bozze non entrano mai in un feed: sono l’unica cosa di cui il calendario promette che
					nessun altro l’ha vista, e un indirizzo pubblico non è il posto dove tenerla.
				</p>
				{#each stati as stato (stato)}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" name="stati" value={stato} checked class="size-4" />
						{ETICHETTE_STATO[stato]}
					</label>
				{/each}
			</fieldset>

			{#if data.generi.length}
				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">
						Generi <span class="text-muted-foreground font-normal">· facoltativo</span>
					</legend>
					<p class="text-muted-foreground text-xs">
						Nessuna spunta significa tutti. Scegliendo un genere entrano anche i suoi sottogeneri.
					</p>
					<div class="max-h-48 space-y-1 overflow-y-auto pr-2">
						{#each data.generi as g (g.slug)}
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" name="generi" value={g.slug} class="size-4" />
								{g.name}
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}

			{#if data.organizzazioni.length > 1}
				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">
						Organizzazioni <span class="text-muted-foreground font-normal">· facoltativo</span>
					</legend>
					<p class="text-muted-foreground text-xs">Nessuna spunta significa tutte.</p>
					<div class="max-h-48 space-y-1 overflow-y-auto pr-2">
						{#each data.organizzazioni as o (o.id)}
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" name="organizzazioni" value={o.id} class="size-4" />
								{o.name}
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}

			<Field
				label="Entro N km da"
				name="centroCitta"
				value={form && 'valori' in form ? form.valori?.centroCitta : ''}
				placeholder="Perugia"
				hint="La città viene cercata una volta sola, adesso. Lasciala vuota per non filtrare per distanza."
			/>
			{#if form && 'errori' in form && form.errori?.centroCitta}
				<p class="text-destructive text-xs" role="alert">{form.errori.centroCitta}</p>
			{/if}

			<Field
				label="Raggio in km"
				name="raggioKm"
				type="number"
				min={1}
				max={2000}
				value={form && 'valori' in form ? form.valori?.raggioKm : '60'}
			/>
			{#if form && 'errori' in form && form.errori?.raggioKm}
				<p class="text-destructive text-xs" role="alert">{form.errori.raggioKm}</p>
			{/if}

			<Button type="submit">Crea il feed</Button>
		</form>
	</section>
</div>
