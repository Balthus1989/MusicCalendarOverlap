/**
 * Dalla forma serializzata a quella che FullCalendar sa disegnare.
 *
 * Sta lato server di proposito. Il titolo di un evento in `hold` altrui non è
 * una scelta grafica ma il risultato della matrice di visibilità: se questa
 * conversione vivesse nel componente, prima o poi qualcuno vi passerebbe una
 * riga non serializzata e il calendario mostrerebbe titoli che non doveva.
 */
import type { EventoCalendario } from '$lib/events';
import { oraCivile } from '$lib/time';
import { ETICHETTE_STATO } from '$lib/server/events/status';
import { titoloVisibile, type EventoSerializzato } from '$lib/server/visibility';

export type { EventoCalendario };

export function aEventoCalendario(e: EventoSerializzato): EventoCalendario {
	const completo = e.visibilita === 'completa' ? e : null;

	return {
		id: e.id,
		title: titoloVisibile(e),
		start: completo ? completo.startsAt.toISOString() : e.giorno,
		end: completo?.endsAt ? completo.endsAt.toISOString() : undefined,
		allDay: !completo,
		classNames: [
			`evento--${e.status}`,
			e.proprio ? 'evento--proprio' : 'evento--altrui',
			...(e.visibilita === 'ridotta' ? ['evento--ridotto'] : [])
		],
		extendedProps: {
			status: e.status,
			statusEtichetta: ETICHETTE_STATO[e.status],
			proprio: e.proprio,
			ridotto: e.visibilita === 'ridotta',
			citta: e.city,
			provincia: e.province,
			organizzazione: e.organizzazione.name,
			organizzazioneEmail: e.organizzazione.emailContact,
			genere: e.generePrimario?.name ?? null,
			locale: completo?.venue?.name ?? null,
			// Già in orario di parete: il client non deve riconvertire nulla, e
			// un browser impostato su un altro fuso non deve poter mostrare
			// l'orario sbagliato di un concerto italiano.
			ora: completo ? oraCivile(completo.startsAt) : null
		}
	};
}
