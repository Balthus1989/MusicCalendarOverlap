<script lang="ts">
	/**
	 * Un avviso di conflitto, ovunque compaia: dashboard, pagina della data,
	 * anteprima nel form.
	 *
	 * Un componente solo e non tre, perché l'avviso che si vede mentre si
	 * compila deve essere **lo stesso** che arriva in dashboard: se
	 * divergessero, la prima cosa che un organizzatore imparerebbe è che
	 * l'anteprima non è affidabile.
	 *
	 * Il tono è quello di ADR-0022: mostra e propone di sentirsi, non
	 * autorizza e non vieta. Non c'è nessun pulsante che dica "procedi lo
	 * stesso", perché non c'è niente da autorizzare.
	 */
	import {
		ETICHETTE_CONFLITTO,
		ETICHETTE_SEVERITA,
		INVITO_AL_CONTATTO,
		mailtoControparte,
		spiegazioneConflitto,
		titoloConflitto,
		type ConflittoLeggibile
	} from '$lib/conflicts';

	type Props = {
		conflitto: ConflittoLeggibile;
		/** Il riquadro dell'invito a contattare: si toglie dove sarebbe ripetitivo. */
		conInvito?: boolean;
		children?: import('svelte').Snippet;
	};

	let { conflitto: c, conInvito = true, children }: Props = $props();

	const mailto = $derived(mailtoControparte(c));

	/**
	 * Il bordo segue la gravità. Il colore non è l'unico segnale — accanto
	 * c'è sempre l'etichetta scritta — perché un avviso che si distingue solo
	 * per il colore non arriva a chi non lo distingue.
	 */
	const bordo = $derived(
		c.severity === 'high'
			? 'border-destructive'
			: c.severity === 'medium'
				? 'border-foreground/40'
				: 'border-border'
	);
</script>

<article class={`rounded-lg border p-4 ${bordo}`}>
	<div class="mb-2 flex flex-wrap items-center gap-2">
		<span class="border-border rounded border px-2 py-0.5 text-xs tracking-wide uppercase">
			{ETICHETTE_SEVERITA[c.severity]}
		</span>
		<span class="text-muted-foreground text-xs">{ETICHETTE_CONFLITTO[c.kind]}</span>
	</div>

	<h3 class="text-sm font-medium">{titoloConflitto(c)}</h3>
	<p class="text-muted-foreground mt-1 text-sm">{spiegazioneConflitto(c)}</p>

	<dl class="text-muted-foreground mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
		<div class="flex gap-1">
			<dt>Giorno:</dt>
			<dd class="text-foreground">{c.controparte.giorno}</dd>
		</div>
		<div class="flex gap-1">
			<dt>Dove:</dt>
			<dd class="text-foreground">{c.controparte.city}</dd>
		</div>
		{#if c.distanzaKm !== null}
			<div class="flex gap-1">
				<dt>Distanza:</dt>
				<dd class="text-foreground">{Math.round(c.distanzaKm)} km</dd>
			</div>
		{/if}
		<div class="flex gap-1">
			<dt>Organizza:</dt>
			<dd class="text-foreground">{c.controparte.organizzazione.name}</dd>
		</div>
	</dl>

	{#if conInvito}
		<p class="mt-3 text-xs">
			{INVITO_AL_CONTATTO}
			{#if mailto}
				<!-- `mailto:` non è una rotta dell'applicazione: `resolve()` non c'entra. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={mailto} rel="external" class="underline underline-offset-4">
					Scrivi a {c.controparte.organizzazione.name}
				</a>
			{:else}
				<span class="text-muted-foreground">
					Questa organizzazione non ha ancora messo un contatto nel proprio profilo.
				</span>
			{/if}
		</p>
	{/if}

	{#if children}
		<div class="border-border mt-4 border-t pt-3">
			{@render children()}
		</div>
	{/if}
</article>
