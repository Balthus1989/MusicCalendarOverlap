/**
 * Il motore: applica le quattro regole a una coppia di date, e una data
 * contro un elenco di candidate (ARCHITECTURE.md §6).
 *
 * Resta codice puro. Chi legge dal database è `reconcile.ts`; chi decide cosa
 * si può raccontare è `serializeConflict`. Qui c'è solo il "che cosa è vero".
 */
import type { ConflictSeverity } from '$lib/server/db/schema';
import { REGOLE, type ConflittoRilevato, type EventoPerConflitti } from './rules';

/**
 * Un conflitto con la coppia di eventi a cui appartiene, già ordinata.
 * È la forma che `reconcile.ts` scrive nella tabella `conflicts`.
 */
export type ConflittoTrovato = ConflittoRilevato & {
	eventAId: string;
	eventBId: string;
};

/**
 * Ordina la coppia come pretende il CHECK su `conflicts`.
 *
 * Il confronto fra stringhe coincide con quello che Postgres fa sugli `uuid`:
 * la rappresentazione canonica è in minuscolo, con i trattini nelle stesse
 * posizioni, quindi l'ordine lessicografico e quello sui byte sono lo stesso.
 */
export function ordinaCoppia<T extends { id: string }>(x: T, y: T): [T, T] {
	return x.id < y.id ? [x, y] : [y, x];
}

const GRAVITA: Record<ConflictSeverity, number> = { low: 0, medium: 1, high: 2 };

/** Ordinamento per gravità decrescente: è come si legge una dashboard. */
export function piuGraveDi(a: ConflictSeverity, b: ConflictSeverity): boolean {
	return GRAVITA[a] > GRAVITA[b];
}

export function ordinaPerGravita<T extends { severity: ConflictSeverity }>(conflitti: T[]): T[] {
	return [...conflitti].sort((x, y) => GRAVITA[y.severity] - GRAVITA[x.severity]);
}

/** Severity da cui scattano le notifiche (ARCHITECTURE.md §6.4, §10). */
export function meritaNotifica(severity: ConflictSeverity): boolean {
	return GRAVITA[severity] >= GRAVITA.medium;
}

/**
 * Tutti i conflitti fra due date.
 *
 * Due date della stessa organizzazione non entrano mai in conflitto: se un
 * circolo mette due concerti la stessa sera lo sa già, e avvisarlo di una
 * cosa che ha deciso sarebbe solo rumore. La selezione SQL dei candidati fa
 * già questo filtro (§6.1); qui si ripete perché il motore va usato anche
 * sull'anteprima, dove i candidati arrivano da un'altra strada.
 *
 * Una coppia può produrre **più di un conflitto**: due date nello stesso
 * locale la stessa sera sono un `venue_clash` e insieme, per forza di cose,
 * una sovrapposizione geografica. Le regole restano indipendenti e ognuna
 * dice la sua; è l'interfaccia a raggrupparle per coppia e a mostrare per
 * prima la più grave, così che la ridondanza non diventi rumore.
 */
export function conflittiFraEventi(
	x: EventoPerConflitti,
	y: EventoPerConflitti
): ConflittoTrovato[] {
	if (x.id === y.id) return [];
	if (x.organizationId === y.organizationId) return [];

	const [a, b] = ordinaCoppia(x, y);

	return REGOLE.map((regola) => regola(a, b))
		.filter((c): c is ConflittoRilevato => c !== null)
		.map((c) => ({ ...c, eventAId: a.id, eventBId: b.id }));
}

/**
 * Conflitti fra una data e tutte le candidate.
 *
 * Il candidato può non essere ancora salvato: è così che funziona
 * l'anteprima nel form (§6.5), che passa un `id` fittizio.
 */
export function rilevaConflitti(
	candidato: EventoPerConflitti,
	esistenti: EventoPerConflitti[]
): ConflittoTrovato[] {
	return esistenti.flatMap((e) => conflittiFraEventi(candidato, e));
}
