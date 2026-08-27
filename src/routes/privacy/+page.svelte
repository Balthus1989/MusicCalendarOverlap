<script lang="ts">
	/**
	 * L'informativa privacy (art. 13 GDPR).
	 *
	 * Sta **fuori** dal gruppo `(app)`, quindi la guardia di `hooks.server.ts`
	 * non la protegge: dev'essere leggibile prima di accedere, ed è il motivo
	 * per cui il login ci rimanda.
	 *
	 * Il testo descrive il trattamento **vero**, non uno plausibile: ogni
	 * fornitore nominato qui corrisponde a una chiamata che esiste nel codice, e
	 * ogni scadenza a una costante — `GIORNI_CONSERVAZIONE` in
	 * `parse/retention.ts`, `GIORNI_CONSERVAZIONE_NOTIFICHE` in
	 * `notifications/service.ts`. **Se cambiano quelle, cambia questa pagina**:
	 * un'informativa che descrive una conservazione diversa da quella applicata
	 * è peggio di nessuna informativa.
	 */
	import { resolve } from '$app/paths';

	const aggiornamento = '27 agosto 2026';

	const fornitori = [
		{
			chi: 'Supabase',
			cosa: 'Database, autenticazione e archiviazione dei file (locandine, foto)',
			dove: 'Unione Europea'
		},
		{
			chi: 'Cloudflare',
			cosa: "Esecuzione dell'applicazione e consegna delle pagine",
			dove: 'Rete globale, extra UE'
		},
		{
			chi: 'Telegram',
			cosa: 'Consegna degli avvisi, solo a chi ha collegato la propria chat',
			dove: 'Extra UE'
		},
		{
			chi: 'GitHub',
			cosa: 'Esecuzione dei lavori periodici e copie di sicurezza cifrate',
			dove: 'Extra UE'
		},
		{
			chi: 'Photon (Komoot) e Nominatim (OpenStreetMap)',
			cosa: 'Conversione degli indirizzi dei locali in coordinate',
			dove: 'Unione Europea'
		},
		{
			chi: 'MusicBrainz',
			cosa: "Ricerca degli artisti durante l'inserimento in anagrafica",
			dove: 'Extra UE'
		}
	];

	const conservazione = [
		{
			cosa: 'Testo incollato nell’import assistito',
			quanto: '90 giorni, poi cancellato in automatico'
		},
		{ cosa: 'Avvisi ricevuti', quanto: '180 giorni, poi cancellati in automatico' },
		{ cosa: 'Contatori dei limiti d’uso', quanto: 'circa un’ora, poi cancellati in automatico' },
		{ cosa: 'Profilo, date, schede di artisti e locali', quanto: 'finché il profilo esiste' },
		{
			cosa: 'Registro delle modifiche',
			quanto: 'finché esiste l’organizzazione a cui si riferisce'
		},
		{ cosa: 'Copie di sicurezza cifrate', quanto: 'rotazione settimanale' }
	];
</script>

<svelte:head>
	<title>Informativa privacy · Calendario Eventi Condiviso</title>
	<meta
		name="description"
		content="Come il Calendario Eventi Condiviso tratta i dati personali: quali dati, perché, per quanto tempo, chi altro li vede e quali diritti hai."
	/>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
	<header class="mb-10">
		<p class="text-muted-foreground mb-2 text-sm">Calendario Eventi Condiviso</p>
		<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Informativa privacy</h1>
		<p class="text-muted-foreground mt-3 text-sm">
			Ultimo aggiornamento: {aggiornamento}. Questa informativa è resa ai sensi dell'articolo 13 del
			Regolamento (UE) 2016/679.
		</p>
	</header>

	<div class="space-y-10 text-sm leading-relaxed">
		<section>
			<h2 class="mb-3 text-base font-semibold">In breve</h2>
			<ul class="text-muted-foreground list-disc space-y-1.5 pl-5">
				<li>Si entra solo su invito, con un link via email. Non ci sono password.</li>
				<li>
					<strong class="text-foreground">Non registriamo il tuo indirizzo IP</strong> e non usiamo nessuno
					strumento di statistica o di profilazione.
				</li>
				<li>I cookie sono solo quelli che tengono aperta la sessione.</li>
				<li>
					Le date che inserisci sono viste dagli altri organizzatori secondo lo stato che scegli tu:
					una data <em>opzionata</em> mostra molto meno di una <em>confermata</em>.
				</li>
				<li>Puoi portarti via tutto in JSON, CSV o ICS quando vuoi.</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">1. Chi tratta i dati</h2>
			<p>
				Il titolare del trattamento è <strong>Alessandro Rizzuto</strong>, che gestisce il servizio
				a titolo personale e non commerciale.
			</p>
			<p class="mt-3">
				Per qualunque richiesta relativa ai tuoi dati, compreso l'esercizio dei diritti descritti al
				punto 7:
				<a href="mailto:alessandro.rizzuto89@gmail.com" class="underline underline-offset-4">
					alessandro.rizzuto89@gmail.com
				</a>
			</p>
			<p class="text-muted-foreground mt-3">
				Non è stato nominato un responsabile della protezione dei dati: il servizio non rientra nei
				casi in cui l'articolo 37 lo richiede.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">2. Quali dati trattiamo</h2>

			<h3 class="mt-5 mb-2 font-medium">Quelli che ci dai tu</h3>
			<ul class="list-disc space-y-1.5 pl-5">
				<li>
					<strong>Indirizzo email.</strong> È obbligatorio: è la chiave con cui entri, perché l'accesso
					avviene con un link inviato lì.
				</li>
				<li><strong>Nome da mostrare</strong>, che compare agli altri membri del calendario.</li>
				<li>
					<strong>Numero di telefono</strong>, facoltativo, per farsi trovare in fretta da un altro
					organizzatore.
				</li>
				<li>
					<strong>Identificativo della chat Telegram</strong>, solo se scegli di collegarla per
					ricevere gli avvisi. È facoltativo e si può scollegare.
				</li>
			</ul>

			<h3 class="mt-5 mb-2 font-medium">Quelli che nascono dall'uso</h3>
			<ul class="list-disc space-y-1.5 pl-5">
				<li>Le date che inserisci, con luoghi, orari, lineup e le eventuali note interne.</li>
				<li>Le schede di artisti e locali che crei o modifichi.</li>
				<li>
					Il <strong>registro delle modifiche</strong>: chi ha cambiato cosa e quando, con i valori
					precedenti dei campi.
				</li>
				<li>Gli avvisi che ricevi e le tue preferenze su quali riceverne.</li>
				<li>
					I token dei feed di calendario che generi, con la data dell'ultimo accesso, e i contatori
					che limitano l'uso di alcune funzioni. <strong
						>Questi contatori usano l'identificativo del tuo profilo o del token, non il tuo
						indirizzo IP.</strong
					>
				</li>
			</ul>

			<h3 class="mt-5 mb-2 font-medium">
				Quelli di altre persone, che riceviamo senza averli chiesti
			</h3>
			<p>
				È la categoria a cui va prestata più attenzione, e la nominiamo esplicitamente perché
				riguarda persone che non usano il servizio e non sanno che ne teniamo copia.
			</p>
			<ul class="mt-3 list-disc space-y-1.5 pl-5">
				<li>
					<strong>Il testo che incolli nell'import assistito.</strong> Un annuncio di concerto contiene
					con regolarità il numero di chi prende le prenotazioni, il nome di chi ospita il gruppo o il
					contatto di un'agenzia. Quel testo viene conservato in forma grezza per novanta giorni, poi
					cancellato in automatico.
				</li>
				<li>
					<strong>I contatti nelle schede</strong> di artisti e locali: email e agenzia di booking, telefono
					e email del locale.
				</li>
			</ul>
			<p class="mt-3">
				Se sei una di queste persone e vuoi che i tuoi dati vengano rimossi, scrivi all'indirizzo
				del punto 1: la richiesta vale esattamente quanto quella di un iscritto.
			</p>

			<h3 class="mt-5 mb-2 font-medium">Quello che non trattiamo</h3>
			<p class="text-muted-foreground">
				Nessuna password, perché l'accesso è senza password. Nessun indirizzo IP letto o conservato
				dall'applicazione. Nessuno strumento di statistica, pubblicità o profilazione. Nessuna delle
				categorie particolari dell'articolo 9 (salute, opinioni, convinzioni, orientamento).
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">3. Perché li trattiamo</h2>
			<ul class="list-disc space-y-2 pl-5">
				<li>
					<strong>Per farti usare il calendario</strong> — creare il profilo, farti entrare, mostrarti
					le date e rilevare le sovrapposizioni. Base giuridica: l'esecuzione del servizio che hai chiesto
					di usare (art. 6.1.b).
				</li>
				<li>
					<strong>Per mandarti gli avvisi su Telegram</strong>, se hai collegato la chat. Base
					giuridica: il tuo consenso (art. 6.1.a), che collegando la chat dai e scollegandola
					revochi in qualunque momento.
				</li>
				<li>
					<strong>Per tenere il registro delle modifiche</strong>, che in un calendario condiviso
					serve a ricostruire chi ha cambiato una data e quando. Base giuridica: legittimo interesse
					(art. 6.1.f) di tutti i membri dell'organizzazione.
				</li>
				<li>
					<strong>Per la sicurezza del servizio</strong> — limitare l'uso di alcune funzioni ed evitare
					abusi. Base giuridica: legittimo interesse (art. 6.1.f).
				</li>
				<li>
					<strong>Per far funzionare l'import assistito</strong>, che è ciò che comporta la
					conservazione temporanea del testo incollato. Base giuridica: legittimo interesse (art.
					6.1.f), bilanciato con la scadenza breve e con il fatto che il testo non viene usato per
					nessun altro scopo.
				</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">4. Chi altro vede i tuoi dati</h2>

			<h3 class="mt-5 mb-2 font-medium">Gli altri organizzatori iscritti</h3>
			<p>
				È il senso stesso del servizio, ma quanto vedono dipende dallo stato che scegli tu per ogni
				data:
			</p>
			<ul class="mt-3 list-disc space-y-1.5 pl-5">
				<li>
					una data in <strong>bozza</strong> non la vede nessuno fuori dalla tua organizzazione;
				</li>
				<li>
					una data <strong>opzionata</strong> si mostra alle altre organizzazioni solo come giorno, città,
					genere principale e nome della tua organizzazione — non il titolo, non l'orario, non il locale,
					non la lineup;
				</li>
				<li>
					una data <strong>confermata</strong> o <strong>annullata</strong> è visibile per intero, a eccezione
					delle note interne e delle band che non hai ancora annunciato;
				</li>
				<li>
					le <strong>note interne</strong> e il <strong>registro delle modifiche</strong> restano sempre
					e solo alla tua organizzazione.
				</li>
			</ul>
			<p class="text-muted-foreground mt-3">
				Il nome e il contatto della tua organizzazione sono visibili agli altri iscritti anche per
				le date opzionate: è ciò che permette di telefonarsi quando due serate si sovrappongono.
			</p>

			<h3 class="mt-5 mb-2 font-medium">I fornitori di cui ci serviamo</h3>
			<div class="border-border mt-3 overflow-x-auto rounded-lg border">
				<table class="w-full text-left">
					<thead class="bg-muted/50 text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">Chi</th>
							<th class="px-3 py-2 font-medium">Per cosa</th>
							<th class="px-3 py-2 font-medium">Dove</th>
						</tr>
					</thead>
					<tbody>
						{#each fornitori as f (f.chi)}
							<tr class="border-border border-t align-top">
								<td class="px-3 py-2 font-medium">{f.chi}</td>
								<td class="px-3 py-2">{f.cosa}</td>
								<td class="text-muted-foreground px-3 py-2">{f.dove}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-muted-foreground mt-3">
				Il database e i file stanno in Unione Europea. Alcuni fornitori operano fuori dall'Unione:
				in quei casi il trasferimento avviene sulla base delle clausole contrattuali standard
				adottate dalla Commissione europea.
			</p>
			<p class="mt-3">
				Il servizio prevede anche il riconoscimento automatico di un annuncio incollato come testo
				libero, che comporterebbe l'invio di quel testo a un fornitore di modelli linguistici.
				<strong>Questa funzione oggi non è attiva</strong>: se lo diventerà, il fornitore verrà
				aggiunto alla tabella qui sopra prima di attivarla.
			</p>
			<p class="text-muted-foreground mt-3">
				I dati non vengono venduti, ceduti a fini commerciali né usati per pubblicità.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">5. Per quanto tempo li teniamo</h2>
			<div class="border-border mt-3 overflow-x-auto rounded-lg border">
				<table class="w-full text-left">
					<thead class="bg-muted/50 text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">Dato</th>
							<th class="px-3 py-2 font-medium">Conservazione</th>
						</tr>
					</thead>
					<tbody>
						{#each conservazione as c (c.cosa)}
							<tr class="border-border border-t align-top">
								<td class="px-3 py-2">{c.cosa}</td>
								<td class="text-muted-foreground px-3 py-2">{c.quanto}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">6. Cookie e archiviazione nel browser</h2>
			<p>
				Usiamo solo i cookie tecnici che tengono aperta la sessione dopo l'accesso. Non ci sono
				cookie di profilazione, di statistica o di terze parti, e per questo non trovi nessun banner
				da accettare: per i cookie strettamente necessari il consenso non serve.
			</p>
			<p class="mt-3">
				L'applicazione è installabile sul telefono e funziona in parte senza rete. La copia locale
				che rende possibile questo <strong>contiene solo file uguali per tutti</strong> — il codice dell'applicazione,
				le icone, la pagina che compare quando la rete manca. Nessuna data e nessun dato personale viene
				conservato nella cache del browser.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">7. I tuoi diritti</h2>
			<p>Puoi in qualunque momento chiedere di:</p>
			<ul class="mt-3 list-disc space-y-1.5 pl-5">
				<li><strong>accedere</strong> ai dati che ti riguardano (art. 15);</li>
				<li><strong>correggerli</strong>, se sono sbagliati o incompleti (art. 16);</li>
				<li><strong>cancellarli</strong>, nei limiti spiegati qui sotto (art. 17);</li>
				<li><strong>limitarne</strong> il trattamento (art. 18);</li>
				<li>
					<strong>riceverli in un formato leggibile da una macchina</strong> (art. 20): non serve nemmeno
					chiederlo, l'export in JSON, CSV e ICS è già nell'applicazione, sotto «Feed ed export»;
				</li>
				<li>
					<strong>opporti</strong> ai trattamenti fondati sul legittimo interesse (art. 21), e
					<strong>revocare il consenso</strong> agli avvisi scollegando la chat Telegram.
				</li>
			</ul>
			<p class="mt-4">
				Le richieste vanno all'indirizzo del punto 1 e ricevono risposta entro un mese. Se ritieni
				che il trattamento violi il Regolamento puoi rivolgerti al
				<a
					href="https://www.garanteprivacy.it"
					rel="noreferrer noopener"
					target="_blank"
					class="underline underline-offset-4">Garante per la protezione dei dati personali</a
				>.
			</p>

			<h3 class="mt-5 mb-2 font-medium">Che cosa succede davvero se chiedi la cancellazione</h3>
			<p>
				Vale la pena dirlo per esteso, invece di lasciarlo scoprire dopo. Non c'è un pulsante: la
				cancellazione si chiede scrivendo, e comporta due esiti diversi.
			</p>
			<ul class="mt-3 list-disc space-y-1.5 pl-5">
				<li>
					<strong>Vengono cancellati</strong> il tuo profilo, le tue preferenze, il collegamento con Telegram,
					i tuoi feed di calendario e gli avvisi che ti riguardano.
				</li>
				<li>
					<strong>Restano</strong> le date, le schede di artisti e locali e le voci del registro delle
					modifiche. Le date appartengono all'organizzazione, non a chi le ha digitate, e le sovrapposizioni
					già segnalate riguardano anche le organizzazioni dall'altra parte: farle sparire cancellerebbe
					informazioni di terzi. È un limite previsto dall'articolo 17, paragrafo 3, del Regolamento.
					Su richiesta il tuo nome può essere rimosso da quelle voci.
				</li>
			</ul>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">8. Minori</h2>
			<p>
				Il servizio è riservato a organizzatori di eventi che ricevono un invito e non è destinato a
				minori di sedici anni.
			</p>
		</section>

		<section>
			<h2 class="mb-3 text-base font-semibold">9. Modifiche a questa informativa</h2>
			<p>
				Se il trattamento cambia, questa pagina cambia con esso e la data in cima viene aggiornata.
				Il codice del servizio è versionato: ogni versione precedente di questo testo resta
				consultabile nella storia del repository.
			</p>
		</section>
	</div>

	<footer class="border-border mt-12 border-t pt-6 text-sm">
		<a href={resolve('/login')} class="underline underline-offset-4">Torna all'accesso</a>
	</footer>
</div>
