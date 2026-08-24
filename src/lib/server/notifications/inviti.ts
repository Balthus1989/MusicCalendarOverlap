/**
 * L'email di invito (§10, riga 3).
 *
 * È l'unica notifica che **non passa dal layer**, e la ragione è che non ha un
 * profilo dietro: arriva all'indirizzo di qualcuno che nel calendario non
 * esiste ancora. Non c'è una `profile_id` da mettere in `notifications`, non
 * ci sono preferenze da consultare — non si può chiedere a chi non è ancora
 * entrato se vuole ricevere l'invito a entrare — e non c'è niente da redigere,
 * perché il testo non contiene nessuna data di nessuno.
 *
 * Va quindi diritta al sink email, e l'esito torna a chi ha creato l'invito:
 * senza posta configurata il link va copiato a mano, ed è meglio dirlo sul
 * momento che lasciare qualcuno ad aspettare un'email che non arriverà.
 */
import { env as publicEnv } from '$env/dynamic/public';
import { eq } from 'drizzle-orm';
import type { Database } from '$lib/server/db/client';
import { organizations, profiles } from '$lib/server/db/schema';
import { testoInvito } from './messages';
import { sinkEmail } from './sinks';

export type EsitoInvito =
	{ spedito: true; a: string } | { spedito: false; motivo: string; a: string | null };

/** L'indirizzo che l'invitato riceverà. Senza `PUBLIC_APP_URL` non c'è link possibile. */
export function urlInvito(code: string): string | null {
	const base = (publicEnv.PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
	return base ? `${base}/invite/${code}` : null;
}

/**
 * Manda l'invito, se c'è un indirizzo a cui mandarlo.
 *
 * `emailHint` è opzionale per costruzione: un invito può nascere come link da
 * passare a voce, e in quel caso qui non c'è niente da fare. Non è un errore.
 */
export async function spedisciInvito(
	db: Database,
	dati: {
		code: string;
		email: string | null;
		organizationId: string | null;
		invitanteProfileId: string | null;
		scadenza: Date | null;
	}
): Promise<EsitoInvito | null> {
	if (!dati.email) return null;

	const url = urlInvito(dati.code);
	if (!url) {
		return {
			spedito: false,
			a: dati.email,
			motivo: 'PUBLIC_APP_URL non configurata: l’invito non ha un indirizzo a cui puntare.'
		};
	}

	const [organizzazione, invitante] = await Promise.all([
		dati.organizationId
			? db
					.select({ name: organizations.name })
					.from(organizations)
					.where(eq(organizations.id, dati.organizationId))
					.then((r) => r[0]?.name ?? null)
			: Promise.resolve(null),
		dati.invitanteProfileId
			? db
					.select({ name: profiles.displayName })
					.from(profiles)
					.where(eq(profiles.id, dati.invitanteProfileId))
					.then((r) => r[0]?.name ?? null)
			: Promise.resolve(null)
	]);

	const { oggetto, testo } = testoInvito({
		organizzazione,
		invitante,
		url,
		scadenza: dati.scadenza
	});

	const errore = await sinkEmail.inviaDiretta(dati.email, oggetto, testo);
	return errore === null
		? { spedito: true, a: dati.email }
		: { spedito: false, a: dati.email, motivo: errore };
}
