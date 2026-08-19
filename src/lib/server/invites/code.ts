/**
 * Codici di invito (ADR-0004).
 *
 * Un codice è l'unica cosa che separa uno sconosciuto dal calendario, quindi
 * va generato con un CSPRNG e non con `Math.random()`. `crypto.getRandomValues`
 * è disponibile sia su Cloudflare Workers sia su Node 24.
 */

/**
 * Alfabeto senza caratteri ambigui: niente 0/O, 1/l/I, niente maiuscole e
 * minuscole della stessa lettera. Un codice si detta al telefono.
 */
const ALFABETO = '23456789abcdefghjkmnpqrstuvwxyz';
export const LUNGHEZZA_CODICE = 10;

export function generateInviteCode(length = LUNGHEZZA_CODICE): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);

	// Rifiuto modulo-bias: scarta i byte che cadono nella coda incompleta.
	const limite = Math.floor(256 / ALFABETO.length) * ALFABETO.length;
	let out = '';
	let i = 0;

	while (out.length < length) {
		if (i >= bytes.length) {
			crypto.getRandomValues(bytes);
			i = 0;
		}
		const b = bytes[i++];
		if (b < limite) out += ALFABETO[b % ALFABETO.length];
	}

	return out;
}

/**
 * Normalizza un codice digitato a mano: spazi, trattini e maiuscole non
 * cambiano l'invito. Non fa validazione, solo pulizia.
 */
export function normalizeInviteCode(raw: string): string {
	return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isWellFormedInviteCode(raw: string): boolean {
	const c = normalizeInviteCode(raw);
	if (c.length !== LUNGHEZZA_CODICE) return false;
	return [...c].every((ch) => ALFABETO.includes(ch));
}

export type InviteState =
	{ usable: true } | { usable: false; reason: 'scaduto' | 'esaurito' | 'revocato' };

/** Un invito è usabile se non è scaduto e ha ancora usi disponibili. */
export function inviteState(
	invite: { expiresAt: Date | null; uses: number; maxUses: number },
	now: Date = new Date()
): InviteState {
	if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) {
		return { usable: false, reason: 'scaduto' };
	}
	if (invite.maxUses <= 0) return { usable: false, reason: 'revocato' };
	if (invite.uses >= invite.maxUses) return { usable: false, reason: 'esaurito' };
	return { usable: true };
}
