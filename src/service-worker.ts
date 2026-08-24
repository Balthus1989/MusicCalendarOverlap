/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Il service worker della PWA (ARCHITECTURE.md §12, Fase 6).
 *
 * **La regola che conta è una sola, ed è una regola di visibilità: qui dentro
 * non si mette in cache nessuna risposta che contenga dati di dominio.**
 *
 * Tutto il prodotto è costruito sul fatto che ogni riga esce da
 * `serializeEvent` con il contesto di chi la sta guardando (ADR-0005). Una
 * cache nel browser è l'unico posto dell'architettura dove una risposta
 * sopravvive al contesto che l'ha prodotta: basta un secondo profilo sullo
 * stesso browser, o un cambio di membership, perché la copia salvata racconti
 * a qualcuno una data che non ha il diritto di vedere. E non si tratta di
 * dati qualunque — è esattamente la lineup che lo stato `hold` protegge.
 *
 * Quindi in cache ci va solo ciò che è **uguale per tutti**: i file compilati
 * dell'applicazione, gli asset statici e una pagina che dice che la rete non
 * c'è. Il resto passa dalla rete o non passa.
 *
 * Il guscio offline è deliberatamente povero. Un calendario condiviso serve a
 * coordinarsi con qualcun altro: fingere che funzioni senza rete sarebbe
 * peggio che dire che non c'è.
 */
import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * Il nome della cache contiene la versione della build: a ogni rilascio la
 * vecchia diventa irraggiungibile e viene cancellata nell'`activate`. È anche
 * ciò che impedisce a un asset vecchio di sopravvivere a un deploy.
 */
const CACHE = `calendario-${version}`;

/** La pagina da mostrare quando la rete non c'è. È prerenderizzata: non ha dati dentro. */
const OFFLINE = '/offline';

/**
 * Ciò che vale la pena precaricare: i file della build (immutabili, con
 * l'hash nel nome), gli asset di `static/` e la sola pagina offline fra le
 * prerenderizzate.
 */
const DA_PRECARICARE = [...build, ...files, ...prerendered.filter((p) => p === OFFLINE)];

const PRECARICATI = new Set(DA_PRECARICARE);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(DA_PRECARICARE))
			// `skipWaiting` senza esitazioni: le due versioni non condividono
			// niente — la cache è nuova e i file della build hanno l'hash nel
			// nome — quindi non c'è nessuno stato misto da temere.
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((chiavi) => Promise.all(chiavi.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

/** Vero per gli asset immutabili, gli unici che si possono servire dalla cache. */
function eStatico(url: URL): boolean {
	return url.origin === sw.location.origin && PRECARICATI.has(url.pathname);
}

sw.addEventListener('fetch', (event) => {
	const richiesta = event.request;

	// Solo le GET. Una form action è una POST e non si mette in cache per
	// definizione: rispondere da una copia salvata a un salvataggio sarebbe
	// dire all'utente che è andato a buon fine quando non è successo niente.
	if (richiesta.method !== 'GET') return;

	const url = new URL(richiesta.url);
	// `chrome-extension:` e simili: non sono affari nostri.
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

	if (eStatico(url)) {
		event.respondWith(caches.match(richiesta).then((salvato) => salvato ?? fetch(richiesta)));
		return;
	}

	/**
	 * Le navigazioni: **sempre dalla rete**, con la pagina offline come unica
	 * alternativa. Nessun `catch` che restituisce una versione salvata della
	 * pagina richiesta, perché quella versione conterrebbe dati.
	 */
	if (richiesta.mode === 'navigate') {
		event.respondWith(
			fetch(richiesta).catch(async () => {
				const offline = await caches.match(OFFLINE);
				return (
					offline ??
					new Response('Sei senza rete.', {
						status: 503,
						headers: { 'content-type': 'text/plain; charset=utf-8' }
					})
				);
			})
		);
		return;
	}

	// Tutto il resto — `/api/*`, le `load` in JSON di SvelteKit, le immagini
	// caricate dagli utenti — passa dalla rete e basta. Non c'è nessun ramo
	// che le salvi, ed è la parte più importante del file.
});
