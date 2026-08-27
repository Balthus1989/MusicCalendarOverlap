<script lang="ts">
	/**
	 * La barra di navigazione in basso, solo sotto `md:`.
	 *
	 * Quattro voci e non otto, perché il ciclo quotidiano di un organizzatore è
	 * uno solo: guardo il calendario, vedo una sovrapposizione, alzo il telefono
	 * (ARCHITECTURE.md §1). Anagrafiche, registro e feed sono manutenzione e si
	 * fanno da seduti: stanno dietro il `☰` di `MobileHeader`.
	 *
	 * "Nuova data" è un'**azione**, non una destinazione, ed è qui perché è la
	 * cosa che si fa in piedi davanti a un locale, col telefono in una mano.
	 * Per questo la pagina calendario nasconde il proprio pulsante sotto `md:`:
	 * due porte per la stessa stanza, a mezzo metro di distanza, si scambiano
	 * per due stanze.
	 *
	 * Lo stato attivo non si affida al solo colore — la stessa ragione per cui
	 * gli stati delle date nel calendario si leggono dal tratteggio: c'è un
	 * `aria-current` per chi ascolta e una barretta sopra la voce per chi
	 * guarda.
	 */
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';

	type Voce = {
		path: string;
		href: ResolvedPathname;
		label: string;
		icona: 'calendario' | 'conflitti' | 'avvisi' | 'nuova';
	};

	let { voci }: { voci: readonly Voce[] } = $props();

	const isActive = (path: string) =>
		page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
</script>

{#snippet icona(nome: Voce['icona'], attiva: boolean)}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width={attiva ? 2.25 : 1.75}
		stroke-linecap="round"
		stroke-linejoin="round"
		class="size-5"
		aria-hidden="true"
	>
		{#if nome === 'calendario'}
			<rect x="3" y="5" width="18" height="16" rx="2" />
			<path d="M3 10h18M8 3v4M16 3v4" />
		{:else if nome === 'conflitti'}
			<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
			<path d="M12 9v4M12 17h.01" />
		{:else if nome === 'avvisi'}
			<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.7 21a2 2 0 0 1-3.4 0" />
		{:else}
			<path d="M12 5v14M5 12h14" />
		{/if}
	</svg>
{/snippet}

<!--
	`env(safe-area-inset-bottom)` vale 0 finché il viewport non è `cover`, ed è
	scritto lo stesso: l'app è installabile (Fase 6) e in standalone il pollice
	arriva fin sotto la barra di sistema.
-->
<nav
	aria-label="Navigazione principale"
	class="border-border bg-background fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
>
	<ul class="mx-auto flex max-w-lg">
		{#each voci as voce (voce.path)}
			{@const attiva = isActive(voce.path)}
			<li class="flex-1">
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
					aria-current={attiva ? 'page' : undefined}
					class={[
						'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[0.6875rem] leading-tight',
						attiva ? 'text-foreground font-medium' : 'text-muted-foreground'
					]}
				>
					{#if attiva}
						<span class="bg-foreground absolute inset-x-3 top-0 h-0.5 rounded-b" aria-hidden="true"
						></span>
					{/if}
					{#if voce.icona === 'nuova'}
						<span
							class="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full"
						>
							{@render icona('nuova', attiva)}
						</span>
					{:else}
						{@render icona(voce.icona, attiva)}
					{/if}
					<span>{voce.label}</span>
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>
</nav>
