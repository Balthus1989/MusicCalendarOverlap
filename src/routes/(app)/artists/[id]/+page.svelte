<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let modifica = $state(false);
	let submitting = $state(false);

	const a = $derived(data.artist);
	const slugAssegnati = $derived(new Set(data.generiAssegnati.map((g) => g.slug)));

	const link = $derived(
		(
			[
				['Bandcamp', a.bandcampUrl],
				['Sito', a.websiteUrl],
				['Instagram', a.instagramUrl],
				['Facebook', a.facebookUrl],
				['Spotify', a.spotifyUrl],
				['YouTube', a.youtubeUrl],
				['SoundCloud', a.soundcloudUrl]
			] as const
		).filter(([, href]) => Boolean(href))
	);
</script>

<svelte:head><title>{a.name} · Calendario Eventi Condiviso</title></svelte:head>

<nav class="mb-4 text-sm">
	<a href={resolve('/artists')} class="text-muted-foreground underline underline-offset-4">
		← Tutti gli artisti
	</a>
</nav>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">
			{a.name}
			{#if a.isVerified}
				<span
					class="border-border ml-2 rounded border px-1.5 py-0.5 align-middle text-[0.625rem] tracking-wide uppercase"
				>
					verificata
				</span>
			{/if}
		</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			{[a.country, a.city, a.formedYear && `dal ${a.formedYear}`].filter(Boolean).join(' · ') ||
				'—'}
		</p>
	</div>
	<div class="flex gap-2">
		{#if data.puoVerificare}
			<form method="POST" action="?/verifica" use:enhance>
				<input type="hidden" name="verificata" value={a.isVerified ? '0' : '1'} />
				<Button type="submit" variant="ghost">
					{a.isVerified ? 'Togli verifica' : 'Verifica'}
				</Button>
			</form>
		{/if}
		{#if data.puoModificare}
			<Button variant="outline" onclick={() => (modifica = !modifica)}>
				{modifica ? 'Annulla' : 'Modifica'}
			</Button>
		{/if}
	</div>
</header>

{#if form?.error}
	<p class="text-destructive mb-4 text-sm" role="alert">{form.error}</p>
{/if}
{#if form?.salvato || form?.verificaAggiornata}
	<p class="mb-4 text-sm">Salvato.</p>
{/if}

{#if !data.puoModificare}
	<p class="border-border mb-6 rounded-md border p-3 text-sm">
		{#if a.isVerified}
			Questa scheda è stata verificata da un moderatore. Per correggerla serve lo stesso ruolo.
		{:else}
			Questa scheda l'ha inserita {data.autore ?? 'un altro organizzatore'}. Per correggerla serve
			il ruolo di moderatore.
		{/if}
	</p>
{/if}

{#if modifica}
	<form
		method="POST"
		action="?/salva"
		class="max-w-2xl space-y-5"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
				modifica = false;
			};
		}}
	>
		<Field label="Nome" name="name" required value={a.name} />
		<Field
			label="MusicBrainz ID"
			name="mbid"
			value={a.mbid}
			hint="Senza, due band omonime non possono coesistere in anagrafica."
		/>

		<div class="grid gap-5 sm:grid-cols-3">
			<Field label="Paese" name="country" value={a.country} />
			<Field label="Città" name="city" value={a.city} />
			<Field label="Anno di formazione" name="formedYear" type="number" value={a.formedYear} />
		</div>

		<div class="space-y-1.5">
			<span class="text-sm font-medium">Generi</span>
			<select
				name="genreSlugs"
				multiple
				size="8"
				class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
			>
				{#each data.tuttiIGeneri as g (g.slug)}
					<option value={g.slug} selected={slugAssegnati.has(g.slug)}>
						{' '.repeat(g.depth * 3)}{g.name}
					</option>
				{/each}
			</select>
		</div>

		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Email booking" name="bookingEmail" type="email" value={a.bookingEmail} />
			<Field label="Agenzia booking" name="bookingAgency" value={a.bookingAgency} />
			<Field label="Bandcamp" name="bandcampUrl" type="url" value={a.bandcampUrl} />
			<Field label="Sito" name="websiteUrl" type="url" value={a.websiteUrl} />
			<Field label="Instagram" name="instagramUrl" type="url" value={a.instagramUrl} />
			<Field label="Facebook" name="facebookUrl" type="url" value={a.facebookUrl} />
			<Field label="Spotify" name="spotifyUrl" type="url" value={a.spotifyUrl} />
			<Field label="YouTube" name="youtubeUrl" type="url" value={a.youtubeUrl} />
		</div>

		<Field label="Note" name="bio" rows={3} value={a.bio} />

		<Button type="submit" size="lg" disabled={submitting}>
			{submitting ? 'Salvataggio…' : 'Salva'}
		</Button>
	</form>
{:else}
	<dl class="grid max-w-2xl gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
		<dt class="text-muted-foreground text-sm">Generi</dt>
		<dd class="text-sm">
			{#if data.generiAssegnati.length}
				{data.generiAssegnati
					.map((g) => (g.isPrimary ? `${g.name} (primario)` : g.name))
					.join(' · ')}
			{:else}
				—
			{/if}
		</dd>

		<dt class="text-muted-foreground text-sm">Booking</dt>
		<dd class="text-sm">
			{[a.bookingAgency, a.bookingEmail].filter(Boolean).join(' · ') || '—'}
		</dd>

		<dt class="text-muted-foreground text-sm">MusicBrainz</dt>
		<dd class="text-sm">
			{#if a.mbid}
				<code class="text-xs">{a.mbid}</code>
			{:else}
				<span class="text-muted-foreground">non collegata</span>
			{/if}
		</dd>

		<dt class="text-muted-foreground text-sm">Link</dt>
		<dd class="flex flex-wrap gap-3 text-sm">
			{#each link as [etichetta, href] (etichetta)}
				<a {href} rel="noreferrer noopener external" class="underline underline-offset-4">
					{etichetta}
				</a>
			{/each}
			{#if link.length === 0}—{/if}
		</dd>

		{#if a.bio}
			<dt class="text-muted-foreground text-sm">Note</dt>
			<dd class="text-sm whitespace-pre-line">{a.bio}</dd>
		{/if}

		<dt class="text-muted-foreground text-sm">Inserita da</dt>
		<dd class="text-sm">{data.autore ?? '—'}</dd>
	</dl>
{/if}
