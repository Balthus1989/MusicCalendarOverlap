/**
 * Prerenderizzata: è l'unica pagina che il service worker mette in cache, e
 * per poterlo fare deve essere un file statico. Non ha `load` e non tocca il
 * database — se lo facesse, non sarebbe una pagina da mostrare senza rete.
 */
export const prerender = true;
