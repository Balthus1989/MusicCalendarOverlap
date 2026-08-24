/**
 * I testi del registro delle modifiche, condivisi fra server e browser.
 *
 * Sta fuori da `$lib/server` come `$lib/conflicts.ts` e `$lib/notifications.ts`,
 * e per la stessa ragione: la pagina li mostra nel bundle del client. Qui ci
 * vanno solo nomi da mostrare, mai decisioni su chi può leggere il registro —
 * quelle stanno in `server/audit.ts`, che filtra in SQL.
 *
 * Il registro serve a rispondere a una domanda sola, ma ricorrente: «questa
 * data è cambiata, chi e quando?». Se la riga non si legge in italiano, la
 * risposta esiste nel database e non nel prodotto.
 */
import { ETICHETTE_STATO } from '$lib/events';
import type { EventStatus } from '$lib/server/db/schema';

export const ETICHETTE_AZIONE = {
	create: 'creata',
	update: 'modificata',
	status_change: 'cambio di stato',
	delete: 'eliminata'
} as const;

export type AzioneAudit = keyof typeof ETICHETTE_AZIONE;

export function etichettaAzione(azione: string): string {
	return ETICHETTE_AZIONE[azione as AzioneAudit] ?? azione;
}

/**
 * I campi che finiscono in `diff`. Non sono tutti quelli dell'evento: il
 * registro traccia i quattro che qualcuno va a cercare — stato, titolo, data,
 * locale — più la nota con cui si chiude un conflitto.
 */
const ETICHETTE_CAMPO: Record<string, string> = {
	status: 'stato',
	title: 'titolo',
	startsAt: 'data e ora',
	venueId: 'locale',
	resolution_note: 'nota di chiusura'
};

export function etichettaCampo(campo: string): string {
	return ETICHETTE_CAMPO[campo] ?? campo;
}

const formatoIstante = new Intl.DateTimeFormat('it-IT', {
	dateStyle: 'medium',
	timeStyle: 'short',
	timeZone: 'Europe/Rome'
});

function statoLeggibile(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	return ETICHETTE_STATO[v as EventStatus] ?? null;
}

/**
 * Un valore del diff come si mostra.
 *
 * Le date arrivano come stringhe ISO — `calcolaDiff` le serializza per poterle
 * confrontare — e stampate così sarebbero illeggibili proprio nel caso più
 * frequente, cioè una serata spostata.
 */
export function valoreLeggibile(campo: string, v: unknown): string {
	if (v === null || v === undefined || v === '') return '—';
	if (campo === 'status') return statoLeggibile(v) ?? String(v);
	if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
		const d = new Date(v);
		if (!Number.isNaN(d.getTime())) return formatoIstante.format(d);
	}
	if (campo === 'venueId') return 'un altro locale';
	return String(v);
}

export type VoceAudit = {
	id: string;
	entityType: string;
	entityId: string;
	action: string;
	attore: string | null;
	diff: Record<string, [unknown, unknown]> | null;
	createdAt: Date | string;
};

export type CambioLeggibile = { campo: string; prima: string; dopo: string };

export function cambi(voce: VoceAudit): CambioLeggibile[] {
	if (!voce.diff) return [];
	return Object.entries(voce.diff).map(([campo, [prima, dopo]]) => ({
		campo: etichettaCampo(campo),
		prima: valoreLeggibile(campo, prima),
		dopo: valoreLeggibile(campo, dopo)
	}));
}

/**
 * `null` significa che l'attore non c'è più: la foreign key è
 * `on delete set null`, perché il fatto che la modifica sia avvenuta resta
 * vero anche se chi l'ha fatta ha lasciato il calendario.
 */
export function nomeAttore(attore: string | null): string {
	return attore ?? 'profilo rimosso';
}

/* ------------------------------------------------------------------ *
 * La metrica di §1
 * ------------------------------------------------------------------ */

/**
 * Il passaggio di stato di una data, come si legge dal registro.
 *
 * `da` è `null` alla creazione: la data non veniva da nessuno stato.
 */
export type PassaggioStato = { entityId: string; da: string | null; a: string };

export type MetricaHold = {
	/** Date arrivate a `confirmed` passando prima da `hold`. */
	conHold: number;
	/** Date nate o passate direttamente a `confirmed`. */
	senzaHold: number;
	totale: number;
	/** Quota sul totale, `null` quando non c'è ancora niente da misurare. */
	quota: number | null;
};

/**
 * La metrica di successo del prodotto (ARCHITECTURE.md §1).
 *
 * «Gli organizzatori inseriscono le date in stato provvisorio _prima_ di
 * confermarle. Se lo usano solo dopo l'annuncio, il prodotto ha fallito il suo
 * scopo.» Si legge dai dati e non da un sondaggio: è la quota di date che
 * passano da `hold` prima di arrivare a `confirmed`, contro quelle che nascono
 * già confermate.
 *
 * Conta ogni data **una volta sola**, alla prima conferma: una serata
 * annullata e riconfermata non vale doppio. I passaggi vanno passati in
 * ordine cronologico.
 */
export function metricaHold(passaggi: PassaggioStato[]): MetricaHold {
	const visto = new Map<string, { hold: boolean; confermata: boolean }>();

	for (const p of passaggi) {
		const stato = visto.get(p.entityId) ?? { hold: false, confermata: false };
		if (stato.confermata) continue;
		if (p.a === 'hold') stato.hold = true;
		if (p.a === 'confirmed') stato.confermata = true;
		visto.set(p.entityId, stato);
	}

	let conHold = 0;
	let senzaHold = 0;
	for (const stato of visto.values()) {
		if (!stato.confermata) continue;
		if (stato.hold) conHold++;
		else senzaHold++;
	}

	const totale = conHold + senzaHold;
	return { conHold, senzaHold, totale, quota: totale ? conHold / totale : null };
}
