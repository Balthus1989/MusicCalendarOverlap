import { z } from 'zod';
import { emailOpzionale, paese, provinciaOpzionale, testoOpzionale, urlOpzionale } from './common';

export const ORG_KINDS = [
	'club',
	'associazione_culturale',
	'collettivo',
	'promoter',
	'festival',
	'altro'
] as const;

/** Etichette in italiano per la UI; le chiavi sono i valori dell'enum SQL. */
export const ORG_KIND_LABEL: Record<(typeof ORG_KINDS)[number], string> = {
	club: 'Club',
	associazione_culturale: 'Associazione culturale',
	collettivo: 'Collettivo',
	promoter: 'Promoter',
	festival: 'Festival',
	altro: 'Altro'
};

export const organizationSchema = z.object({
	name: z.string().trim().min(2, 'Il nome è obbligatorio.').max(120),
	kind: z.enum(ORG_KINDS).default('altro'),
	city: z.string().trim().min(2, 'La città è obbligatoria: è la base geografica.').max(120),
	province: provinciaOpzionale,
	region: testoOpzionale(120),
	country: paese,
	website: urlOpzionale,
	instagramUrl: urlOpzionale,
	facebookUrl: urlOpzionale,
	emailContact: emailOpzionale,
	/**
	 * Raggio entro cui un'altra data conta come concorrenza. 60 km è
	 * un'ipotesi da tarare sulla geografia reale del gruppo — decisione #1 del
	 * registro, ancora aperta.
	 */
	defaultConflictRadiusKm: z.coerce
		.number()
		.int('Il raggio è un numero intero di chilometri.')
		.min(5, 'Sotto i 5 km il calendario non segnalerebbe quasi nulla.')
		.max(500, 'Oltre i 500 km ogni data confliggerebbe con ogni altra.')
		.default(60),
	notes: testoOpzionale(2000)
});

export type OrganizationInput = z.infer<typeof organizationSchema>;
