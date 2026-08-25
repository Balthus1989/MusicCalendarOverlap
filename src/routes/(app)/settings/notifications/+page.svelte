<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * Le tre voci, con la riga di §10 a cui corrispondono. Il testo di
	 * spiegazione non è decorazione: senza, «avvisi di conflitto» non dice se
	 * si parla dei propri o di quelli altrui, e chi non è sicuro spegne.
	 */
	const voci = $derived([
		{
			nome: 'avvisaConflitti',
			etichetta: 'Conflitti nuovi',
			spiegazione:
				'Quando una data nuova — tua o di un altro iscritto — si sovrappone a una tua in modo serio. Solo i casi gravi o da guardare: quelli informativi restano in dashboard.',
			acceso: data.preferenze.avvisaConflitti
		},
		{
			nome: 'avvisaDigest',
			etichetta: 'Riepilogo settimanale',
			spiegazione:
				'Il lunedì mattina: le date nuove della settimana, i conflitti ancora aperti, le tue opzioni con l’annuncio in scadenza. Se non c’è niente da dire non arriva.',
			acceso: data.preferenze.avvisaDigest
		},
		{
			nome: 'avvisaSolleciti',
			etichetta: 'Promemoria sulle tue opzioni',
			spiegazione:
				'Quando una tua data resta opzionata oltre la scadenza di annuncio che le avevi dato. Non chiede di confermarla: dice solo che quella scadenza è passata.',
			acceso: data.preferenze.avvisaSolleciti
		}
	]);

	const collegato = $derived(data.collegato || form?.collegato === true);
	const codice = $derived(form && 'codice' in form ? form.codice : null);
	const link = $derived(form && 'link' in form ? form.link : null);
</script>

<svelte:head><title>Impostazioni di notifica · Calendario Eventi</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Impostazioni di notifica</h1>
<p class="text-muted-foreground mt-1 mb-8 text-sm">
	Gli avvisi si leggono sempre nella
	<a class="underline underline-offset-4" href={resolve('/notifications')}>casella degli avvisi</a>.
	Da qui scegli quali ti debbano anche <strong>raggiungere</strong> su Telegram, senza dover aprire il
	calendario.
</p>

{#if form?.errore}
	<p role="alert" class="border-destructive/50 mb-6 rounded-lg border p-3 text-sm">
		{form.errore}
	</p>
{/if}

<!-- Il canale -------------------------------------------------------- -->
<section class="mb-10 max-w-2xl">
	<h2 class="mb-3 text-base font-semibold">Dove ricevere gli avvisi</h2>

	{#if data.canaliAttivi.length === 0}
		<p class="border-border rounded-lg border p-4 text-sm">
			<strong>Nessun canale è configurato su questo server.</strong> Gli avvisi restano in coda e si leggono
			solo nella casella. Le preferenze qui sotto si salvano lo stesso, e valgono dal momento in cui un
			canale ci sarà.
		</p>
	{:else if collegato}
		<div class="border-border rounded-lg border p-4">
			<p class="text-sm font-medium">Telegram è collegato.</p>
			<p class="text-muted-foreground mt-1 text-sm">
				Gli avvisi che hai lasciato accesi qui sotto ti arrivano in chat.
			</p>
			<form method="POST" action="?/scollega" use:enhance class="mt-3">
				<Button type="submit" variant="outline">Scollega</Button>
			</form>
		</div>
	{:else if codice}
		<div class="border-border rounded-lg border p-4">
			<p class="text-sm font-medium">Due passaggi e ci siamo.</p>
			<ol class="mt-3 grid gap-3 text-sm">
				<li>
					<strong>1.</strong> Apri il bot e premi <em>Avvia</em>:
					{#if link}
						<!-- Link esterno: `resolve()` vale per le rotte di questa
						     applicazione, e t.me non è una di quelle. -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="underline underline-offset-4" href={link} target="_blank" rel="noreferrer">
							apri @{data.bot}
						</a>
					{:else}
						cerca <strong>@{data.bot ?? 'il bot'}</strong> su Telegram e mandagli
						<code>/start {codice}</code>.
					{/if}
				</li>
				<li>
					<strong>2.</strong> Torna qui e premi il pulsante.
					<form method="POST" action="?/verifica" use:enhance class="mt-2">
						<Button type="submit">Ho mandato il messaggio</Button>
					</form>
				</li>
			</ol>
			<p class="text-muted-foreground mt-3 text-xs">
				Il tuo codice è <code>{codice}</code>: vale mezz’ora, poi se ne genera un altro.
			</p>
		</div>
	{:else}
		<div class="border-border rounded-lg border p-4">
			<p class="text-sm">
				Telegram non è collegato: gli avvisi restano solo nella casella. Collegarlo significa
				riceverli in chat, che è l’unico modo perché un conflitto ti raggiunga <em>prima</em> che tu abbia
				annunciato.
			</p>
			<form method="POST" action="?/collega" use:enhance class="mt-3">
				<Button type="submit">Collega Telegram</Button>
			</form>
		</div>
	{/if}
</section>

<!-- Le preferenze ---------------------------------------------------- -->
<section class="max-w-2xl">
	<h2 class="mb-3 text-base font-semibold">Cosa ricevere</h2>

	{#if form?.salvato}
		<p role="status" class="border-border mb-4 rounded-lg border p-3 text-sm">
			Preferenze salvate.
		</p>
	{/if}

	<form method="POST" action="?/salva" use:enhance class="grid gap-5">
		<fieldset class="grid gap-5">
			<legend class="sr-only">Avvisi che vuoi ricevere fuori dall’applicazione</legend>

			{#each voci as voce (voce.nome)}
				<div class="border-border rounded-lg border p-4">
					<label class="flex items-start gap-3">
						<input
							type="checkbox"
							name={voce.nome}
							checked={voce.acceso}
							class="mt-1 size-4 shrink-0"
						/>
						<span>
							<span class="block text-sm font-medium">{voce.etichetta}</span>
							<span class="text-muted-foreground mt-1 block text-sm">{voce.spiegazione}</span>
						</span>
					</label>
				</div>
			{/each}
		</fieldset>

		<div>
			<Button type="submit">Salva</Button>
		</div>
	</form>
</section>

<p class="text-muted-foreground mt-8 max-w-2xl text-sm">
	L’invito non è in questo elenco perché si rivolge a chi non ha ancora un profilo: non ha una chat
	collegata, e non c’è modo di dargliene una prima che entri. Il suo link si passa a mano.
</p>
