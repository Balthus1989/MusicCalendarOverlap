/**
 * Layer di serializzazione della visibilità (ARCHITECTURE.md §5, ADR-0005).
 *
 * Regola non negoziabile: **nessun handler restituisce mai una riga `events`
 * grezza al client.** Tutto passa da `serializeEvent()`.
 *
 * In Fase 0 esiste solo il contesto del viewer: `serializeEvent()` arriva in
 * Fase 2 insieme alla tabella `events`, con un test per ogni cella della
 * matrice di visibilità.
 */

export type ViewerContext = {
	profileId: string;
	organizationIds: string[];
	isPlatformAdmin: boolean;
};

/** Vero se il viewer appartiene all'organizzazione proprietaria della risorsa. */
export function ownsOrganization(viewer: ViewerContext, organizationId: string): boolean {
	return viewer.organizationIds.includes(organizationId);
}
