<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Field from '$lib/components/Field.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const linkInvito = (code: string) => `${page.url.origin}/invite/${code}`;

	function formattaData(d: Date | string | null) {
		if (!d) return 'senza scadenza';
		return new Date(d).toLocaleDateString('it-IT', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}
</script>

<svelte:head><title>Inviti · Calendario Eventi Condiviso</title></svelte:head>

<header class="mb-6 space-y-2">
	<h1 class="text-xl font-semibold tracking-tight">Invita un'organizzazione</h1>
	<p class="text-muted-foreground max-w-prose text-sm">
		Questo invito non punta a un'organizzazione esistente: chi lo accetta ne crea una nuova e ne
		diventa titolare. È l'unico modo per far entrare un circolo o un'associazione nel calendario.
	</p>
</header>

{#if data.tutteLeOrg.length === 0}
	<div class="border-border bg-card mb-6 rounded-lg border p-4">
		<p class="text-sm font-medium">Il calendario è vuoto.</p>
		<p class="text-muted-foreground mt-1 text-sm">
			Non c'è ancora nessuna organizzazione. Genera il primo invito qui sotto e aprilo tu stesso per
			registrare la tua.
		</p>
	</div>
{/if}

{#if form?.error}
	<p class="text-destructive mb-4 text-sm" role="alert">{form.error}</p>
{/if}

{#if form?.invitoCreato}
	<div class="border-border bg-card mb-6 rounded-lg border p-4">
		<p class="text-sm font-medium">Invito creato.</p>
		{#if form.emailInvito?.spedito}
			<p class="text-muted-foreground mt-1 text-sm">
				Email inviata a {form.emailInvito.a}. Il link qui sotto resta valido lo stesso.
			</p>
		{:else if form.emailInvito}
			<p class="mt-1 text-sm">
				Email <strong>non</strong> inviata: {form.emailInvito.motivo} Manda il link a mano.
			</p>
		{/if}
		<code class="mt-2 block overflow-x-auto text-xs">{linkInvito(form.invitoCreato)}</code>
	</div>
{/if}

<form method="POST" action="?/crea" use:enhance class="mb-10 grid max-w-2xl gap-4 sm:grid-cols-3">
	<Field label="Email suggerita" name="emailHint" type="email" />
	<Field label="Utilizzi" name="maxUses" type="number" min={1} max={50} value={1} required />
	<Field
		label="Validità (giorni)"
		name="expiresInDays"
		type="number"
		min={1}
		max={365}
		value={30}
		required
	/>
	<div class="sm:col-span-3">
		<Button type="submit">Genera invito</Button>
	</div>
</form>

{#if data.inviti.length}
	<h2 class="mb-3 text-base font-semibold">Inviti per nuove organizzazioni</h2>
	<div class="border-border overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="bg-muted/50 text-muted-foreground text-left">
				<tr>
					<th class="px-3 py-2 font-medium">Codice</th>
					<th class="px-3 py-2 font-medium">Email</th>
					<th class="px-3 py-2 font-medium">Usi</th>
					<th class="px-3 py-2 font-medium">Scadenza</th>
					<th class="px-3 py-2"><span class="sr-only">Azioni</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.inviti as inv (inv.id)}
					<tr class="border-border border-t {inv.maxUses === 0 ? 'opacity-50' : ''}">
						<td class="px-3 py-2 font-mono text-xs">{inv.code}</td>
						<td class="text-muted-foreground px-3 py-2">{inv.emailHint ?? '—'}</td>
						<td class="px-3 py-2 tabular-nums">{inv.uses} / {inv.maxUses}</td>
						<td class="text-muted-foreground px-3 py-2">{formattaData(inv.expiresAt)}</td>
						<td class="px-3 py-2 text-right">
							{#if inv.maxUses > 0}
								<form method="POST" action="?/revoca" use:enhance>
									<input type="hidden" name="inviteId" value={inv.id} />
									<button type="submit" class="text-destructive text-sm underline">Revoca</button>
								</form>
							{:else}
								<span class="text-muted-foreground text-xs">revocato</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if data.tutteLeOrg.length}
	<h2 class="mt-10 mb-3 text-base font-semibold">Organizzazioni iscritte</h2>
	<ul class="text-sm">
		{#each data.tutteLeOrg as o (o.id)}
			<li class="border-border border-b py-1.5">
				{o.name}
				<span class="text-muted-foreground">{o.city ? ` — ${o.city}` : ''}</span>
			</li>
		{/each}
	</ul>
{/if}
