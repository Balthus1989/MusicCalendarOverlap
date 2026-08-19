/**
 * Calcolo del `path` materializzato della tassonomia generi (ADR-0007).
 *
 * Il path è la chiave su cui in Fase 3 si calcola l'affinità di genere per
 * prefisso comune: `metal.death-metal.tech-death`. Codice puro, testato — è
 * un ingrediente del motore conflitti, non un dettaglio di presentazione.
 */

export const PATH_SEPARATOR = '.';

export type GenreNode = {
	slug: string;
	parentSlug: string | null;
};

/** Il path di un genere è la catena di slug dalla radice fino a lui. */
export function buildPath(slug: string, parentPath: string | null): string {
	return parentPath ? `${parentPath}${PATH_SEPARATOR}${slug}` : slug;
}

/** La profondità è il numero di separatori: 0 per le radici. */
export function depthOf(path: string): number {
	return path.split(PATH_SEPARATOR).length - 1;
}

/** Segmenti del path, dalla radice alla foglia. */
export function segmentsOf(path: string): string[] {
	return path.split(PATH_SEPARATOR);
}

/**
 * Vero se `parent` è antenato di `child` (o lo stesso nodo).
 *
 * Il confronto è per segmenti, non per stringa: `startsWith` direbbe che
 * `metal` è prefisso di `metalcore`, che invece è un genere a sé.
 */
export function isAncestorPath(parent: string, child: string): boolean {
	if (parent === child) return true;
	return child.startsWith(parent + PATH_SEPARATOR);
}

/**
 * Profondità del prefisso comune fra due path, in numero di segmenti
 * condivisi. È il numeratore del calcolo di affinità di ARCHITECTURE.md §6.3.
 */
export function commonPrefixDepth(a: string, b: string): number {
	const sa = segmentsOf(a);
	const sb = segmentsOf(b);
	let n = 0;
	while (n < sa.length && n < sb.length && sa[n] === sb[n]) n++;
	return n;
}

/**
 * Risolve i path di un albero dato in forma piatta (slug + parentSlug).
 *
 * Restituisce una mappa slug → { path, depth }. Solleva se incontra un
 * genitore inesistente o un ciclo: la tassonomia è versionata in un seed, e
 * un errore lì va scoperto al seed, non a runtime.
 */
export function resolveTree(nodes: GenreNode[]): Map<string, { path: string; depth: number }> {
	const bySlug = new Map(nodes.map((n) => [n.slug, n]));
	const risolti = new Map<string, { path: string; depth: number }>();

	const risolvi = (slug: string, visitati: Set<string>): string => {
		const gia = risolti.get(slug);
		if (gia) return gia.path;

		if (visitati.has(slug)) {
			throw new Error(`Ciclo nella tassonomia generi, allo slug "${slug}".`);
		}
		visitati.add(slug);

		const nodo = bySlug.get(slug);
		if (!nodo) throw new Error(`Genere "${slug}" non trovato nella tassonomia.`);

		const parentPath = nodo.parentSlug ? risolvi(nodo.parentSlug, visitati) : null;
		const path = buildPath(nodo.slug, parentPath);
		risolti.set(slug, { path, depth: depthOf(path) });
		return path;
	};

	for (const n of nodes) risolvi(n.slug, new Set());
	return risolti;
}
