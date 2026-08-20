import { describe, expect, it } from 'vitest';
import {
	canCreateEvent,
	canCreateOrgInvite,
	canDeleteEvent,
	canEditCatalogEntry,
	canEditEvent,
	canEditOrg,
	canInviteToOrg,
	canManageMembers,
	canMergeCatalogEntries,
	canModerateCatalog,
	canVerifyCatalogEntry,
	hasOrgRole,
	isMemberOf,
	type Viewer
} from '../../src/lib/server/auth/permissions';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
	profileId: 'p-1',
	isPlatformAdmin: false,
	roles: {},
	...over
});

const member = viewer({ roles: { [ORG_A]: 'member' } });
const admin = viewer({ roles: { [ORG_A]: 'admin' } });
const owner = viewer({ roles: { [ORG_A]: 'owner' } });
const moderator = viewer({ roles: { [ORG_A]: 'moderator' } });
const platformAdmin = viewer({ isPlatformAdmin: true });

describe('appartenenza', () => {
	it('vede solo le organizzazioni di cui è membro', () => {
		expect(isMemberOf(member, ORG_A)).toBe(true);
		expect(isMemberOf(member, ORG_B)).toBe(false);
	});
});

describe('gerarchia dentro l’organizzazione', () => {
	it('owner batte admin batte member', () => {
		expect(hasOrgRole(owner, ORG_A, 'admin')).toBe(true);
		expect(hasOrgRole(admin, ORG_A, 'admin')).toBe(true);
		expect(hasOrgRole(member, ORG_A, 'admin')).toBe(false);
		expect(hasOrgRole(admin, ORG_A, 'owner')).toBe(false);
	});

	it('non travasa fra organizzazioni diverse', () => {
		expect(hasOrgRole(owner, ORG_B, 'member')).toBe(false);
	});

	it('il platform admin passa ovunque', () => {
		expect(hasOrgRole(platformAdmin, ORG_B, 'owner')).toBe(true);
	});

	it('il moderatore non guadagna niente dentro l’organizzazione', () => {
		// È il punto di ADR-0016: il suo potere è sulle anagrafiche condivise,
		// non sull'organizzazione a cui appartiene.
		expect(hasOrgRole(moderator, ORG_A, 'admin')).toBe(false);
		expect(canEditOrg(moderator, ORG_A)).toBe(false);
		expect(canInviteToOrg(moderator, ORG_A)).toBe(false);
		expect(canManageMembers(moderator, ORG_A)).toBe(false);
	});
});

describe('moderazione delle anagrafiche condivise', () => {
	it('spetta a moderatori e platform admin', () => {
		expect(canModerateCatalog(moderator)).toBe(true);
		expect(canModerateCatalog(platformAdmin)).toBe(true);
	});

	it('non spetta a owner e admin di un’organizzazione', () => {
		// Artisti e venue non appartengono a nessuna organizzazione: essere
		// titolare della propria non dà diritto di correggere le schede altrui.
		expect(canModerateCatalog(owner)).toBe(false);
		expect(canModerateCatalog(admin)).toBe(false);
		expect(canModerateCatalog(member)).toBe(false);
	});

	it('vale su tutto il calendario, non solo sulla propria organizzazione', () => {
		const modInB = viewer({ roles: { [ORG_B]: 'moderator' } });
		expect(canModerateCatalog(modInB)).toBe(true);
	});

	it('verifica e merge sono riservati alla moderazione', () => {
		expect(canVerifyCatalogEntry(owner)).toBe(false);
		expect(canVerifyCatalogEntry(moderator)).toBe(true);
		expect(canMergeCatalogEntries(owner)).toBe(false);
		expect(canMergeCatalogEntries(moderator)).toBe(true);
	});
});

describe('modifica di una scheda di anagrafica', () => {
	const miaNonVerificata = { createdBy: 'p-1', isVerified: false };
	const altruiNonVerificata = { createdBy: 'p-2', isVerified: false };
	const miaVerificata = { createdBy: 'p-1', isVerified: true };
	const orfana = { createdBy: null, isVerified: false };

	it('chi l’ha inserita può correggerla finché non è verificata', () => {
		expect(canEditCatalogEntry(member, miaNonVerificata)).toBe(true);
	});

	it('non si tocca la scheda inserita da un altro', () => {
		expect(canEditCatalogEntry(member, altruiNonVerificata)).toBe(false);
	});

	it('una volta verificata si tocca solo con la moderazione', () => {
		expect(canEditCatalogEntry(member, miaVerificata)).toBe(false);
		expect(canEditCatalogEntry(moderator, miaVerificata)).toBe(true);
		expect(canEditCatalogEntry(platformAdmin, miaVerificata)).toBe(true);
	});

	it('una scheda orfana non è di nessuno', () => {
		// `created_by` diventa NULL se il profilo viene cancellato: la scheda
		// non deve ereditare un proprietario per caso.
		expect(canEditCatalogEntry(member, orfana)).toBe(false);
		expect(canEditCatalogEntry(moderator, orfana)).toBe(true);
	});
});

describe('inviti', () => {
	it('invitare nella propria organizzazione parte da admin', () => {
		expect(canInviteToOrg(admin, ORG_A)).toBe(true);
		expect(canInviteToOrg(member, ORG_A)).toBe(false);
	});

	it('creare organizzazioni nuove è solo dei platform admin', () => {
		expect(canCreateOrgInvite(platformAdmin)).toBe(true);
		expect(canCreateOrgInvite(owner)).toBe(false);
	});
});

describe('eventi', () => {
	const eventoA = { organizationId: ORG_A };
	const eventoB = { organizationId: ORG_B };

	it('qualunque membro inserisce e modifica le date della sua organizzazione', () => {
		expect(canCreateEvent(member, ORG_A)).toBe(true);
		expect(canEditEvent(member, eventoA)).toBe(true);
	});

	it('nessuno tocca le date di un’altra organizzazione', () => {
		expect(canCreateEvent(owner, ORG_B)).toBe(false);
		expect(canEditEvent(owner, eventoB)).toBe(false);
	});

	it('cancellare davvero una data parte da admin', () => {
		expect(canDeleteEvent(member, eventoA)).toBe(false);
		expect(canDeleteEvent(admin, eventoA)).toBe(true);
		expect(canDeleteEvent(owner, eventoA)).toBe(true);
	});

	it('il platform admin non ha scorciatoie sugli eventi altrui', () => {
		// Coerente con `serializeEvent`, che lo tratta come un estraneo: la
		// promessa di ADR-0005 vale anche verso chi amministra il server.
		expect(canCreateEvent(platformAdmin, ORG_A)).toBe(false);
		expect(canEditEvent(platformAdmin, eventoA)).toBe(false);
		expect(canDeleteEvent(platformAdmin, eventoA)).toBe(false);
	});

	it('il moderatore non guadagna niente sugli eventi: il suo potere è sulle anagrafiche', () => {
		expect(canEditEvent(moderator, eventoA)).toBe(true);
		expect(canEditEvent(moderator, eventoB)).toBe(false);
		expect(canDeleteEvent(moderator, eventoA)).toBe(false);
	});
});
