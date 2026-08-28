<script lang="ts">
	/**
	 * La barra in alto sotto `md:`: titolo e `☰`, niente altro.
	 *
	 * Prima qui c'erano nove link in un `flex-wrap`: su 393px diventavano due
	 * righe piene di testo da 14px, più una terza con nome utente e "Esci"
	 * spinto a filo del bordo destro dal suo `ml-auto` — il bersaglio tattile
	 * peggiore possibile, perché il pollice ci arriva sopra dal bordo.
	 *
	 * Il pannello è un `<details>` e non un `<dialog>` di proposito: si apre e
	 * si chiude **senza JavaScript**. Le voci secondarie sono l'unica strada per
	 * uscire dall'applicazione o raggiungere le anagrafiche, e la barra in alto
	 * per desktop resta `display:none` sul telefono: se il pannello dipendesse
	 * dall'idratazione, un'idratazione fallita chiuderebbe fuori da tutto.
	 * Con JavaScript si aggiungono solo le rifiniture — Esc e blocco dello
	 * scorrimento — che senza mancano senza fare danni.
	 */
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { STRETTO } from '$lib/breakpoint';
	import type { ResolvedPathname } from '$app/types';

	type Voce = { path: string; href: ResolvedPathname; label: string };

	let {
		voci,
		nomeUtente,
		puoModerare
	}: { voci: readonly Voce[]; nomeUtente: string; puoModerare: boolean } = $props();

	let aperto = $state(false);

	const isActive = (path: string) =>
		page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);

	/* Cambiare pagina chiude il pannello: la navigazione non ricarica il
	   documento, quindi il `<details>` resterebbe aperto sopra la pagina nuova. */
	afterNavigate(() => {
		aperto = false;
	});

	/**
	 * Uscire da `md:` chiude il pannello.
	 *
	 * L'intestazione è `md:hidden`: riallargando la finestra sparisce per CSS,
	 * ma `aperto` resterebbe vero, e con lui il blocco dello scorrimento qui
	 * sotto — l'unica cosa del pannello che sopravvive a `display:none`, perché
	 * è scritta su `body` e non dentro l'intestazione. Restava una pagina
	 * desktop che non scorre e nessun pannello in vista da chiudere: per
	 * sbloccarla bisognava restringere di nuovo la finestra.
	 *
	 * Si chiude, e non si toglie soltanto il blocco: il pannello va lasciato
	 * nello stato in cui lo si ritroverebbe riscendendo sotto `md:`, che è
	 * chiuso. Riaperto da solo sopra il calendario sarebbe un pannello che
	 * nessuno ha riaperto.
	 */
	$effect(() => {
		const mq = window.matchMedia(STRETTO);
		const cambia = (e: MediaQueryListEvent) => {
			if (!e.matches) aperto = false;
		};
		mq.addEventListener('change', cambia);
		return () => mq.removeEventListener('change', cambia);
	});

	/* Lo sfondo non deve scorrere sotto il pannello: su un telefono lo
	   scorrimento "passa attraverso" e si perde il punto in cui si era. */
	$effect(() => {
		if (!aperto) return;
		const precedente = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = precedente;
		};
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && aperto) aperto = false;
	}}
/>

<header
	class="border-border bg-background sticky top-0 z-40 border-b px-4 py-2 md:hidden"
	style="padding-top: max(0.5rem, env(safe-area-inset-top))"
>
	<div class="flex items-center justify-between gap-3">
		<a href={resolve('/calendar')} class="text-sm font-semibold tracking-tight">
			Calendario Eventi
		</a>

		<details bind:open={aperto}>
			<summary
				class="hover:bg-muted flex size-11 cursor-pointer list-none items-center justify-center rounded-md [&::-webkit-details-marker]:hidden"
				aria-label={aperto ? 'Chiudi il menu' : 'Apri il menu'}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					class="size-6"
					aria-hidden="true"
				>
					{#if aperto}
						<path d="M6 6l12 12M18 6L6 18" />
					{:else}
						<path d="M4 7h16M4 12h16M4 17h16" />
					{/if}
				</svg>
			</summary>

			<!--
				Il velo è un `<button>` e non un `<div>`: chiudere toccando fuori
				dal pannello dev'essere una cosa sola con il chiuderlo da tastiera,
				non un gesto che esiste solo per chi tocca.
			-->
			<button
				type="button"
				aria-label="Chiudi il menu"
				class="fixed inset-0 top-0 z-40 bg-black/60"
				onclick={() => (aperto = false)}
			></button>

			<div
				class="border-border bg-popover text-popover-foreground fixed inset-y-0 right-0 z-50 flex w-[min(20rem,85vw)] flex-col overflow-y-auto border-l shadow-2xl"
			>
				<div class="border-border flex items-start justify-between gap-3 border-b px-4 py-3">
					<span class="text-sm">
						<span class="block font-medium">{nomeUtente}</span>
						{#if puoModerare}
							<span
								class="border-border text-muted-foreground mt-1 inline-block rounded border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase"
								title="Puoi correggere, verificare e unire le schede di artisti e locali"
							>
								moderatore
							</span>
						{/if}
					</span>
					<button
						type="button"
						class="hover:bg-muted -mr-2 flex size-11 shrink-0 items-center justify-center rounded-md"
						aria-label="Chiudi il menu"
						onclick={() => (aperto = false)}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							class="size-5"
							aria-hidden="true"
						>
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>

				<nav aria-label="Altre sezioni" class="flex-1 py-2">
					<ul>
						{#each voci as voce (voce.path)}
							<li>
								<!--
									`resolve()` è tipizzato su una rotta alla volta e non accetta un'unione
									di path, quindi la risoluzione avviene nel layout, dove ogni letterale è
									noto e controllato una rotta per volta. Qui l'indirizzo arriva già
									risolto, e a dirlo è il tipo: `ResolvedPathname` lo produce solo
									`resolve()`. La regola resta accesa ovunque tranne su questa ancora.
								-->
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={voce.href}
									aria-current={isActive(voce.path) ? 'page' : undefined}
									class={[
										'hover:bg-muted flex min-h-12 items-center px-4 text-sm',
										isActive(voce.path) ? 'text-foreground font-medium' : 'text-muted-foreground'
									]}
								>
									{voce.label}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</li>
						{/each}
					</ul>
				</nav>

				<form
					method="POST"
					action={resolve('/auth/logout')}
					class="border-border border-t px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
				>
					<button
						type="submit"
						class="flex min-h-12 items-center text-sm underline underline-offset-4">Esci</button
					>
				</form>
			</div>
		</details>
	</div>
</header>
