/**
 * Distanze geografiche (ADR-0008, ARCHITECTURE.md §6.1).
 *
 * Niente PostGIS: con qualche migliaio di eventi la differenza non si misura,
 * e una dipendenza in meno nel percorso critico vale più di un indice GiST.
 * Il prefiltro a bounding box si fa in SQL, l'haversine esatto qui.
 *
 * Il modulo appartiene al motore conflitti di Fase 3, ma nasce in Fase 2
 * perché il filtro "entro N km" del calendario ha bisogno esattamente di
 * questo, e scriverlo due volte sarebbe il modo migliore per farlo divergere.
 * Codice puro, senza I/O, testato: come tutto ciò che sta sotto
 * `server/conflicts/`.
 */

export type Punto = { lat: number; lon: number };

/** Raggio medio terrestre in chilometri, quello usato dalla formula standard. */
const RAGGIO_TERRESTRE_KM = 6371.0088;

const inRadianti = (gradi: number) => (gradi * Math.PI) / 180;

/**
 * Distanza in chilometri sulla superficie terrestre.
 *
 * Approssima la Terra a una sfera: sulle distanze che interessano qui (decine
 * o poche centinaia di km) l'errore rispetto all'ellissoide è dell'ordine
 * dello 0,3%, cioè molto meno dell'incertezza di un raggio di conflitto scelto
 * a occhio.
 */
export function distanzaKm(a: Punto, b: Punto): number {
	const dLat = inRadianti(b.lat - a.lat);
	const dLon = inRadianti(b.lon - a.lon);
	const lat1 = inRadianti(a.lat);
	const lat2 = inRadianti(b.lat);

	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * RAGGIO_TERRESTRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type BoundingBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

/**
 * Rettangolo che contiene di sicuro il cerchio di raggio dato.
 *
 * Serve a far filtrare al database la stragrande maggioranza delle righe con
 * un indice B-tree su `(lat, lon)`, prima di calcolare l'haversine in codice.
 * È volutamente largo: un falso positivo costa una sottrazione, un falso
 * negativo costa un conflitto non rilevato.
 */
export function boundingBox(centro: Punto, raggioKm: number): BoundingBox {
	const dLat = raggioKm / 111.0;
	// Ai poli i meridiani si stringono: senza il coseno, un raggio di 60 km a
	// Bolzano coprirebbe in longitudine meno del dovuto.
	const coseno = Math.cos(inRadianti(centro.lat));
	const dLon = Math.abs(coseno) < 1e-6 ? 180 : raggioKm / (111.0 * Math.abs(coseno));

	return {
		latMin: centro.lat - dLat,
		latMax: centro.lat + dLat,
		lonMin: Math.max(-180, centro.lon - dLon),
		lonMax: Math.min(180, centro.lon + dLon)
	};
}

/** Vero se il punto sta entro il raggio dal centro. */
export function entroRaggio(centro: Punto, punto: Punto, raggioKm: number): boolean {
	return distanzaKm(centro, punto) <= raggioKm;
}

/** Coordinate valide e presenti: senza, un evento non entra nei calcoli geografici. */
export function haCoordinate(v: {
	lat: number | null;
	lon: number | null;
}): v is { lat: number; lon: number } {
	return typeof v.lat === 'number' && typeof v.lon === 'number';
}
