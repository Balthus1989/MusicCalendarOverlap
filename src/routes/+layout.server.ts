import type { LayoutServerLoad } from './$types';

/**
 * La sessione **non** viene serializzata verso il browser.
 *
 * L'oggetto restituito da `getSession()` viene dal cookie e il suo `user` non
 * è verificato: `@supabase/ssr` avvisa ogni volta che qualcuno lo legge, e
 * SvelteKit lo leggerebbe a ogni navigazione solo per enumerarne le proprietà
 * durante la serializzazione. L'avviso è fondato — quel dato non va usato — e
 * la risposta giusta è non farlo uscire di qui.
 *
 * Al client basta sapere *se* c'è una sessione. L'identità verificata sta in
 * `locals.user` (da `getUser()`) e nei dati del layout `(app)`.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	return { autenticato: Boolean(locals.session) };
};
