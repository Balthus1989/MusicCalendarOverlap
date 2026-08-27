<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import MobileHeader from '$lib/components/MobileHeader.svelte';
	import MobileTabBar from '$lib/components/MobileTabBar.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	/**
	 * Solo le rotte che esistono davvero: `resolve()` è tipizzato sui path
	 * generati da SvelteKit, quindi un link a una rotta non ancora costruita
	 * fallisce il typecheck invece di diventare un 404 silenzioso.
	 * La voce Conflitti non porta nessun segnalino. Ne aveva uno, alimentato da
	 * una query nel layout: girava su **ogni** pagina autenticata, ed è la
	 * query che si è vista restare bloccata su `wait_event = ClientRead`
	 * occupando l'unica connessione del pool. Un pallino non vale il percorso
	 * critico di tutta l'applicazione.
	 *
	 * Vale identico per Avvisi, aggiunta in Fase 6: il conteggio delle non
	 * lette esiste (`contaNonLette`) e sarebbe una query in più per richiesta.
	 * Chi deve accorgersi di un conflitto grave riceve una notifica sul canale
	 * di consegna — è il motivo per cui il layer di notifica esiste — e non un
	 * numerino in una barra.
	 *
	 * L'elenco è **uno solo** e le due navigazioni ne prendono fette diverse.
	 * Sopra `md:` si vede intero nella barra in alto, com'è sempre stato; sotto,
	 * le quattro voci del ciclo quotidiano stanno nella barra in basso e il
	 * resto dietro il `☰`. Tenerli in due elenchi separati significherebbe
	 * aggiungere una rotta e scoprire un mese dopo che sul telefono non c'è.
	 */
	const links = [
		{ path: '/calendar', label: 'Calendario', href: resolve('/calendar') },
		{ path: '/conflicts', label: 'Conflitti', href: resolve('/conflicts') },
		{ path: '/notifications', label: 'Avvisi', href: resolve('/notifications') },
		{ path: '/artists', label: 'Artisti', href: resolve('/artists') },
		{ path: '/venues', label: 'Locali', href: resolve('/venues') },
		{ path: '/org', label: 'Organizzazione', href: resolve('/org') },
		{ path: '/audit', label: 'Registro', href: resolve('/audit') },
		{ path: '/settings/feeds', label: 'Feed ed export', href: resolve('/settings/feeds') }
	] as const;

	const linkInviti = {
		path: '/admin/invites',
		label: 'Inviti',
		href: resolve('/admin/invites')
	} as const;

	const linksDesktop = $derived(data.profile.isPlatformAdmin ? [...links, linkInviti] : links);

	/** Le quattro della barra in basso: tre destinazioni e un'azione. */
	const principali = [
		{ ...links[0], icona: 'calendario' as const },
		{ ...links[1], icona: 'conflitti' as const },
		{ ...links[2], icona: 'avvisi' as const },
		{ path: '/events/new', label: 'Nuova', href: resolve('/events/new'), icona: 'nuova' as const }
	];

	/** Tutto il resto, dietro il `☰`. */
	const secondarie = $derived(
		data.profile.isPlatformAdmin ? [...links.slice(3), linkInviti] : [...links.slice(3)]
	);

	const isActive = (path: string) =>
		page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
</script>

<div class="flex min-h-svh flex-col">
	<!--
		Il salto al contenuto. Invisibile finché non riceve il focus, che è il
		momento in cui serve: la barra di navigazione ha otto voci, e senza
		questo link chi naviga da tastiera le riattraversa tutte a ogni pagina.
	-->
	<a
		href="#contenuto"
		class="bg-background focus:ring-ring sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm"
	>
		Salta al contenuto
	</a>

	<MobileHeader
		voci={secondarie}
		nomeUtente={data.profile.displayName}
		puoModerare={data.puoModerare}
	/>

	<header class="border-border hidden border-b md:block">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
			<a href={resolve('/calendar')} class="text-sm font-semibold tracking-tight">
				Calendario Eventi
			</a>

			<nav aria-label="Navigazione principale" class="flex flex-wrap gap-x-4 gap-y-1">
				{#each linksDesktop as link (link.path)}
					<!--
						`resolve()` è tipizzato su una rotta alla volta e non accetta un'unione
						di path, quindi la risoluzione avviene qui sopra, dove ogni letterale è
						noto e controllato uno per uno. All'ancora l'indirizzo arriva già
						risolto, e a dirlo è il tipo: `ResolvedPathname` lo produce solo
						`resolve()`. La regola resta accesa ovunque tranne su questa ancora.
					-->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={link.href}
						aria-current={isActive(link.path) ? 'page' : undefined}
						class={isActive(link.path)
							? 'text-foreground text-sm font-medium'
							: 'text-muted-foreground hover:text-foreground text-sm'}
					>
						{link.label}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</nav>

			<form method="POST" action={resolve('/auth/logout')} class="ml-auto flex items-center gap-3">
				<span class="text-muted-foreground text-sm">
					{data.profile.displayName}
					{#if data.puoModerare}
						<span
							class="border-border ml-1 rounded border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase"
							title="Puoi correggere, verificare e unire le schede di artisti e locali"
						>
							moderatore
						</span>
					{/if}
				</span>
				<button type="submit" class="text-sm underline underline-offset-4">Esci</button>
			</form>
		</div>
	</header>

	<!--
		`tabindex="-1"` sul contenuto: senza, il salto sposta lo scorrimento ma
		non il fuoco, e il tasto successivo riporta chi legge in cima alla
		navigazione — cioè esattamente dove non voleva tornare.

		Il margine in basso è l'altezza della barra fissa: senza, l'ultima riga
		di ogni pagina finisce sotto la navigazione, e su una pagina che scorre
		è l'unica riga che non si riesce a leggere in nessun modo.
	-->
	<main
		id="contenuto"
		tabindex="-1"
		class="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-4 sm:px-6 md:pt-8"
	>
		{@render children()}
	</main>

	<!--
		Il margine in basso della barra fissa vive qui e non più sul `<main>`:
		il piè di pagina è l'ultima cosa del flusso, ed è lui che deve stare
		sopra la navigazione invece di finirci sotto.
	-->
	<footer
		class="text-muted-foreground mx-auto w-full max-w-6xl px-4 pb-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] text-xs sm:px-6 md:pb-8"
	>
		<a href={resolve('/privacy')} class="underline underline-offset-4">Informativa privacy</a>
	</footer>

	<MobileTabBar voci={principali} />
</div>
