<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { ETICHETTE_NOTIFICA } from '$lib/notifications';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const quando = (d: Date | string) =>
		new Intl.DateTimeFormat('it-IT', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'Europe/Rome'
		}).format(new Date(d));

	/**
	 * Il link di una notifica è un percorso interno scritto dal server. Resta
	 * comunque un valore letto da una colonna `jsonb`, quindi si accetta solo
	 * se comincia con una barra sola: `//altro.example` è un indirizzo
	 * assoluto travestito da percorso.
	 */
	const interno = (url: string | null) => Boolean(url && /^\/(?!\/)/.test(url));
</script>

<svelte:head><title>Avvisi · Calendario Eventi</title></svelte:head>

<div class="mb-6 flex flex-wrap items-baseline justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Avvisi</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Conflitti, promemoria e riepiloghi. Quali di questi arrivino anche per email si sceglie nelle <a
				class="underline underline-offset-4"
				href={resolve('/settings/notifications')}
			>
				impostazioni di notifica</a
			>.
		</p>
	</div>

	{#if data.nonLette > 0}
		<form method="POST" action="?/segnaLette" use:enhance>
			<input type="hidden" name="fino" value={data.caricataAlle} />
			<Button type="submit" variant="outline">
				Segna lette ({data.nonLette})
			</Button>
		</form>
	{/if}
</div>

{#if form?.errore}
	<p role="alert" class="border-border mb-4 rounded-lg border p-3 text-sm">{form.errore}</p>
{/if}

{#if data.notifiche.length === 0}
	<p class="text-muted-foreground text-sm">
		Nessun avviso. È il caso normale: qui compare qualcosa quando due date si danno fastidio o
		quando una tua opzione supera la data di annuncio che le avevi dato.
	</p>
{:else}
	<ul class="grid gap-3">
		{#each data.notifiche as n (n.id)}
			<li
				class={n.letta
					? 'border-border rounded-lg border p-4'
					: 'border-foreground/30 bg-card rounded-lg border p-4'}
			>
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<span
						class="border-border rounded border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase"
					>
						{ETICHETTE_NOTIFICA[n.kind]}
					</span>
					<h2 class="text-sm font-medium">{n.titolo}</h2>
					<time
						class="text-muted-foreground ml-auto text-xs"
						datetime={new Date(n.createdAt).toISOString()}
					>
						{quando(n.createdAt)}
					</time>
				</div>

				<p class="mt-2 text-sm whitespace-pre-line">{n.testo}</p>

				<div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
					{#if interno(n.url)}
						<!-- Il percorso arriva da una colonna `jsonb`, non da una rotta nota:
						     `resolve()` non lo saprebbe tipizzare. Lo filtra `interno()` qui
						     sopra, che accetta solo percorsi con una barra sola. -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="underline underline-offset-4" href={n.url}>Apri</a>
					{/if}
					{#if n.consegnata}
						<span class="text-muted-foreground text-xs">Consegnato anche fuori dall’app</span>
					{/if}
					{#if !n.letta}
						<span class="text-muted-foreground text-xs">Non letto</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}
