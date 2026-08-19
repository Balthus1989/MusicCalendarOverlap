/**
 * Autorizzazioni. Tutte le decisioni di permesso passano da qui: se un giorno
 * il modello dei ruoli cambia, cambia questo file e nient'altro.
 *
 * Due assi indipendenti (ADR-0016):
 * - **dentro l'organizzazione**: `owner` > `admin` > `member`. Governa i dati
 *   che appartengono a quell'organizzazione.
 * - **sulle anagrafiche condivise** (artisti, venue): `moderator`, più i
 *   platform admin. Artisti e venue non appartengono a nessuno, quindi il
 *   permesso di correggerli non può derivare dal ruolo in un'organizzazione.
 */
import type { MemberRole } from '$lib/server/db/schema';

export type Viewer = {
	profileId: string;
	isPlatformAdmin: boolean;
	/** Ruolo per ciascuna organizzazione di cui il profilo è membro. */
	roles: Record<string, MemberRole>;
};

const GERARCHIA: Record<MemberRole, number> = {
	member: 0,
	// Il moderatore non governa l'organizzazione: il suo potere è altrove.
	// Dentro l'organizzazione conta come un membro qualunque.
	moderator: 0,
	admin: 1,
	owner: 2
};

export function roleIn(viewer: Viewer, organizationId: string): MemberRole | null {
	return viewer.roles[organizationId] ?? null;
}

export function isMemberOf(viewer: Viewer, organizationId: string): boolean {
	return organizationId in viewer.roles;
}

/** Vero se il ruolo nell'organizzazione è almeno quello richiesto. */
export function hasOrgRole(
	viewer: Viewer,
	organizationId: string,
	minimo: Exclude<MemberRole, 'moderator'>
): boolean {
	if (viewer.isPlatformAdmin) return true;
	const ruolo = roleIn(viewer, organizationId);
	if (!ruolo) return false;
	return GERARCHIA[ruolo] >= GERARCHIA[minimo];
}

/**
 * Vero se il profilo può correggere le anagrafiche condivise di **chiunque**:
 * rinominare un artista, unire due doppioni, spostare un venue.
 *
 * È deliberatamente scollegato dall'organizzazione: il moderatore lo è per
 * tutto il calendario o non lo è affatto.
 */
export function canModerateCatalog(viewer: Viewer): boolean {
	if (viewer.isPlatformAdmin) return true;
	return Object.values(viewer.roles).includes('moderator');
}

/**
 * Chiunque sia autenticato può creare un artista o un venue: l'anagrafica è un
 * bene comune e alzare la barriera all'inserimento la farebbe morire vuota.
 */
export function canCreateCatalogEntry(viewer: Viewer): boolean {
	return Object.keys(viewer.roles).length > 0 || viewer.isPlatformAdmin;
}

/**
 * Modificare una voce di anagrafica: chi l'ha inserita finché non è verificata,
 * oppure un moderatore. Una voce `is_verified` è stata curata da qualcuno: da
 * lì in poi si tocca solo con i permessi di moderazione.
 */
export function canEditCatalogEntry(
	viewer: Viewer,
	entry: { createdBy: string | null; isVerified: boolean }
): boolean {
	if (canModerateCatalog(viewer)) return true;
	if (entry.isVerified) return false;
	return entry.createdBy !== null && entry.createdBy === viewer.profileId;
}

/** Solo i moderatori marcano una voce come verificata. */
export function canVerifyCatalogEntry(viewer: Viewer): boolean {
	return canModerateCatalog(viewer);
}

/** Unire due doppioni è distruttivo e irreversibile: solo moderatori. */
export function canMergeCatalogEntries(viewer: Viewer): boolean {
	return canModerateCatalog(viewer);
}

/** Invitare qualcuno nella propria organizzazione: da `admin` in su. */
export function canInviteToOrg(viewer: Viewer, organizationId: string): boolean {
	return hasOrgRole(viewer, organizationId, 'admin');
}

/** Modificare l'anagrafica dell'organizzazione: da `admin` in su. */
export function canEditOrg(viewer: Viewer, organizationId: string): boolean {
	return hasOrgRole(viewer, organizationId, 'admin');
}

/** Cambiare i ruoli dei membri, incluso nominare moderatori: solo `owner`. */
export function canManageMembers(viewer: Viewer, organizationId: string): boolean {
	return hasOrgRole(viewer, organizationId, 'owner');
}

/** Generare inviti che creano organizzazioni nuove: solo platform admin. */
export function canCreateOrgInvite(viewer: Viewer): boolean {
	return viewer.isPlatformAdmin;
}
