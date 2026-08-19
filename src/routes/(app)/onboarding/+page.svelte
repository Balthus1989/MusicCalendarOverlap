<script lang="ts">
	import { enhance } from '$app/forms';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ORG_KINDS, ORG_KIND_LABEL } from '$lib/schemas/organization';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const tipi = ORG_KINDS.map((k) => ({ value: k, label: ORG_KIND_LABEL[k] }));
</script>

<svelte:head><title>Organizzazione · Calendario Eventi Condiviso</title></svelte:head>

{#if data.senzaOrganizzazione}
	<div class="mx-auto max-w-md space-y-3 py-12">
		<h1 class="text-xl font-semibold tracking-tight">Non sei in nessuna organizzazione</h1>
		<p class="text-muted-foreground text-sm">
			L'accesso al calendario passa da un invito, e l'invito ti mette dentro un'organizzazione. Se
			sei arrivato qui il collegamento si è interrotto a metà: chiedi un invito nuovo a chi ti ha
			fatto entrare.
		</p>
	</div>
{:else if data.org}
	<div class="mx-auto max-w-2xl">
		<header class="mb-6 space-y-2">
			<h1 class="text-xl font-semibold tracking-tight">
				{data.completo ? 'Modifica organizzazione' : 'Completa il profilo'}
			</h1>
			<p class="text-muted-foreground text-sm">
				La città non è un dato anagrafico: è la posizione da cui si calcolano le distanze fra le
				date. Senza, il rilevamento dei conflitti geografici non parte.
			</p>
		</header>

		{#if !data.puoModificare}
			<p class="border-border mb-6 rounded-md border p-3 text-sm">
				Puoi vedere questi dati ma non modificarli: serve il ruolo di amministratore.
			</p>
		{/if}

		{#if form?.error}
			<p class="text-destructive mb-4 text-sm" role="alert">{form.error}</p>
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
			<input type="hidden" name="organizationId" value={data.org.id} />

			<Field label="Nome" name="name" value={data.org.name} required />
			<Field label="Tipo" name="kind" value={data.org.kind} options={tipi} required />

			<div class="grid gap-5 sm:grid-cols-3">
				<Field label="Città" name="city" value={data.org.city} required />
				<Field label="Provincia" name="province" value={data.org.province} placeholder="PG" />
				<Field label="Regione" name="region" value={data.org.region} />
			</div>

			<Field
				label="Raggio di conflitto (km)"
				name="defaultConflictRadiusKm"
				type="number"
				min={5}
				max={500}
				value={data.org.defaultConflictRadiusKm}
				required
				hint="Entro questa distanza, una data altrui nella stessa sera vale come concorrenza. 60 km è un punto di partenza da tarare sulla vostra geografia reale."
			/>

			<div class="grid gap-5 sm:grid-cols-2">
				<Field label="Sito" name="website" type="url" value={data.org.website} />
				<Field
					label="Email di contatto"
					name="emailContact"
					type="email"
					value={data.org.emailContact}
				/>
				<Field label="Instagram" name="instagramUrl" type="url" value={data.org.instagramUrl} />
				<Field label="Facebook" name="facebookUrl" type="url" value={data.org.facebookUrl} />
			</div>

			<Field label="Note" name="notes" rows={3} value={data.org.notes} />

			{#if data.org.lat !== null}
				<p class="text-muted-foreground text-xs">
					Coordinate registrate: {data.org.lat?.toFixed(4)}, {data.org.lon?.toFixed(4)} · dati geografici
					© contributori OpenStreetMap
				</p>
			{/if}

			{#if data.puoModificare}
				<Button type="submit" size="lg" disabled={submitting}>
					{submitting ? 'Salvataggio…' : 'Salva'}
				</Button>
			{/if}
		</form>
	</div>
{/if}
