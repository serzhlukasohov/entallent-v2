import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDbClient, orgCompanyAdminSessions, orgOidcProviders, orgOidcSubjects,
  orgPersonCapabilities, people, tenants, users, type DbClient } from '@entalent/database';
import { CompanyAdminIdentityService } from './company-admin-identity.service';
import { CompanyAdminSessionService } from './company-admin-session.service';
import { CompanyAuthController, SESSION_COOKIE } from './company-auth.controller';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { SurveyCoverageController } from '../admin/survey-coverage.controller';
import { DatabaseService } from '../database/database.service';

const databaseUrl = process.env['DATABASE_URL'];
const localDatabase = databaseUrl && /^postgres(?:ql)?:\/\/(?:[^@]+@)?(?:127\.0\.0\.1|localhost):\d+\//.test(databaseUrl);
const nonAdminSessions = (['team_lead', 'manager', 'hr', 'hrbp', 'leadership'] as const)
  .map((role) => ({ role, personId: randomUUID(), token: randomBytes(32).toString('base64url'),
    subject: `fixture-${role}` }));

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
    for (const actor of nonAdminSessions) {
      await client.db.insert(users).values({ id: actor.personId, tenantId, status: 'inactive' });
      await client.db.insert(people).values({ id: actor.personId, tenantId,
        customerEmployeeId: `ROLE-${actor.role}`, workEmail: `${actor.role}@fixture.test`,
        displayName: actor.role, primaryRole: actor.role,
        pulseParticipant: actor.role === 'team_lead', lifecycleStatus: 'draft' });
      await client.db.insert(orgOidcSubjects).values({ tenantId, personId: actor.personId,
        issuerUrl: 'https://id.fixture.test', subject: actor.subject });
      await client.db.insert(orgCompanyAdminSessions).values({ tenantId, personId: actor.personId,
        tokenHash: createHash('sha256').update(actor.token).digest('hex'),
        bindingFingerprint: createHash('sha256')
          .update(JSON.stringify(['https://id.fixture.test', actor.subject])).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000) });
    }
  });

  afterAll(async () => {
    if (!client) return;
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end();
  });

  it('does not turn a valid Company Admin cookie into an admin API key', async () => {
    Reflect.defineMetadata('design:paramtypes', [CompanyAdminSessionService], CompanyAuthController);
    Reflect.defineMetadata('design:paramtypes', [DatabaseService], SurveyCoverageController);
    Reflect.defineMetadata('design:paramtypes', [ConfigService, Reflector], ApiKeyGuard);
    @Module({
      controllers: [CompanyAuthController, SurveyCoverageController],
      providers: [
        ApiKeyGuard,
        { provide: CompanyAdminSessionService, useValue: sessions },
        { provide: DatabaseService, useValue: { client: client.db } },
        { provide: ConfigService, useValue: { get: (key: string) => key === 'ADMIN_API_KEY' ? 'fixture-admin-key' : 'production' } },
      ],
    })
    class BoundaryModule {}

    const app = await NestFactory.create<NestFastifyApplication>(BoundaryModule, new FastifyAdapter(),
      { logger: false });
    app.setGlobalPrefix('api/v1');
    try {
      await app.init();
      const cookie = `${SESSION_COOKIE}=${token}`;
      const me = await app.inject({ method: 'GET', url: '/api/v1/company-auth/me', headers: { cookie } });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ tenantId, personId });

      const admin = await app.inject({ method: 'GET', url: '/api/v1/admin/survey/coverage/definitions',
        headers: { cookie } });
      expect(admin.statusCode).toBe(401);
      for (const actor of nonAdminSessions) {
        const roleCookie = `${SESSION_COOKIE}=${actor.token}`;
        const roleMe = await app.inject({ method: 'GET', url: '/api/v1/company-auth/me',
          headers: { cookie: roleCookie } });
        expect(roleMe.statusCode, actor.role).toBe(401);
        const roleAdmin = await app.inject({ method: 'GET',
          url: '/api/v1/admin/survey/coverage/definitions', headers: { cookie: roleCookie } });
        expect(roleAdmin.statusCode, actor.role).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  it('enforces private-route and role boundaries through the production AppModule', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', databaseUrl!);
    vi.stubEnv('REDIS_URL', process.env['REDIS_URL'] ?? 'redis://127.0.0.1:56381/15');
    vi.stubEnv('FIELD_ENCRYPTION_KEY', 'ab'.repeat(32));
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-route-test');
    vi.stubEnv('ADMIN_API_KEY', 'fixture-admin-key');
    vi.stubEnv('SLACK_APP_TOKEN', '');
    Reflect.defineMetadata('design:paramtypes', [DatabaseService], CompanyAdminIdentityService);
    Reflect.defineMetadata('design:paramtypes', [DatabaseService, ConfigService, CompanyAdminIdentityService],
      CompanyAdminSessionService);
    Reflect.defineMetadata('design:paramtypes', [CompanyAdminSessionService], CompanyAuthController);
    Reflect.defineMetadata('design:paramtypes', [DatabaseService], SurveyCoverageController);
    Reflect.defineMetadata('design:paramtypes', [ConfigService, Reflector], ApiKeyGuard);
    const { AppModule } = await import('../app.module');
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(),
      { logger: false });
    app.setGlobalPrefix('api/v1');
    try {
      await app.init();
      await expect(app.get(CompanyAdminSessionService).resolve(token)).resolves.toMatchObject({
        tenantId, personId,
      });
      const adminCookie = `${SESSION_COOKIE}=${token}`;
      const adminMe = await app.inject({ method: 'GET', url: '/api/v1/company-auth/me',
        headers: { cookie: adminCookie } });
      expect(adminMe.statusCode).toBe(200);
      for (const actor of nonAdminSessions) {
        const cookie = `${SESSION_COOKIE}=${actor.token}`;
        const me = await app.inject({ method: 'GET', url: '/api/v1/company-auth/me',
          headers: { cookie } });
        expect(me.statusCode, actor.role).toBe(401);
      }
      for (const headers of [
        { cookie: adminCookie },
        ...nonAdminSessions.map((actor) => ({ cookie: `${SESSION_COOKIE}=${actor.token}` })),
      ]) {
        for (const path of [
          '/api/v1/admin/survey/coverage/definitions',
          '/api/v1/admin/audit-logs',
          '/api/v1/admin/llm-runs',
          `/api/v1/admin/profile-hydration/status?tenantId=${tenantId}`,
          '/api/v1/admin/queues/dead-letter',
        ]) {
          const response = await app.inject({ method: 'GET', url: path, headers });
          expect(response.statusCode, path).toBe(401);
        }
      }
      const authorizedAggregate = await app.inject({ method: 'GET',
        url: '/api/v1/admin/survey/coverage/definitions',
        headers: { 'x-api-key': 'fixture-admin-key' } });
      expect(authorizedAggregate.statusCode).toBe(200);
      for (const path of [
        `/api/v1/admin/users/${personId}/insights`,
        `/api/v1/admin/users/${personId}/debug`,
        '/api/v1/admin/manager/team',
        '/api/v1/admin/pulse/overview',
        `/api/v1/users/${personId}/export`,
        `/api/v1/users/${personId}/memory`,
        `/api/v1/users/${personId}/preferences`,
        `/api/v1/dev/conversation/${randomUUID()}/messages`,
      ]) {
        const hidden = await app.inject({ method: 'GET', url: path,
          headers: { cookie: adminCookie, 'x-api-key': 'fixture-admin-key' } });
        expect(hidden.statusCode, path).toBe(404);
      }
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  }, 20_000);

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
