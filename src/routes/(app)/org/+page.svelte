<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Field from '$lib/components/Field.svelte';
	import InvitoCreato from '$lib/components/InvitoCreato.svelte';
	import { Button } from '$lib/components/ui/button';
	import { INVITE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from '$lib/schemas/invite';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ruoli = INVITE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

	function formattaData(d: Date | string | null) {
		if (!d) return 'senza scadenza';
		return new Date(d).toLocaleDateString('it-IT', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
	}
</script>

<svelte:head><title>Organizzazione · Calendario Eventi Condiviso</title></svelte:head>

{#if !data.org}
	<p class="text-muted-foreground text-sm">Nessuna organizzazione.</p>
{:else}
	<header class="mb-8 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight">{data.org.name}</h1>
			<p class="text-muted-foreground mt-1 text-sm">
				{data.org.city ?? 'città non impostata'}{data.org.province ? ` (${data.org.province})` : ''} ·
				raggio {data.org.defaultConflictRadiusKm} km
				{#if data.org.lat === null}
					· <span class="text-destructive">coordinate mancanti</span>
				{/if}
			</p>
		</div>
		<a href={resolve('/onboarding')} class="text-sm underline underline-offset-4">Modifica</a>
	</header>

	{#if data.tutteLeOrg.length > 1}
		<nav class="mb-6 flex flex-wrap gap-2" aria-label="Le tue organizzazioni">
			<!-- Il path passa già da resolve(); quello che la regola non riconosce
			     è la query string appesa, che non va risolta. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			{#each data.tutteLeOrg as o (o.id)}
				<a
					href={`${resolve('/org')}?org=${o.id}`}
					class="border-border rounded-md border px-3 py-1.5 text-sm {o.id === data.org.id
						? 'bg-accent font-medium'
						: 'text-muted-foreground'}"
				>
					{o.name}
				</a>
			{/each}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</nav>
	{/if}

	{#if form?.error}
		<p class="text-destructive mb-4 text-sm" role="alert">{form.error}</p>
	{/if}

	<section class="mb-10">
		<h2 class="mb-3 text-base font-semibold">Membri</h2>
		<div class="border-border overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="bg-muted/50 text-muted-foreground text-left">
					<tr>
						<th class="px-3 py-2 font-medium">Nome</th>
						<th class="px-3 py-2 font-medium">Email</th>
						<th class="px-3 py-2 font-medium">Ruolo</th>
					</tr>
				</thead>
				<tbody>
					{#each data.membri as m (m.profileId)}
						<tr class="border-border border-t">
							<td class="px-3 py-2">{m.displayName}</td>
							<td class="text-muted-foreground px-3 py-2">{m.email}</td>
							<td class="px-3 py-2">
								{#if data.puoGestire}
									<form method="POST" action="?/cambiaRuolo" use:enhance class="flex gap-2">
										<input type="hidden" name="organizationId" value={data.org.id} />
										<input type="hidden" name="profileId" value={m.profileId} />
										<select
											name="role"
											class="border-input bg-background rounded border px-2 py-1 text-sm"
										>
											{#each ruoli as r (r.value)}
												<option value={r.value} selected={r.value === m.role}>{r.label}</option>
											{/each}
										</select>
										<button type="submit" class="text-sm underline underline-offset-4">
											Salva
										</button>
									</form>
								{:else}
									{ROLE_LABEL[m.role]}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="text-muted-foreground mt-2 text-xs">
			{ROLE_DESCRIPTION.moderator}
		</p>
	</section>

	{#if data.puoInvitare}
		<section>
			<h2 class="mb-3 text-base font-semibold">Inviti</h2>

			{#if form?.invitoCreato}
				<InvitoCreato code={form.invitoCreato} email={form.invitoEmail} esito={form.invio} />
			{/if}

			<form method="POST" action="?/creaInvito" use:enhance class="mb-6 grid gap-4 sm:grid-cols-4">
				<input type="hidden" name="organizationId" value={data.org.id} />
				<Field label="Ruolo" name="role" options={ruoli} value="member" required />
				<Field
					label="Email dell’invitato"
					name="emailHint"
					type="email"
					hint="Non fa partire nessuna email: precompila il campo quando aprirà il link, e ti ricorda a chi l’avevi destinato."
				/>
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
				<div class="sm:col-span-4">
					<Button type="submit">Genera invito</Button>
				</div>
			</form>

			{#if data.inviti.length}
				<div class="border-border overflow-x-auto rounded-lg border">
					<table class="w-full text-sm">
						<thead class="bg-muted/50 text-muted-foreground text-left">
							<tr>
								<th class="px-3 py-2 font-medium">Codice</th>
								<th class="px-3 py-2 font-medium">Ruolo</th>
								<th class="px-3 py-2 font-medium">Usi</th>
								<th class="px-3 py-2 font-medium">Scadenza</th>
								<th class="px-3 py-2"><span class="sr-only">Azioni</span></th>
							</tr>
						</thead>
						<tbody>
							{#each data.inviti as inv (inv.id)}
								<tr class="border-border border-t {inv.maxUses === 0 ? 'opacity-50' : ''}">
									<td class="px-3 py-2 font-mono text-xs">{inv.code}</td>
									<td class="px-3 py-2">{ROLE_LABEL[inv.role]}</td>
									<td class="px-3 py-2 tabular-nums">{inv.uses} / {inv.maxUses}</td>
									<td class="text-muted-foreground px-3 py-2">{formattaData(inv.expiresAt)}</td>
									<td class="px-3 py-2 text-right">
										{#if inv.maxUses > 0}
											<form method="POST" action="?/revocaInvito" use:enhance>
												<input type="hidden" name="inviteId" value={inv.id} />
												<input type="hidden" name="organizationId" value={data.org.id} />
												<button type="submit" class="text-destructive text-sm underline">
													Revoca
												</button>
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
		</section>
	{/if}
{/if}
