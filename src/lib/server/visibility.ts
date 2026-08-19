/**
 * Layer di serializzazione della visibilità (ARCHITECTURE.md §5, ADR-0005).
 *
 * Regola non negoziabile: **nessun handler restituisce mai una riga `events`
 * grezza al client.** Tutto passa da `serializeEvent()`.
 *
 * In Fase 1 esiste il contesto del viewer; `serializeEvent()` arriva in Fase 2
 * insieme alla tabella `events`, con un test per ogni cella della matrice.
 */
import type { MemberRole } from '$lib/server/db/schema';

export type ViewerContext = {
	profileId: string;
	/**
	 * Organizzazioni di cui il profilo è membro. La matrice di visibilità
	 * distingue solo "mia" da "non mia": il ruolo non entra mai nel calcolo di
	 * cosa si vede, solo in quello di cosa si può modificare.
	 */
	organizationIds: string[];
	/** Ruolo per organizzazione, per i controlli in `auth/permissions.ts`. */
	roles: Record<string, MemberRole>;
	isPlatformAdmin: boolean;
};

/** Vero se il viewer appartiene all'organizzazione proprietaria della risorsa. */
export function ownsOrganization(viewer: ViewerContext, organizationId: string): boolean {
	return viewer.organizationIds.includes(organizationId);
}
