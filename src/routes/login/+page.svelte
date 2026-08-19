<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Accedi · Calendario Eventi Condiviso</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-8 px-6 py-12">
	<header class="space-y-2">
		<h1 class="text-2xl font-semibold tracking-tight">Calendario Eventi Condiviso</h1>
		<p class="text-muted-foreground text-sm">
			Accedi con un link via email. L'accesso è riservato agli organizzatori invitati.
		</p>
	</header>

	{#if data.linkError && !form}
		<p class="text-destructive text-sm" role="alert">
			Il link non è più valido: potrebbe essere scaduto o già usato. Richiedine uno nuovo.
		</p>
	{/if}

	{#if form?.sent}
		<div class="border-border bg-card rounded-lg border p-4 text-sm">
			<p class="font-medium">Controlla la posta.</p>
			<p class="text-muted-foreground mt-1">
				Abbiamo inviato un link di accesso a <strong>{form.email}</strong>. Il link scade dopo
				un'ora e vale una sola volta.
			</p>
		</div>
	{:else}
		<form
			method="POST"
			class="space-y-4"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="next" value={data.next} />

			<div class="space-y-2">
				<label class="text-sm font-medium" for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={form?.email ?? ''}
					aria-invalid={form?.error ? 'true' : undefined}
					aria-describedby={form?.error ? 'email-error' : undefined}
					class="border-input bg-background ring-ring/40 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
				/>
				{#if form?.error}
					<p id="email-error" class="text-destructive text-sm">{form.error}</p>
				{/if}
			</div>

			<Button type="submit" size="lg" disabled={submitting} class="w-full">
				{submitting ? 'Invio in corso…' : 'Inviami il link'}
			</Button>
		</form>
	{/if}
</main>
