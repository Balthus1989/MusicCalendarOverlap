<script lang="ts">
	import { page } from '$app/state';
	import type { EsitoInvio } from '$lib/schemas/invite';

	type Props = {
		/** Codice dell'invito appena generato. */
		code: string;
		/** Indirizzo a cui era destinato, se chi l'ha creato l'aveva indicato. */
		email?: string | null;
		/** Che cosa ha fatto l'invio. Assente = non ci si è nemmeno provato. */
		esito?: EsitoInvio | null;
	};

	let { code, email = null, esito = null }: Props = $props();

	const link = $derived(`${page.url.origin}/invite/${code}`);

	/**
	 * Il `mailto:` resta anche quando l'email è partita da sé.
	 *
	 * Non è ridondanza: è la strada per i tre casi in cui l'invio non c'è stato
	 * — nessun indirizzo, indirizzo già iscritto, chiave di servizio assente in
	 * locale — e resta comodo per chi vuole aggiungere due righe sue.
	 */
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

	const spiegazione = $derived.by(() => {
		switch (esito) {
			case 'inviato':
				return {
					titolo: 'Invito mandato.',
					testo: `L'email è partita${email ? ` a ${email}` : ''} dalla casella configurata su Supabase. Il link qui sotto vale lo stesso, se preferisci passarlo a mano.`
				};
			case 'inviato-destinazione-vecchia':
				return {
					titolo: 'Invito mandato — ma il link nell’email porta altrove.',
					testo: `L'email è partita${email ? ` a ${email}` : ''}, e il suo link di accesso funziona. Non è stato però possibile aggiornare la destinazione su Supabase: chi lo apre entra e finisce sull'invito precedente, non su questo. Passagli il link qui sotto a mano.`
				};
			case 'gia-iscritto':
				return {
					titolo: 'Invito creato — email non mandata.',
					testo: `${email ?? "Quell'indirizzo"} ha già un account: non gli si manda un invito a iscriversi, gli si manda il link. Da lì entra con il suo accesso di sempre.`
				};
			case 'senza-indirizzo':
				return {
					titolo: 'Invito creato.',
					testo:
						'Non hai indicato nessun indirizzo, quindi non è partita nessuna email: il link va passato a mano. È un uso legittimo, non un passaggio saltato.'
				};
			case 'non-configurato':
				return {
					titolo: 'Invito creato — email non mandata.',
					testo:
						'Manca la chiave di servizio di Supabase, quindi da qui non parte posta. In locale è la norma: il link si passa a mano.'
				};
			case 'fallito':
				return {
					titolo: 'Invito creato — email non partita.',
					testo:
						'Il servizio di posta non ha accettato il messaggio. L’invito è valido lo stesso: passa il link a mano, e controlla il registro del server per sapere perché.'
				};
			default:
				return {
					titolo: 'Invito creato.',
					testo: 'Il link va mandato a mano: vale finché non scade o non finisce gli utilizzi.'
				};
		}
	});
</script>

<div class="border-border bg-card mb-4 rounded-lg border p-4">
	<p class="text-sm font-medium">{spiegazione.titolo}</p>
	<p class="text-muted-foreground mt-1 text-sm">{spiegazione.testo}</p>
	<code class="mt-2 block overflow-x-auto text-xs">{link}</code>
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `mailto:` apre il client di posta, non una rotta dell'applicazione. -->
	<a href={mailto} class="mt-3 inline-block text-sm underline" data-testid="invito-mailto">
		{esito === 'inviato' ? 'Scrivigli anche tu' : "Apri l'email già scritta"}{email
			? ` (${email})`
			: ''}
	</a>
</div>
