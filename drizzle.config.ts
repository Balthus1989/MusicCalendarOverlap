import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DIRECT_DATABASE_URL ?? '';

// `generate` lavora solo sui file: non serve una connessione. Tutti gli altri
// comandi toccano il database e devono usare la connessione diretta (5432),
// mai il pooler.
const needsConnection = !process.argv.includes('generate');
if (needsConnection && !url) {
	throw new Error(
		'DIRECT_DATABASE_URL non configurata. Le migrazioni girano sulla connessione diretta (porta 5432), non sul pooler.'
	);
}

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './src/lib/server/db/migrations',
	dialect: 'postgresql',
	dbCredentials: { url },
	// Lo schema `auth` è di Supabase: lo referenziamo ma non lo migriamo.
	schemaFilter: ['public'],
	verbose: true,
	strict: true
});
