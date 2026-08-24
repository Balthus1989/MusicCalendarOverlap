<script lang="ts">
	/**
	 * "Riprova" è un pulsante e non un link, per due ragioni che coincidono.
	 *
	 * Semanticamente ricaricare non è navigare: si vuole tornare esattamente
	 * dove si era. E praticamente, un `<a href="/calendar">` qui dentro
	 * verrebbe seguito dal prerender in fase di build — questa pagina è
	 * statica — che proverebbe a prerenderizzare il calendario e fallirebbe,
	 * perché il calendario ha bisogno di una sessione.
	 */
	function riprova() {
		location.reload();
	}
</script>

<svelte:head>
	<title>Senza rete · Calendario Eventi</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-6 py-12">
	<h1 class="text-2xl font-semibold tracking-tight">Sei senza rete</h1>

	<p class="text-muted-foreground mt-3 text-sm">
		Il calendario non ha una copia locale delle date, ed è voluto: quello che vedi dipende da chi
		sei, e una copia salvata sul telefono continuerebbe a mostrare cose che nel frattempo hanno
		smesso di essere tue da vedere.
	</p>

	<p class="text-muted-foreground mt-3 text-sm">
		Torna quando hai una connessione. Se stavi compilando una data, il modulo è ancora nella scheda
		da cui sei arrivato: non ricaricarla.
	</p>

	<p class="mt-6 text-sm">
		<button type="button" class="underline underline-offset-4" onclick={riprova}>Riprova</button>
	</p>
</main>
