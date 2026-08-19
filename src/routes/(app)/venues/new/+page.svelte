<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let submitting = $state(false);
	let lat = $state('');
	let lon = $state('');
	let geocodeSource = $state('');
	let geocodeQuery = $state('');
	let statoRicerca = $state<'idle' | 'cerco' | 'trovato' | 'niente' | 'indisponibile'>('idle');

	let indirizzo = $state('');
	let citta = $state('');
	let provincia = $state('');

	/**
	 * Il geocoding è un aiuto, non un requisito: se non trova nulla, i campi
	 * lat/lon restano compilabili a mano e il salvataggio funziona lo stesso.
	 */
	async function cerca() {
		const q = [indirizzo, citta, provincia, 'Italia'].filter(Boolean).join(', ');
		if (q.length < 6) return;

		statoRicerca = 'cerco';
		try {
			const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
			const dati = await res.json();
			if (dati.indisponibile) {
				statoRicerca = 'indisponibile';
			} else if (dati.risultato) {
				lat = String(dati.risultato.lat);
				lon = String(dati.risultato.lon);
				geocodeSource = dati.risultato.source;
				geocodeQuery = q;
				if (!provincia && dati.risultato.province) provincia = dati.risultato.province;
				statoRicerca = 'trovato';
			} else {
				statoRicerca = 'niente';
			}
		} catch {
			statoRicerca = 'indisponibile';
		}
	}
</script>

<svelte:head><title>Nuovo locale · Calendario Eventi Condiviso</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<header class="mb-6 space-y-2">
		<h1 class="text-xl font-semibold tracking-tight">Nuovo locale</h1>
		<p class="text-muted-foreground text-sm">
			Le coordinate non sono un dettaglio: sono ciò con cui il calendario calcola le distanze fra
			due date. Senza, il locale non entra nel rilevamento conflitti.
		</p>
	</header>

	{#if form?.error}
		<p class="text-destructive mb-4 text-sm" role="alert">{form.error}</p>
	{/if}

	{#if form?.doppioni?.length}
		<div class="border-border bg-card mb-6 rounded-lg border p-4">
			<p class="text-sm font-medium">Forse esiste già</p>
			<ul class="mt-2 space-y-1 text-sm">
				{#each form.doppioni as d (d.id)}
					<li>
						<a href={resolve(`/venues/${d.id}`)} class="underline underline-offset-4">{d.name}</a>
						<span class="text-muted-foreground"> — {d.city}</span>
					</li>
				{/each}
			</ul>
			<p class="text-muted-foreground mt-2 text-xs">
				Se è davvero un locale diverso, salva di nuovo: il pulsante qui sotto conferma.
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
		<Field label="Nome" name="name" required value={form?.valori?.name ?? ''} />

		<Field label="Indirizzo" name="address" bind:value={indirizzo} />

		<div class="grid gap-5 sm:grid-cols-3">
			<Field label="Città" name="city" required bind:value={citta} />
			<Field label="Provincia" name="province" placeholder="PG" bind:value={provincia} />
			<Field label="CAP" name="postalCode" />
		</div>

		<div class="border-border rounded-lg border p-4">
			<div class="flex flex-wrap items-center gap-3">
				<Button type="button" variant="outline" onclick={cerca}>Trova coordinate</Button>
				<p class="text-muted-foreground text-sm">
					{#if statoRicerca === 'cerco'}
						Cerco…
					{:else if statoRicerca === 'trovato'}
						Trovate da {geocodeSource}.
					{:else if statoRicerca === 'niente'}
						Nessun risultato: prova un indirizzo più preciso, o inseriscile a mano.
					{:else if statoRicerca === 'indisponibile'}
						Servizio non disponibile. Inseriscile a mano.
					{:else}
						Compila indirizzo e città, poi cerca.
					{/if}
				</p>
			</div>

			<div class="mt-4 grid gap-5 sm:grid-cols-2">
				<Field label="Latitudine" name="lat" type="text" required bind:value={lat} />
				<Field label="Longitudine" name="lon" type="text" required bind:value={lon} />
			</div>

			<p class="text-muted-foreground mt-3 text-xs">Dati geografici © contributori OpenStreetMap</p>
		</div>

		<input type="hidden" name="geocodeSource" value={geocodeSource} />
		<input type="hidden" name="geocodeQuery" value={geocodeQuery} />

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Capienza" name="capacity" type="number" min={1} />
			<Field label="Telefono" name="phone" />
			<Field label="Email" name="email" type="email" />
			<Field label="Sito" name="website" type="url" />
			<Field label="Instagram" name="instagramUrl" type="url" />
			<Field label="Facebook" name="facebookUrl" type="url" />
		</div>

		<Field
			label="Note"
			name="notes"
			rows={3}
			hint="Quello che serve sapere prima di suonarci: dimensioni del palco, backline, accessi."
		/>

		<div class="flex flex-wrap gap-3">
			<Button type="submit" size="lg" disabled={submitting}>
				{submitting ? 'Salvataggio…' : 'Salva locale'}
			</Button>
			{#if form?.doppioni?.length}
				<Button type="submit" size="lg" variant="outline" name="confermaDoppione" value="1">
					È un locale diverso, salva comunque
				</Button>
			{/if}
		</div>
	</form>
</div>
