/**
 * Il breakpoint `md:` di Tailwind, scritto per il JavaScript che deve saperlo.
 *
 * Sotto questa larghezza l'applicazione cambia forma: la navigazione si
 * sdoppia e il calendario diventa un elenco (ADR-0042). Quasi tutto succede
 * per CSS, e per CSS si annulla da sé riallargando. Le due cose che il CSS non
 * fa — la vista di FullCalendar, che è un'opzione JavaScript, e il blocco
 * dello scorrimento del pannello `☰`, che è una proprietà scritta su `body` —
 * vanno annullate a mano, e per farlo devono sapere quando si attraversa il
 * confine.
 *
 * Sta qui e non in ciascun componente perché il valore deve **coincidere** con
 * `md:`: due copie dello stesso 767px sono due copie che si scoprono
 * disallineate il giorno in cui il tema cambia i breakpoint, e si scoprono
 * osservando un pannello che non si chiude, non leggendo un errore.
 */
export const STRETTO = '(max-width: 767px)';
