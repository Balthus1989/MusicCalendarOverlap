<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);

	const opzioniOrganizzazioni = $derived(
		data.organizzazioni.map((o) => ({ value: o.id, label: o.name }))
	);

	const opzioniLocali = $derived([
		{ value: '', label: 'Non lo so, o non è in elenco' },
		...data.locali.map((l) => ({
			value: l.id,
			label: l.province ? `${l.name} — ${l.city} (${l.province})` : `${l.name} — ${l.city}`
		}))
	]);

	const opzioniGeneri = $derived([
		{ value: '', label: 'Non lo so' },
		...data.generi.map((g) => ({ value: g.slug, label: '· '.repeat(g.depth) + g.name }))
	]);

	const err = (campo: string): string | undefined =>
		(form?.errori as Record<string, string> | undefined)?.[campo];
</script>

<svelte:head><title>Segnala una data · Calendario Eventi Condiviso</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<header class="mb-6 space-y-2">
		<h1 class="text-xl font-semibold tracking-tight">Segnala una data</h1>
		<p class="text-muted-foreground text-sm">
			Per una serata organizzata da qualcuno che nel calendario non è iscritto. Entra subito, come
			data confermata, e la vedono tutti: accanto compare il nome della tua organizzazione, perché
			chi la legge sappia da dove viene.
		</p>
	</header>

	{#if form?.erroreGenerale}
		<p class="text-destructive mb-4 text-sm" role="alert">{form.erroreGenerale}</p>
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
		{#if opzioniOrganizzazioni.length > 1}
			<Field
				label="Segnali come"
				name="segnalataDaOrganizationId"
				required
				options={opzioniOrganizzazioni}
				value={form?.valori?.segnalataDaOrganizationId ?? opzioniOrganizzazioni[0].value}
				hint="Il nome che comparirà accanto alla data."
			/>
		{:else}
			<input
				type="hidden"
				name="segnalataDaOrganizationId"
				value={opzioniOrganizzazioni[0].value}
			/>
		{/if}

		<Field
			label="Chi organizza"
			name="organizzatore"
			required
			value={form?.valori?.organizzatore ?? ''}
			hint="Il nome del circolo, del promoter o del collettivo che fa la serata. Se è già iscritto al calendario, le sue date le carica lui."
		/>
		{#if err('organizzatore')}<p class="text-destructive text-xs">{err('organizzatore')}</p>{/if}

		<Field label="Titolo" name="title" required value={form?.valori?.title ?? ''} />
		{#if err('title')}<p class="text-destructive text-xs">{err('title')}</p>{/if}

		<div class="grid gap-5 sm:grid-cols-2">
			<Field
				label="Inizio"
				name="startsAtLocal"
				type="datetime-local"
				required
				value={form?.valori?.startsAtLocal ?? ''}
			/>
			<Field
				label="Fine"
				name="endsAtLocal"
				type="datetime-local"
				value={form?.valori?.endsAtLocal ?? ''}
			/>
		</div>
		{#if err('startsAtLocal')}<p class="text-destructive text-xs">{err('startsAtLocal')}</p>{/if}
		{#if err('endsAtLocal')}<p class="text-destructive text-xs">{err('endsAtLocal')}</p>{/if}

		<div class="grid gap-5 sm:grid-cols-3">
			<div class="sm:col-span-2">
				<Field label="Città" name="city" required value={form?.valori?.city ?? ''} />
			</div>
			<Field
				label="Provincia"
				name="province"
				placeholder="PG"
				value={form?.valori?.province ?? ''}
			/>
		</div>
		{#if err('city')}<p class="text-destructive text-xs">{err('city')}</p>{/if}
		{#if err('province')}<p class="text-destructive text-xs">{err('province')}</p>{/if}

		<Field
			label="Locale"
			name="venueId"
			options={opzioniLocali}
			value={form?.valori?.venueId ?? ''}
			hint="Se il locale è in anagrafica, sceglierlo fa scattare l’avviso quando due date finiscono nello stesso posto."
		/>

		<Field
			label="Genere principale"
			name="primaryGenreSlug"
			options={opzioniGeneri}
			value={form?.valori?.primaryGenreSlug ?? ''}
			hint="Serve a capire se la serata pesca dallo stesso pubblico di un’altra."
		/>

		<Field
			label="Band"
			name="lineup"
			rows={4}
			value={form?.valori?.lineup ?? ''}
			hint="Un nome per riga. Restano come li scrivi: non vengono collegate all’anagrafica, perché una band omonima collegata per sbaglio falserebbe gli avvisi senza darne segno."
		/>

		<Field
			label="Dove l’hai vista"
			name="fonteUrl"
			type="url"
			value={form?.valori?.fonteUrl ?? ''}
			hint="Il link al post o all’evento. Non è obbligatorio, ma è ciò che permette a chi legge di verificare."
		/>
		{#if err('fonteUrl')}<p class="text-destructive text-xs">{err('fonteUrl')}</p>{/if}

		<Field
			label="Note"
			name="note"
			rows={3}
			value={form?.valori?.note ?? ''}
			hint="Quello che sai e che non sta negli altri campi. È visibile a tutti, come il resto della segnalazione."
		/>

		<div class="border-border bg-card rounded-lg border p-4">
			<p class="text-sm font-medium">Prima di salvare</p>
			<p class="text-muted-foreground mt-2 text-sm">
				Una segnalazione è una data come le altre: entra nel calendario di tutti e fa scattare gli
				avvisi di sovrapposizione. Se ti accorgi di aver sbagliato, chiedi a chi modera — la data si
				corregge o si cancella.
			</p>
		</div>

		<Button type="submit" size="lg" disabled={submitting}>
			{submitting ? 'Salvataggio…' : 'Segnala la data'}
		</Button>
	</form>
</div>
