import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDbClient, orgCompanyAdminSessions, orgOidcProviders, orgOidcSubjects,
  orgPersonCapabilities, people, tenants, users, type DbClient } from '@entalent/database';
import { CompanyAdminIdentityService } from './company-admin-identity.service';
import { CompanyAdminSessionService } from './company-admin-session.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);

describe.skipIf(!localDatabase)('Company Admin session on migrated local PostgreSQL', () => {
  const tenantId = randomUUID();
  const personId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const legacyToken = randomBytes(32).toString('base64url');
  const bindingFingerprint = createHash('sha256')
    .update(JSON.stringify(['https://id.fixture.test', 'fixture-subject'])).digest('hex');
  let client: DbClient;
  let sessions: CompanyAdminSessionService;

  beforeAll(async () => {
    client = createDbClient(databaseUrl!);
    const db = { client: client.db } as never;
    const identity = new CompanyAdminIdentityService(db);
    sessions = new CompanyAdminSessionService(db, { get: () => 'ab'.repeat(32) } as never, identity);
    await client.db.insert(tenants).values({ id: tenantId, name: 'OIDC session fixture' });
    await client.db.insert(users).values({ id: personId, tenantId, status: 'inactive' });
    await client.db.insert(people).values({ id: personId, tenantId,
      customerEmployeeId: 'ADMIN-1', workEmail: 'admin@fixture.test', displayName: 'Admin',
      primaryRole: 'leadership', pulseParticipant: false, lifecycleStatus: 'draft' });
    await client.db.insert(orgOidcProviders).values({ tenantId,
      issuerUrl: 'https://id.fixture.test', clientId: 'fixture-client',
      encryptedClientSecret: 'fixture', redirectUri: 'https://api.fixture.test/api/v1/company-auth/callback',
      status: 'active' });
    await client.db.insert(orgOidcSubjects).values({ tenantId, personId,
      issuerUrl: 'https://id.fixture.test', subject: 'fixture-subject' });
    await client.db.insert(orgPersonCapabilities).values({ tenantId, personId,
      capability: 'company_admin', lifecycleStatus: 'active' });
    await client.db.insert(orgCompanyAdminSessions).values({ tenantId, personId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      bindingFingerprint,
      expiresAt: new Date(Date.now() + 60_000) });
    await client.db.insert(orgCompanyAdminSessions).values({ tenantId, personId,
      tokenHash: createHash('sha256').update(legacyToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000) });
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('allows a bound draft Admin, rejects revoked capability and subject rotation, and revokes the session', async () => {
    const session = await sessions.resolve(token);
    expect(session).toMatchObject({ tenantId, personId });
    expect(sessions.verifyCsrf(token, session.csrfToken)).toBe(true);
    await expect(sessions.resolve(legacyToken)).rejects.toThrow('access denied');
    await client.db.update(orgPersonCapabilities).set({ lifecycleStatus: 'inactive' })
      .where(eq(orgPersonCapabilities.personId, personId));
    await expect(sessions.resolve(token)).rejects.toThrow('access denied');
    await client.db.update(orgPersonCapabilities).set({ lifecycleStatus: 'active' })
      .where(eq(orgPersonCapabilities.personId, personId));
    await client.db.update(orgOidcSubjects).set({ subject: 'replacement-subject' })
      .where(eq(orgOidcSubjects.personId, personId));
    await expect(sessions.resolve(token)).rejects.toThrow('access denied');
    await client.db.update(orgOidcSubjects).set({ subject: 'fixture-subject' })
      .where(eq(orgOidcSubjects.personId, personId));
    await sessions.revoke(token);
    await expect(sessions.resolve(token)).rejects.toThrow('access denied');
  });
});
