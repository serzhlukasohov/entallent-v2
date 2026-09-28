import { describe, expect, it, vi } from 'vitest';
import { auditLogs, orgPersonCapabilities, people } from '@entalent/database';
import { HierarchyCapabilityService } from './hierarchy-capability.service';

const tenantId = 'tenant-1';
const personId = 'person-1';
const operator = { type: 'internal_operator' as const, operatorId: 'operator-1' };

function setup(existing: string | null = null, lifecycleStatus = 'draft') {
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const tx = {
    select: () => ({ from: (table: unknown) => {
      const rows = table === people
        ? [{ id: personId, lifecycleStatus, deletedAt: null }]
        : table === orgPersonCapabilities && existing ? [{ lifecycleStatus: existing }] : [];
      const query = {
        innerJoin: () => query,
        where: () => query,
        for: () => query,
        limit: async () => rows,
      };
      return query;
    } }),
    insert: (table: unknown) => ({ values: async (value: unknown) => { writes.push({ table, value }); } }),
    update: (table: unknown) => ({ set: (value: unknown) => ({ where: async () => { writes.push({ table, value }); } }) }),
  };
  const db = {
    ...tx,
    transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx)),
  };
  return { service: new HierarchyCapabilityService({ client: db } as never), writes, db };
}

describe('HierarchyCapabilityService', () => {
  it('grants Company Admin to a draft Person and audits the transition', async () => {
    const { service, writes, db } = setup();
    await expect(service.grantCompanyAdmin(tenantId, personId, operator))
      .resolves.toEqual({ personId, capability: 'company_admin', lifecycleStatus: 'active', changed: true });
    expect(writes.find((w) => w.table === orgPersonCapabilities)?.value)
      .toMatchObject({ tenantId, personId, lifecycleStatus: 'active' });
    expect(writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.company_admin.grant', metadata: { before: null,
        after: { personId, capability: 'company_admin', lifecycleStatus: 'active' } } });
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'serializable' });
  });

  it('revokes another Person and rejects self-revocation', async () => {
    const { service, writes } = setup('active');
    await expect(service.revokeCompanyAdmin(tenantId, personId, operator))
      .resolves.toMatchObject({ lifecycleStatus: 'inactive', changed: true });
    expect(writes.find((w) => w.table === orgPersonCapabilities)?.value)
      .toMatchObject({ lifecycleStatus: 'inactive' });

    const self = setup('active');
    await expect(self.service.revokeCompanyAdmin(tenantId, personId,
      { type: 'company_admin', personId })).rejects.toMatchObject({ code: 'self_revoke_forbidden' });
    expect(self.db.transaction).not.toHaveBeenCalled();
    expect(self.writes.find((w) => w.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.company_admin.revoke.rejected', reason: 'self_revoke_forbidden' });
  });

  it('rejects granting a deactivated Person without a capability write', async () => {
    const { service, writes } = setup(null, 'inactive');
    await expect(service.grantCompanyAdmin(tenantId, personId, operator))
      .rejects.toMatchObject({ code: 'person_not_eligible' });
    expect(writes.some((w) => w.table === orgPersonCapabilities)).toBe(false);
  });
});
