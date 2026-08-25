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
</script>

<svelte:head><title>Impostazioni di notifica · Calendario Eventi</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Impostazioni di notifica</h1>
<p class="text-muted-foreground mt-1 mb-6 text-sm">
	Questi interruttori governano gli avvisi che ti raggiungono <strong
		>fuori dall’applicazione</strong
	>. Qualunque cosa scegli, restano tutti leggibili nella
	<a class="underline underline-offset-4" href={resolve('/notifications')}>casella degli avvisi</a>.
</p>

{#if data.canaliAttivi.length === 0}
	<p class="border-border mb-6 rounded-lg border p-4 text-sm">
		<strong>Nessun canale è configurato su questo server</strong>, quindi al momento non ti
		raggiunge niente: gli avvisi restano in coda e si leggono solo qui dentro. Le preferenze qui
		sotto si salvano lo stesso, e valgono dal momento in cui un canale ci sarà.
	</p>
{/if}

{#if form?.salvato}
	<p role="status" class="border-border mb-4 rounded-lg border p-3 text-sm">Preferenze salvate.</p>
{/if}
{#if form?.errore}
	<p role="alert" class="border-border mb-4 rounded-lg border p-3 text-sm">{form.errore}</p>
{/if}

<form method="POST" action="?/salva" use:enhance class="grid max-w-2xl gap-5">
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

<p class="text-muted-foreground mt-8 max-w-2xl text-sm">
	L’invito non è in questo elenco perché si rivolge a chi non ha ancora un profilo: non c’è nessun
	canale su cui raggiungerlo, e il suo link si passa a mano.
</p>
