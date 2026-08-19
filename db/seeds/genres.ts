/**
 * Tassonomia generi — seed versionato (ADR-0007, ARCHITECTURE.md §4.2).
 *
 * Chiusa: solo i platform admin possono estenderla. Va tenuta qui e non
 * inserita a mano, perché il `path` che ne deriva entra nel calcolo di
 * affinità del motore conflitti: una modifica fatta in produzione con una
 * `INSERT` sfuggirebbe ai test.
 *
 * L'albero è volutamente poco profondo. Ogni livello in più diluisce
 * l'affinità fra due sottogeneri fratelli, e l'affinità è ciò che decide se
 * due serate si fanno concorrenza davvero.
 */

export type SeedGenre = {
	slug: string;
	name: string;
	parentSlug: string | null;
	sortOrder: number;
};

/** Helper: dichiara una radice e i suoi figli diretti in una riga sola. */
function ramo(
	slug: string,
	name: string,
	sortOrder: number,
	figli: Array<[string, string]> = []
): SeedGenre[] {
	return [
		{ slug, name, parentSlug: null, sortOrder },
		...figli.map(([s, n], i) => ({
			slug: s,
			name: n,
			parentSlug: slug,
			sortOrder: i
		}))
	];
}

export const GENRES: SeedGenre[] = [
	...ramo('metal', 'Metal', 0, [
		['death-metal', 'Death Metal'],
		['black-metal', 'Black Metal'],
		['doom', 'Doom'],
		['sludge', 'Sludge'],
		['thrash', 'Thrash'],
		['grindcore', 'Grindcore'],
		['metalcore', 'Metalcore'],
		['post-metal', 'Post-Metal'],
		['stoner', 'Stoner'],
		['djent', 'Djent']
	]),
	// Tech Death sta sotto Death Metal, non sotto Metal: è il caso numerico
	// di ARCHITECTURE.md §6.3 (Tech Death vs Death Metal → 0.8).
	{ slug: 'tech-death', name: 'Tech Death', parentSlug: 'death-metal', sortOrder: 0 },

	...ramo('punk-hardcore', 'Punk / Hardcore', 1, [
		['punk', 'Punk'],
		['hardcore', 'Hardcore'],
		['crust', 'Crust'],
		['post-hardcore', 'Post-Hardcore'],
		['emo', 'Emo'],
		['oi', 'Oi!'],
		['screamo', 'Screamo']
	]),

	...ramo('rock', 'Rock', 2, [
		['prog', 'Prog'],
		['psych', 'Psych'],
		['garage', 'Garage'],
		['alternative', 'Alternative'],
		['indie', 'Indie'],
		['post-rock', 'Post-Rock'],
		['shoegaze', 'Shoegaze'],
		['math-rock', 'Math Rock']
	]),

	...ramo('elettronica', 'Elettronica', 3, [
		['techno', 'Techno'],
		['house', 'House'],
		['ambient', 'Ambient'],
		['industrial', 'Industrial'],
		['drum-n-bass', "Drum'n'Bass"],
		['idm', 'IDM'],
		['ebm', 'EBM']
	]),

	...ramo('jazz', 'Jazz', 4, [
		['free-jazz', 'Free Jazz'],
		['jazz-fusion', 'Fusion'],
		['nu-jazz', 'Nu Jazz']
	]),

	...ramo('cantautorale', 'Cantautorale', 5, [
		['cantautorale-italiano', 'Cantautorato italiano'],
		['songwriting', 'Songwriting']
	]),

	...ramo('hip-hop', 'Hip-Hop', 6, [
		['rap', 'Rap'],
		['trap', 'Trap'],
		['boom-bap', 'Boom Bap'],
		['hip-hop-strumentale', 'Strumentale']
	]),

	...ramo('reggae-dub', 'Reggae / Dub', 7, [
		['reggae', 'Reggae'],
		['dub', 'Dub'],
		['ska', 'Ska'],
		['dancehall', 'Dancehall']
	]),

	...ramo('folk-world', 'Folk / World', 8, [
		['folk', 'Folk'],
		['popolare-italiano', 'Musica popolare italiana'],
		['world', 'World'],
		['balkan', 'Balkan']
	]),

	...ramo('sperimentale-noise', 'Sperimentale / Noise', 9, [
		['noise', 'Noise'],
		['drone', 'Drone'],
		['improvvisazione', 'Improvvisazione'],
		['elettroacustica', 'Elettroacustica']
	]),

	...ramo('classica', 'Classica', 10, [
		['classica-contemporanea', 'Contemporanea'],
		['da-camera', 'Da camera'],
		['opera', 'Opera']
	])
];
