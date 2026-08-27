/**
 * Il rilascio, in un comando solo e nell'ordine giusto.
 *
 *   npm run rilascia            → 0.7.0 → 0.7.1
 *   npm run rilascia -- minor   → 0.7.0 → 0.8.0
 *
 * Perché uno script e non una riga di `package.json`: l'ordine dei passi non è
 * arbitrario e non si legge da una catena di `&&`.
 *
 * - Gli **smoke test** girano qui perché non girano in CI, e non ci girano per
 *   una ragione buona (ADR-0038: servirebbe la chiave di servizio fra i secret
 *   del repository). Finora quella riga viveva solo in un documento — «si
 *   lanciano prima di un rilascio» — cioè dipendeva dalla memoria di chi
 *   rilascia. Adesso è nel percorso.
 * - Il **numero si alza prima della build**, non dopo. `versione.mjs` legge
 *   `package.json` in fase di build: invertendo i due passi si manderebbe
 *   online l'artefatto con il numero precedente, che è peggio di non averlo —
 *   un'etichetta sbagliata la si crede.
 * - Il **push non lo fa questo script.** Il tag e il commit di versione restano
 *   locali finché il deploy non è andato a buon fine: se `wrangler` fallisce si
 *   torna indietro con due comandi, e nessuno ha mai visto un tag che non
 *   corrisponde a niente di online. Il comando da dare è stampato in fondo.
 *
 * Il controllo della cartella è il primo di tutti di proposito: costa
 * millisecondi e risparmia i minuti dei test a chi ha aperto il terminale dal
 * nome localizzato, visto che il deploy fallirebbe comunque in fondo
 * (`controlla-cartella.mjs`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { controllaCartella } from './controlla-cartella.mjs';

const TIPI = ['patch', 'minor', 'major'];

function muori(...righe) {
	console.error(['', ...righe, ''].join('\n'));
	process.exit(1);
}

function git(...argomenti) {
	return execFileSync('git', argomenti, { encoding: 'utf8' }).trim();
}

/**
 * `shell: true` è necessario su Windows, dove `npm` è `npm.cmd` e non un
 * eseguibile che `spawn` sappia lanciare da sé.
 */
function passo(titolo, comando) {
	console.log(`\n── ${titolo}\n`);
	const esito = spawnSync(comando, { stdio: 'inherit', shell: true });
	if (esito.status !== 0) muori(`Il rilascio si ferma qui: "${titolo}" è fallito.`);
}

const tipo = process.argv[2] ?? 'patch';
if (!TIPI.includes(tipo)) {
	muori(`Tipo di rilascio non riconosciuto: "${tipo}".`, `Attesi: ${TIPI.join(', ')}.`);
}

controllaCartella();

const ramo = git('rev-parse', '--abbrev-ref', 'HEAD');
if (ramo !== 'main') {
	muori(
		`Sei sul ramo "${ramo}", e i rilasci partono da main.`,
		'Il tag di un rilascio deve stare sul commit che è andato online.'
	);
}

if (git('status', '--porcelain') !== '') {
	muori(
		'Ci sono modifiche non committate.',
		'',
		'Il numero di versione e il commit devono descrivere la stessa cosa: con',
		"l'albero sporco l'artefatto conterrebbe codice che non sta in nessun commit,",
		'e il tag punterebbe a una versione diversa da quella che gira. Committa (o',
		'metti da parte) e rilancia.'
	);
}

// L'ordine dei quattro controlli va dal più veloce al più lento: chi sbaglia
// una virgola lo scopre in dieci secondi invece che dopo gli E2E.
passo('Lint', 'npm run lint');
passo('Typecheck', 'npm run check');
passo('Test unitari', 'npm test');
passo('Smoke test end-to-end (database vero, ADR-0038)', 'npm run test:e2e');

// `npm version` alza `package.json`, committa e crea il tag annotato `v<x.y.z>`.
// `%s` lo sostituisce npm con il numero nuovo.
passo(`Numero di versione (${tipo})`, `npm version ${tipo} -m "rilascio v%s"`);

passo('Build e deploy', 'npm run deploy');

const versione = git('describe', '--tags', '--abbrev=0');

/**
 * Il tag precedente esiste da questo rilascio in poi, ma al primo no: senza il
 * ramo di riserva il primo rilascio finirebbe con un errore **dopo** essere
 * andato online, che è il momento peggiore per darne uno.
 *
 * `stderr` va zittito qui e non altrove: quando il tag precedente non c'è,
 * `git describe` scrive un `fatal:` prima di uscire con errore, e quella riga
 * comparirebbe fra il deploy riuscito e la riga che lo annuncia — cioè farebbe
 * sembrare rotto un rilascio andato a buon fine. Negli altri comandi lo stderr
 * resta visibile, perché lì un errore è un errore.
 */
let intervallo = versione;
try {
	const precedente = execFileSync('git', ['describe', '--tags', '--abbrev=0', `${versione}^`], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	}).trim();
	intervallo = `${precedente}..${versione}`;
} catch {
	/* primo rilascio: le note sono tutta la storia */
}

console.log(
	[
		'',
		`── ${versione} è online.`,
		'',
		'Restano da mandare su GitHub il commit di versione e il tag:',
		'',
		'  git push --follow-tags',
		'',
		'Le note di questo rilascio, se servono:',
		'',
		`  git log ${intervallo} --oneline`,
		''
	].join('\n')
);
