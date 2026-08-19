<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	/**
	 * Solo le rotte che esistono davvero: `resolve()` è tipizzato sui path
	 * generati da SvelteKit, quindi un link a una rotta non ancora costruita
	 * fallisce il typecheck invece di diventare un 404 silenzioso.
	 * Conflitti arriva in Fase 3.
	 */
	const links = [
		{ path: '/calendar', label: 'Calendario' },
		{ path: '/artists', label: 'Artisti' },
		{ path: '/venues', label: 'Locali' },
		{ path: '/org', label: 'Organizzazione' }
	] as const;

	const isActive = (path: string) =>
		page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
</script>

<div class="flex min-h-svh flex-col">
	<header class="border-border border-b">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
			<a href={resolve('/calendar')} class="text-sm font-semibold tracking-tight">
				Calendario Eventi
			</a>

			<nav aria-label="Navigazione principale" class="flex flex-wrap gap-x-4 gap-y-1">
				{#each links as link (link.path)}
					<a
						href={resolve(link.path)}
						aria-current={isActive(link.path) ? 'page' : undefined}
						class={isActive(link.path)
							? 'text-foreground text-sm font-medium'
							: 'text-muted-foreground hover:text-foreground text-sm'}
					>
						{link.label}
					</a>
				{/each}

				{#if data.profile.isPlatformAdmin}
					<a
						href={resolve('/admin/invites')}
						aria-current={isActive('/admin/invites') ? 'page' : undefined}
						class={isActive('/admin/invites')
							? 'text-foreground text-sm font-medium'
							: 'text-muted-foreground hover:text-foreground text-sm'}
					>
						Inviti
					</a>
				{/if}
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

	<main class="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
		{@render children()}
	</main>
</div>
