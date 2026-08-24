<script lang="ts">
	import { cambi, etichettaAzione, nomeAttore } from '$lib/audit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const quando = (d: Date | string) =>
		new Intl.DateTimeFormat('it-IT', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'Europe/Rome'
		}).format(new Date(d));

	const percentuale = (q: number) => `${Math.round(q * 100)}%`;

	const tipo = (t: string) => (t === 'event' ? 'data' : t === 'membership' ? 'membro' : t);
</script>

<svelte:head><title>Registro · Calendario Eventi</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Registro delle modifiche</h1>
<p class="text-muted-foreground mt-1 mb-8 text-sm">
	Chi ha cambiato cosa, e quando, nelle tue organizzazioni. Le date delle altre non compaiono: il
	registro conserva anche i valori precedenti, e fra quelli c’è il titolo che una serata aveva
	quando era ancora opzionata.
</p>

<section class="mb-10">
	<h2 class="mb-3 text-base font-semibold">Quante date passano da «opzionata»</h2>

	{#if data.metrica.quota === null}
		<p class="text-muted-foreground text-sm">
			Nessuna data confermata, ancora: non c’è niente da misurare.
		</p>
	{:else}
		<div class="border-border rounded-lg border p-4">
			<p class="text-2xl font-semibold tabular-nums">{percentuale(data.metrica.quota)}</p>
			<p class="text-muted-foreground mt-1 text-sm">
				{data.metrica.conHold} date su {data.metrica.totale} sono state opzionate prima di essere confermate;
				{data.metrica.senzaHold} sono nate o passate direttamente a confermate.
			</p>
			<p class="text-muted-foreground mt-3 text-sm">
				È la misura di successo del prodotto: serve ad accorgersi delle sovrapposizioni
				<em>prima</em> dell’annuncio. Se la seconda cifra prevale, il calendario sta funzionando come
				archivio di annunci già fatti — che è un uso legittimo, ma non quello per cui è stato costruito.
			</p>
		</div>
	{/if}
</section>

<section>
	<h2 class="mb-3 text-base font-semibold">Ultime modifiche</h2>

	{#if data.voci.length === 0}
		<p class="text-muted-foreground text-sm">Nessuna modifica registrata.</p>
	{:else}
		<div class="border-border overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="bg-muted/50 text-muted-foreground text-left">
					<tr>
						<th scope="col" class="px-3 py-2 font-medium">Quando</th>
						<th scope="col" class="px-3 py-2 font-medium">Chi</th>
						<th scope="col" class="px-3 py-2 font-medium">Cosa</th>
						<th scope="col" class="px-3 py-2 font-medium">Modifica</th>
					</tr>
				</thead>
				<tbody>
					{#each data.voci as voce (voce.id)}
						<tr class="border-border border-t align-top">
							<td class="text-muted-foreground px-3 py-2 whitespace-nowrap">
								<time datetime={new Date(voce.createdAt).toISOString()}>
									{quando(voce.createdAt)}
								</time>
							</td>
							<td class="px-3 py-2">{nomeAttore(voce.attore)}</td>
							<td class="px-3 py-2">
								<span class="text-muted-foreground text-xs">{tipo(voce.entityType)}</span><br />
								{voce.oggetto}
							</td>
							<td class="px-3 py-2">
								{#if cambi(voce).length}
									<ul>
										{#each cambi(voce) as c (c.campo)}
											<li>{c.campo}: {c.prima} → {c.dopo}</li>
										{/each}
									</ul>
								{:else}
									{etichettaAzione(voce.action)}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
