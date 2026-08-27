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

/* ------------------------------------------------------------------ *
 * Eventi
 * ------------------------------------------------------------------ */

/**
 * Sugli eventi il platform admin **non** ha scorciatoie, a differenza di
 * quanto fa `hasOrgRole`.
 *
 * Il motivo è lo stesso per cui `serializeEvent` lo tratta come un estraneo:
 * ADR-0005 promette agli organizzatori che le loro date sono loro. Una
 * promessa che vale contro i concorrenti ma non contro chi amministra il
 * server non è la promessa che si è fatta. Amministrare inviti e tassonomie
 * non è amministrare il cartellone di un'associazione.
 */
function membroEffettivo(viewer: Viewer, organizationId: string): MemberRole | null {
	return viewer.roles[organizationId] ?? null;
}

/** Creare una data per un'organizzazione: basta esserne membri, a qualunque titolo. */
export function canCreateEvent(viewer: Viewer, organizationId: string): boolean {
	return membroEffettivo(viewer, organizationId) !== null;
}

/**
 * Segnalare la data di un organizzatore **non iscritto** (ADR-0044).
 *
 * Basta appartenere a una qualunque organizzazione: chi è dentro il calendario
 * può dire ciò che sa del cartellone attorno. Non serve un ruolo, perché la
 * segnalazione non tocca le date di nessuno — ne aggiunge una che non è di
 * nessuno.
 */
export function canReportExternalEvent(viewer: Viewer): boolean {
	return Object.keys(viewer.roles).length > 0;
}

/**
 * La data appartiene a un organizzatore non iscritto: non è di nessuno, e
 * quindi si **cura** invece di governarla (ADR-0044).
 *
 * È lo stesso ragionamento di ADR-0016 sulle schede di artisti e venue. Senza
 * questa eccezione una data segnalata non sarebbe modificabile da nessuno —
 * `membroEffettivo` è `null` per tutti su un'organizzazione senza membri — e
 * ogni refuso finirebbe in `db:studio`.
 *
 * Non intacca ADR-0019: vale solo dove `esterna` è vera, cioè dove non c'è
 * nessuno a cui la data possa essere sottratta.
 */
export type EventoDaAutorizzare = {
	organizationId: string;
	/**
	 * `organizations.esterna` dell'organizzazione proprietaria. **Obbligatorio
	 * di proposito**: se fosse opzionale, chi carica un evento senza la
	 * colonna otterrebbe `false` e una data segnalata diventerebbe
	 * immodificabile da chiunque, senza che niente lo segnali. Così invece è
	 * il compilatore a chiedere il campo a ogni punto di chiamata.
	 */
	organizzazioneEsterna: boolean;
};

/**
 * Da una riga di evento letta con la sua organizzazione alla forma che i
 * controlli si aspettano. Esiste per non ripetere lo stesso appiattimento in
 * ogni rotta, e perché il campo che conta si chiami sempre allo stesso modo.
 */
export function autorizzabile(e: {
	organizationId: string;
	organization: { esterna: boolean };
}): EventoDaAutorizzare {
	return { organizationId: e.organizationId, organizzazioneEsterna: e.organization.esterna };
}

/**
 * Modificare una data, cambiarne lo stato, toccarne la lineup: chiunque sia
 * dentro l'organizzazione proprietaria. Chi inserisce le date, in un circolo,
 * spesso non è chi lo governa.
 *
 * Se l'organizzazione proprietaria è esterna non c'è nessun "dentro": decide
 * la curatela.
 */
export function canEditEvent(viewer: Viewer, event: EventoDaAutorizzare): boolean {
	if (event.organizzazioneEsterna) return canModerateCatalog(viewer);
	return membroEffettivo(viewer, event.organizationId) !== null;
}

/**
 * Cancellare davvero una data: da `admin` in su.
 *
 * Quasi sempre la cosa giusta è annullarla, non cancellarla: l'annullamento
 * lascia agli altri l'informazione che lo slot si è liberato. La cancellazione
 * serve solo per le date inserite per errore.
 *
 * Su una data segnalata la cancellazione è il rimedio ordinario e non
 * l'eccezione — una segnalazione sbagliata non ha uno slot da liberare, non è
 * mai esistita — quindi la può fare chi la può correggere (ADR-0044).
 */
export function canDeleteEvent(viewer: Viewer, event: EventoDaAutorizzare): boolean {
	if (event.organizzazioneEsterna) return canModerateCatalog(viewer);
	const ruolo = membroEffettivo(viewer, event.organizationId);
	return ruolo === 'admin' || ruolo === 'owner';
}
