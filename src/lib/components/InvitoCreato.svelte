<script lang="ts">
	import { page } from '$app/state';

	type Props = {
		/** Codice dell'invito appena generato. */
		code: string;
		/** Indirizzo a cui era destinato, se chi l'ha creato l'aveva indicato. */
		email?: string | null;
	};

	let { code, email = null }: Props = $props();

	const link = $derived(`${page.url.origin}/invite/${code}`);

	// Il canale dell'invito e' la casella di chi lo manda, non il server: chi
	// riceve non ha ancora un profilo, quindi non ha nessun canale collegato
	// (ADR-0039). Un `mailto:` e' l'unico modo di mandarlo per email senza un
	// dominio verificato, e fa partire il messaggio dall'indirizzo che
	// l'invitato riconosce.
	const mailto = $derived(
		`mailto:${encodeURIComponent(email ?? '')}` +
			`?subject=${encodeURIComponent('Invito al Calendario Eventi Condiviso')}` +
			`&body=${encodeURIComponent(
				'Ciao,\n\nti invito sul Calendario Eventi Condiviso, dove ci coordiniamo sulle date' +
					' dei concerti prima di annunciarle.\n\nApri questo link per entrare:\n' +
					link +
					'\n\nA presto.\n'
			)}`
	);
</script>

<div class="border-border bg-card mb-4 rounded-lg border p-4">
	<p class="text-sm font-medium">Invito creato.</p>
	<p class="text-muted-foreground mt-1 text-sm">
		Il link va mandato a mano: l'applicazione non spedisce nessuna email, perché chi lo riceve non
		ha ancora un profilo e quindi nessun canale su cui essere raggiunto. Vale finché non scade o non
		finisce gli utilizzi.
	</p>
	<code class="mt-2 block overflow-x-auto text-xs">{link}</code>
	<a href={mailto} class="mt-3 inline-block text-sm underline" data-testid="invito-mailto">
		Apri l'email già scritta{email ? ` per ${email}` : ''}
	</a>
</div>
