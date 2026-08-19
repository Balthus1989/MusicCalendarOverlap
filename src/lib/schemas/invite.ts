import { z } from 'zod';
import { emailOpzionale } from './common';

/** Ruoli assegnabili tramite invito. */
export const INVITE_ROLES = ['owner', 'admin', 'moderator', 'member'] as const;

export const ROLE_LABEL: Record<(typeof INVITE_ROLES)[number], string> = {
	owner: 'Titolare',
	admin: 'Amministratore',
	moderator: 'Moderatore anagrafiche',
	member: 'Membro'
};

export const ROLE_DESCRIPTION: Record<(typeof INVITE_ROLES)[number], string> = {
	owner: 'Governa l’organizzazione e assegna i ruoli agli altri membri.',
	admin: 'Modifica l’organizzazione e invita nuovi membri.',
	moderator:
		'Corregge, verifica e unisce le schede di artisti e locali di tutto il calendario. Non dà poteri in più sull’organizzazione.',
	member: 'Inserisce e gestisce le date della propria organizzazione.'
};

export const inviteSchema = z.object({
	/** Se `null`, l'invitato crea una nuova organizzazione. */
	organizationId: z
		.string()
		.trim()
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.default(null)
		.refine((v) => v === null || z.uuid().safeParse(v).success, 'Organizzazione non valida.'),
	role: z.enum(INVITE_ROLES).default('member'),
	emailHint: emailOpzionale,
	maxUses: z.coerce
		.number()
		.int()
		.min(1, 'Almeno un utilizzo.')
		.max(50, 'Oltre i 50 utilizzi non è più un invito, è una porta aperta.')
		.default(1),
	/** Giorni di validità. Un invito che non scade è una chiave persa. */
	expiresInDays: z.coerce
		.number()
		.int()
		.min(1, 'Almeno un giorno.')
		.max(365, 'Al massimo un anno.')
		.default(30)
});

export type InviteInput = z.infer<typeof inviteSchema>;

/** Accettazione: chi entra deve dire come si chiama. */
export const acceptInviteSchema = z.object({
	displayName: z.string().trim().min(2, 'Serve un nome con cui farti riconoscere.').max(120)
});
