import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CompanyAdminIdentityService } from './company-admin-identity.service';

const verify = vi.hoisted(() => vi.fn());
vi.mock('./oidc-verifier', () => ({ verifyCorporateIdToken: verify }));

function setup(provider: unknown, actor: unknown) {
  const predicates: unknown[] = [];
  let read = 0;
  const query = {
    innerJoin: () => query,
    where: (predicate: unknown) => { predicates.push(predicate); return query; },
    limit: async () => read++ === 0 ? (provider ? [provider] : []) : (actor ? [actor] : []),
  };
  const update = vi.fn().mockReturnValue({ set: () => ({ where: async () => undefined }) });
  const client = { select: () => ({ from: () => query }), update };
  return { service: new CompanyAdminIdentityService({ client } as never), predicates, update };
}

describe('CompanyAdminIdentityService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const provider = { issuerUrl: 'https://id.example.test', clientId: 'client-1' };
  const bindingFingerprint = createHash('sha256')
    .update(JSON.stringify([provider.issuerUrl, 'stable-subject'])).digest('hex');

  it('resolves only an existing same-tenant subject with an active capability and records login', async () => {
    verify.mockResolvedValue({ issuerUrl: provider.issuerUrl, subject: 'stable-subject' });
    const { service, predicates, update } = setup(provider, { personId: 'person-1' });

    await expect(service.resolveIdToken(tenantId, 'signed-token', 'nonce-1'))
      .resolves.toEqual({ tenantId, personId: 'person-1', bindingFingerprint });
    expect(verify).toHaveBeenCalledWith({
      issuerUrl: provider.issuerUrl, clientId: 'client-1', idToken: 'signed-token', nonce: 'nonce-1',
    });
    const dialect = new PgDialect();
    const providerSql = dialect.sqlToQuery(predicates[0] as SQL);
    const actorSql = dialect.sqlToQuery(predicates[1] as SQL);
    expect(providerSql.sql).toContain('"org_oidc_providers"."tenant_id"');
    expect(providerSql.sql).toContain('"org_oidc_providers"."status"');
    expect(actorSql.sql).toContain('"org_oidc_subjects"."tenant_id"');
    expect(actorSql.sql).toContain('"org_oidc_subjects"."subject"');
    expect(actorSql.sql).toContain('"org_person_capabilities"."lifecycle_status"');
    expect(actorSql.params).toContain(tenantId);
    expect(actorSql.params).toEqual(expect.arrayContaining(['active', 'draft', 'inactive']));
    expect(actorSql.sql).toContain(' or ');
    expect(update).toHaveBeenCalledOnce();
  });

  it('rechecks lifecycle, provider, subject binding and capability for an existing session', async () => {
    const predicates: SQL[] = [];
    const joins: SQL[] = [];
    const query = {
      innerJoin: (_table: unknown, predicate: SQL) => { joins.push(predicate); return query; },
      where: (predicate: SQL) => { predicates.push(predicate); return query; },
      limit: async () => [{ personId: 'person-1', issuerUrl: provider.issuerUrl,
        subject: 'stable-subject' }],
    };
    const service = new CompanyAdminIdentityService({
      client: { select: () => ({ from: () => query }) },
    } as never);
    await expect(service.assertActiveBoundPerson(tenantId, 'person-1', bindingFingerprint))
      .resolves.toEqual({ tenantId, personId: 'person-1' });
    await expect(service.assertActiveBoundPerson(tenantId, 'person-1', '0'.repeat(64)))
      .rejects.toThrow('Company Admin access denied');
    const dialect = new PgDialect();
    const sql = dialect.sqlToQuery(predicates[0]!);
    expect(joins.map((join) => dialect.sqlToQuery(join).sql).join(' '))
      .toContain('"org_oidc_subjects"."issuer_url"');
    expect(sql.sql).toContain('"org_oidc_providers"."status"');
    expect(sql.sql).toContain('"org_person_capabilities"."lifecycle_status"');
    expect(sql.params).toEqual(expect.arrayContaining([tenantId, 'person-1', 'draft', 'inactive']));
  });

  it('rejects an unbound subject without linking by email', async () => {
    verify.mockResolvedValue({ issuerUrl: provider.issuerUrl, subject: 'unbound', email: 'admin@example.com' });
    const { service, update } = setup(provider, null);
    await expect(service.resolveIdToken(tenantId, 'signed-token', 'nonce-1'))
      .rejects.toThrow('Company Admin access denied');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a tenant without an active configured provider before token verification', async () => {
    verify.mockClear();
    const { service } = setup(null, null);
    await expect(service.resolveIdToken(tenantId, 'signed-token', 'nonce-1'))
      .rejects.toThrow('Company Admin access denied');
    expect(verify).not.toHaveBeenCalled();
  });
});
