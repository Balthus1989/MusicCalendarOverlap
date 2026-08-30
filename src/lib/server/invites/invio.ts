/**
 * L'invito che parte per email (ADR-0045).
 *
 * Fino alla Fase 6 l'invito non aveva nessun canale: [ADR-0039] aveva tolto
 * l'email dal prodotto e per l'invito non l'aveva sostituita, sulla premessa
 * che chi lo riceve non ha ancora un profilo e quindi non è raggiungibile.
 * La premessa era falsa mentre veniva scritta: `/invite/[code]` manda già oggi
 * un magic link a chi un account non ce l'ha, e lo manda **dalla casella SMTP
 * configurata su Supabase**. A parlare SMTP con Gmail non è il Worker — che
 * non potrebbe — è Supabase.
 *
 * Qui si fa la stessa cosa un passo prima: quando l'invito viene generato,
 * invece che quando l'invitato scopre da sé la pagina su cui chiederlo.
 *
 * **Il codice dell'invito viaggia nei `user_metadata`, non nell'URL.**
 * L'indirizzo di ritorno va passato nudo, senza query string, altrimenti il
 * template email gli appende il proprio `?` e il `token_hash` finisce dentro
 * il valore del primo parametro: è il guasto di 7aaad91, che era stato
 * riparato in `/login` e non qui. Vedi `destinazioneDopoAccesso()`.
 *
 * **E i metadati vanno riscritti a ogni invito, non solo al primo.** È il
 * secondo invito allo stesso indirizzo a rivelarlo, e sotto c'è il perché.
 */
import { clientAmministrativo } from '$lib/server/auth/supabase';
import type { EsitoInvio } from '$lib/schemas/invite';

/**
 * L'esito, con quel che serve a raccontarlo.
 *
 * L'elenco dei nomi sta in `$lib/schemas/invite`, perché lo legge anche il
 * pannello che gira nel browser. Qui non si riscrive: si deriva, così i due
 * non possono divergere — aggiungere un esito allo schema senza produrlo di qua
 * (o viceversa) non compila.
 */
export type RisultatoInvio =
	{ esito: Exclude<EsitoInvio, 'fallito'> } | { esito: 'fallito'; motivo: string };

/** Supabase dice in più modi la stessa cosa, a seconda della versione. */
export function indirizzoGiaRegistrato(errore: { code?: string; message: string }): boolean {
	return (
		errore.code === 'email_exists' ||
		errore.code === 'user_already_exists' ||
		/already (been )?registered|already exists/i.test(errore.message)
	);
}

/**
 * I metadati da riscrivere perché puntino all'invito giusto, o `null` se già
 * ci puntano.
 *
 * **Questa funzione esiste per un bug che ha bloccato utenti veri**, e la
 * ragione va tenuta scritta accanto al codice.
 *
 * `inviteUserByEmail` accetta un `data`, ma quel `data` finisce nei
 * `user_metadata` **solo quando crea l'utente**. Al secondo invito allo stesso
 * indirizzo l'utente esiste già — inerte, non confermato — e allora Supabase
 * rimanda l'email con un token nuovo e valido, ma **lascia i metadati come
 * stavano**. Il codice là dentro resta quello del primissimo invito, per
 * sempre.
 *
 * Il link nell'email funzionava dunque benissimo: `/auth/callback` convertiva
 * il token in sessione e poi mandava l'invitato sull'invito **precedente**.
 * Se nel frattempo quello era stato revocato — cioè esattamente ciò che si fa
 * generandone uno nuovo — l'invitato leggeva «Questo invito è stato revocato»
 * subito dopo essere entrato, e l'unica strada che restava era passargli
 * l'URL a mano.
 *
 * Revocare un invito e generarne un altro per lo stesso indirizzo è un gesto
 * legittimo e va rifatto quante volte serve: è il motivo per cui i metadati si
 * riallineano a ogni invio, non solo al primo.
 *
 * Si passano i metadati e non l'utente per tenerla pura: la decisione si prova
 * caso per caso, l'unica chiamata a Supabase sta in `invitaPerEmail()`.
 */
export function metadatiDaRiallineare(
	attuali: Record<string, unknown> | null | undefined,
	codice: string
): Record<string, unknown> | null {
	const metadati = attuali ?? {};
	if (metadati.codice_invito === codice) return null;

	// Si fondono invece di sostituire: `user_metadata` non è roba nostra, e
	// quel che ci mette Supabase (o un domani noi) non va perso per strada.
	return { ...metadati, codice_invito: codice };
}

/**
 * Manda l'invito all'indirizzo indicato, se ce n'è uno.
 *
 * **Non solleva mai.** Un invito generato è una riga già scritta e un link già
 * valido: se l'email non parte, chi ha premuto il pulsante deve vedersi
 * comunque il link da copiare, non un errore al posto dell'invito. È la stessa
 * scelta della riconciliazione dei conflitti (ARCHITECTURE.md §6.4).
 */
export async function invitaPerEmail(opzioni: {
	email: string | null;
	codice: string;
	origin: string;
}): Promise<RisultatoInvio> {
	const email = opzioni.email?.trim();
	if (!email) return { esito: 'senza-indirizzo' };

	const admin = clientAmministrativo();
	if (!admin) return { esito: 'non-configurato' };

	try {
		const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
			// Nudo. Vedi l'intestazione del modulo.
			redirectTo: `${opzioni.origin.replace(/\/+$/, '')}/auth/callback`,
			data: { codice_invito: opzioni.codice }
		});

		if (error) {
			if (indirizzoGiaRegistrato(error)) return { esito: 'gia-iscritto' };

			console.error(
				'Invito non spedito:',
				JSON.stringify({ code: error.code, message: error.message })
			);
			return { esito: 'fallito', motivo: error.message };
		}

		// Vedi `metadatiDaRiallineare()`: al secondo invito allo stesso
		// indirizzo il `data` qui sopra non ha avuto nessun effetto.
		const metadati = metadatiDaRiallineare(data.user?.user_metadata, opzioni.codice);
		if (!metadati || !data.user) return { esito: 'inviato' };

		const { error: erroreMetadati } = await admin.auth.admin.updateUserById(data.user.id, {
			user_metadata: metadati
		});

		if (erroreMetadati) {
			// L'email è già partita e il suo link funziona: quel che non
			// funzionerà è dove atterra. Va detto a chi ha premuto il pulsante,
			// perché il rimedio — passare il link a mano — ce l'ha solo lui.
			console.error(
				'Metadati invito non riallineati:',
				JSON.stringify({ code: erroreMetadati.code, message: erroreMetadati.message })
			);
			return { esito: 'inviato-destinazione-vecchia' };
		}

		return { esito: 'inviato' };
	} catch (err) {
		console.error('Invito non spedito:', err);
		return { esito: 'fallito', motivo: err instanceof Error ? err.message : 'errore sconosciuto' };
	}
}
