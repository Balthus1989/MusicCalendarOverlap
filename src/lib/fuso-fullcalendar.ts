/**
 * Il fuso applicativo, dentro FullCalendar.
 *
 * `timeZone: 'Europe/Rome'` da solo **non funziona**: il core di FullCalendar
 * sa convertire soltanto `'local'` e `'UTC'`, e per qualunque altro nome
 * pretende un `namedTimeZonedImpl` fornito da un plugin. Senza, non solleva
 * nessun errore — `canComputeOffset` diventa falso e ogni istante viene
 * disegnato con i suoi campi UTC. Il risultato è un calendario che mostra
 * **ogni orario un'ora o due indietro** rispetto a quello inserito nel form,
 * a seconda che sia in vigore l'ora solare o quella legale. È il guasto che
 * sembra un bug di salvataggio e non lo è: nel database l'istante è giusto.
 *
 * L'implementazione ufficiale passa da `@fullcalendar/luxon3`, cioè da Luxon.
 * Qui non serve: `Intl` sa già tutto sulle regole di fuso, e la conversione
 * nei due versi è esattamente ciò che `time.ts` fa già per il resto
 * dell'applicazione. Un file, nessuna dipendenza nuova, e soprattutto **la
 * stessa** aritmetica del fuso ovunque: se il calendario e il motore conflitti
 * divergessero su un cambio d'ora, il calendario mostrerebbe una data nel
 * giorno in cui il conflitto non è stato cercato.
 *
 * Il contratto di FullCalendar sono due metodi e un formato: l'array
 * `[anno, mese0, giorno, ora, minuto, secondo, millisecondo]`, con il mese a
 * base zero, e lo scarto in **minuti**.
 */
import { createPlugin } from '@fullcalendar/core';
import { NamedTimeZoneImpl } from '@fullcalendar/core/internal';
import { scartoDiFuso, scartoDiFusoDiParete } from '$lib/time';

class FusoIntl extends NamedTimeZoneImpl {
	/** Da istante assoluto ai campi dell'orologio da parete. */
	timestampToArray(ms: number): number[] {
		// Sommare lo scarto e poi rileggere i campi UTC conserva secondi e
		// millisecondi, che il formatter di `Intl` arrotonderebbe: nessun fuso
		// ha mai avuto scarti non multipli del minuto.
		const parete = new Date(ms + scartoDiFuso(new Date(ms), this.timeZoneName));
		return [
			parete.getUTCFullYear(),
			parete.getUTCMonth(),
			parete.getUTCDate(),
			parete.getUTCHours(),
			parete.getUTCMinutes(),
			parete.getUTCSeconds(),
			parete.getUTCMilliseconds()
		];
	}

	/** Lo scarto dal fuso, in minuti, per quell'orario di parete. */
	offsetForArray(a: number[]): number {
		const parete = Date.UTC(a[0], a[1] ?? 0, a[2] ?? 1, a[3] ?? 0, a[4] ?? 0, a[5] ?? 0, a[6] ?? 0);
		return scartoDiFusoDiParete(parete, this.timeZoneName) / 60000;
	}
}

export const fusoPlugin = createPlugin({
	name: 'fuso-intl',
	namedTimeZonedImpl: FusoIntl
});
