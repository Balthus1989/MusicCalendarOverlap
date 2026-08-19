<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { ROLE_DESCRIPTION, ROLE_LABEL } from '$lib/schemas/invite';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const campo =
		'border-input bg-background ring-ring/40 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none';
</script>

<svelte:head>
	<title>Invito · Calendario Eventi Condiviso</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6 py-12">
	{#if !data.valido}
		<div class="space-y-3">
			<h1 class="text-2xl font-semibold tracking-tight">Invito non utilizzabile</h1>
			<p class="text-muted-foreground text-sm">{data.motivo}</p>
			<p class="text-muted-foreground text-sm">
				Chiedi un invito nuovo a chi ti ha passato questo link.
			</p>
		</div>
	{:else if form?.sent}
		<div class="border-border bg-card rounded-lg border p-4 text-sm">
			<p class="font-medium">Controlla la posta.</p>
			<p class="text-muted-foreground mt-1">
				Abbiamo inviato un link di accesso a <strong>{form.email}</strong>. Aprilo per completare
				l'iscrizione: torni su questa pagina già autenticato.
			</p>
		</div>
	{:else}
		<header class="space-y-2">
			<h1 class="text-2xl font-semibold tracking-tight">
				{#if data.creaOrganizzazione}
					Registra la tua organizzazione
				{:else}
					Entra in {data.organizzazione?.name}
				{/if}
			</h1>
			<p class="text-muted-foreground text-sm">
				Ti unisci al calendario condiviso come <strong class="text-foreground"
					>{ROLE_LABEL[data.ruolo]}</strong
				>. {ROLE_DESCRIPTION[data.ruolo]}
			</p>
		</header>

		{#if form?.error}
			<p class="text-destructive text-sm" role="alert">{form.error}</p>
		{/if}

		{#if !data.autenticato}
			<form
				method="POST"
				action="?/richiediLink"
				class="space-y-4"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<div class="space-y-2">
					<label class="text-sm font-medium" for="email">La tua email</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						value={form?.email ?? data.emailHint}
						class={campo}
					/>
					<p class="text-muted-foreground text-xs">
						Ti mandiamo un link di accesso. Nessuna password da scegliere o ricordare.
					</p>
				</div>

				<Button type="submit" size="lg" disabled={submitting} class="w-full">
					{submitting ? 'Invio in corso…' : 'Inviami il link'}
				</Button>
			</form>
		{:else}
			<form
				method="POST"
				action="?/accetta"
				class="space-y-4"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<div class="space-y-2">
					<label class="text-sm font-medium" for="displayName">Come ti chiami</label>
					<input
						id="displayName"
						name="displayName"
						type="text"
						required
						minlength="2"
						value={data.displayName}
						class={campo}
					/>
					<p class="text-muted-foreground text-xs">
						Lo vedono gli altri organizzatori quando devono contattarti per una data.
					</p>
				</div>

				{#if data.creaOrganizzazione}
					<div class="space-y-2">
						<label class="text-sm font-medium" for="orgName">Nome dell'organizzazione</label>
						<input id="orgName" name="orgName" type="text" required minlength="2" class={campo} />
						<p class="text-muted-foreground text-xs">
							Circolo, associazione, collettivo o agenzia. I dettagli si completano dopo.
						</p>
					</div>
				{/if}

				<Button type="submit" size="lg" disabled={submitting} class="w-full">
					{submitting ? 'Un attimo…' : 'Accetta l’invito'}
				</Button>
			</form>
		{/if}
	{/if}
</main>
