/**
 * Genera le icone della PWA.
 *
 * Sono file binari, e un file binario committato senza il modo di rifarlo è un
 * file che nessuno oserà toccare. Questo script è quel modo: `node
 * scripts/genera-icone.mjs` riscrive `static/icons/`.
 *
 * Niente dipendenze. Un PNG è una firma più tre chunk, e i chunk sono lunghezza
 * più tipo più dati più CRC: scriverlo a mano costa una cinquantina di righe e
 * risparmia una libreria di grafica in `devDependencies` per tre file che
 * cambiano una volta ogni mai.
 *
 * Il disegno: un riquadro da calendario, e dentro una griglia di puntini con
 * **due** accesi nella stessa casella. È la cosa che il prodotto fa — accorgersi
 * che due date si sovrappongono — ed è l'unica ragione per cui non è un'icona
 * di calendario qualunque.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SFONDO = [24, 24, 27]; // zinc-900
const CARTA = [250, 250, 250];
const RILEGATURA = [82, 82, 91]; // zinc-600
const PUNTO = [161, 161, 170]; // zinc-400
const CONFLITTO = [220, 38, 38]; // red-600

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

function crc32(buf) {
	let c;
	const tabella = [];
	for (let n = 0; n < 256; n++) {
		c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		tabella[n] = c >>> 0;
	}
	let crc = 0xffffffff;
	for (const b of buf) crc = tabella[(crc ^ b) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dati) {
	const lunghezza = Buffer.alloc(4);
	lunghezza.writeUInt32BE(dati.length);
	const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(corpo));
	return Buffer.concat([lunghezza, corpo, crc]);
}

/** `pixel` è un array RGB lungo `lato * lato * 3`. */
function png(lato, pixel) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(lato, 0);
	ihdr.writeUInt32BE(lato, 4);
	ihdr[8] = 8; // profondità
	ihdr[9] = 2; // colore truecolor RGB
	// I tre zeri che restano sono compressione, filtro e interlacciamento:
	// deflate, adattivo, nessuno. Sono gli unici valori ammessi dal formato.

	const righe = [];
	for (let y = 0; y < lato; y++) {
		// Filtro 0 per riga: nessuno. Su un disegno a tinte piatte il deflate
		// fa già tutto il lavoro, e i filtri servirebbero solo a complicare.
		righe.push(Buffer.from([0]));
		righe.push(Buffer.from(pixel.slice(y * lato * 3, (y + 1) * lato * 3)));
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(Buffer.concat(righe), { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/* ------------------------------------------------------------------ *
 * Disegno
 * ------------------------------------------------------------------ */

function tela(lato, colore) {
	const pixel = new Uint8Array(lato * lato * 3);
	for (let i = 0; i < lato * lato; i++) {
		pixel[i * 3] = colore[0];
		pixel[i * 3 + 1] = colore[1];
		pixel[i * 3 + 2] = colore[2];
	}
	return pixel;
}

function punto(pixel, lato, x, y, colore) {
	if (x < 0 || y < 0 || x >= lato || y >= lato) return;
	const i = (Math.floor(y) * lato + Math.floor(x)) * 3;
	pixel[i] = colore[0];
	pixel[i + 1] = colore[1];
	pixel[i + 2] = colore[2];
}

/** Rettangolo con gli angoli arrotondati, senza antialiasing: a queste taglie non si vede. */
function riquadro(pixel, lato, x0, y0, x1, y1, raggio, colore) {
	for (let y = Math.round(y0); y < Math.round(y1); y++) {
		for (let x = Math.round(x0); x < Math.round(x1); x++) {
			const dx = Math.max(x0 + raggio - x, x - (x1 - 1 - raggio), 0);
			const dy = Math.max(y0 + raggio - y, y - (y1 - 1 - raggio), 0);
			if (dx * dx + dy * dy > raggio * raggio) continue;
			punto(pixel, lato, x, y, colore);
		}
	}
}

function cerchio(pixel, lato, cx, cy, r, colore) {
	for (let y = Math.round(cy - r); y <= cy + r; y++) {
		for (let x = Math.round(cx - r); x <= cx + r; x++) {
			const dx = x - cx;
			const dy = y - cy;
			if (dx * dx + dy * dy <= r * r) punto(pixel, lato, x, y, colore);
		}
	}
}

/**
 * `margine` è la quota di lato lasciata vuota attorno al disegno.
 *
 * Per l'icona `maskable` deve essere generosa: chi la ritaglia può prendersi
 * fino al 20% per lato, e un calendario a cui manca un angolo è peggio di
 * un'icona piccola.
 */
function icona(lato, margine) {
	const pixel = tela(lato, SFONDO);

	const bordo = Math.round(lato * margine);
	const x0 = bordo;
	const x1 = lato - bordo;
	const y0 = bordo + Math.round(lato * 0.045);
	const y1 = lato - bordo;
	const larghezza = x1 - x0;
	const altezza = y1 - y0;
	const raggio = Math.round(larghezza * 0.12);

	// Le due anelle della rilegatura, sopra il foglio.
	const rAnello = Math.round(lato * 0.028);
	cerchio(pixel, lato, x0 + larghezza * 0.3, y0, rAnello, RILEGATURA);
	cerchio(pixel, lato, x0 + larghezza * 0.7, y0, rAnello, RILEGATURA);

	riquadro(pixel, lato, x0, y0, x1, y1, raggio, CARTA);

	// La fascia in testa, dove su un calendario da muro c'è il mese.
	//
	// Due passate e non una: un riquadro arrotondato più basso del doppio del
	// suo raggio si strozza in mezzo, e sul bordo della fascia comparivano due
	// cunei di carta bianca. La prima passata arrotonda solo la cima, la
	// seconda tira giù un rettangolo netto fino in fondo.
	riquadro(pixel, lato, x0, y0, x1, y0 + raggio * 2, raggio, RILEGATURA);
	riquadro(pixel, lato, x0, y0 + raggio, x1, y0 + altezza * 0.22, 0, RILEGATURA);

	// La griglia dei giorni: quattro colonne per tre righe.
	const rPunto = Math.max(2, Math.round(lato * 0.032));
	const passoX = larghezza / 4;
	const passoY = (altezza * 0.72) / 3;
	const primoY = y0 + altezza * 0.32;

	for (let riga = 0; riga < 3; riga++) {
		for (let colonna = 0; colonna < 4; colonna++) {
			const cx = x0 + passoX * (colonna + 0.5);
			const cy = primoY + passoY * riga;
			// La casella della sovrapposizione: due segni nello stesso giorno,
			// che è tutto quello che questo prodotto sa fare.
			if (riga === 1 && colonna === 2) {
				cerchio(pixel, lato, cx - rPunto * 0.6, cy, rPunto, CONFLITTO);
				cerchio(pixel, lato, cx + rPunto * 0.6, cy, rPunto, CONFLITTO);
				continue;
			}
			cerchio(pixel, lato, cx, cy, rPunto * 0.75, PUNTO);
		}
	}

	return png(lato, pixel);
}

mkdirSync('static/icons', { recursive: true });
writeFileSync('static/icons/icon-192.png', icona(192, 0.08));
writeFileSync('static/icons/icon-512.png', icona(512, 0.08));
// La variante ritagliabile: stesso disegno, molto più aria intorno.
writeFileSync('static/icons/icon-maskable-512.png', icona(512, 0.2));
console.log('Icone scritte in static/icons/.');
