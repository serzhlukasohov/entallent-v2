import { describe, expect, it, vi } from 'vitest';
import { channelAccounts, users } from '@entalent/database';
import { IngestionService } from './ingestion.service';

const params = {
  tenantId: 'tenant-1', channelType: 'slack', externalWorkspaceId: 'T-1', externalUserId: 'U-1',
};

type AccountRow = {
  userId: string;
  accountTenantId: string;
  userTenantId: string;
  userStatus: string;
  linkStatus: string;
  deletedAt: Date | null;
  personLifecycle: string | null;
  pulseParticipant: boolean | null;
};

function setup(account: AccountRow | null) {
  const writes: unknown[] = [];
  const query = {
    innerJoin: () => query,
    leftJoin: () => query,
    where: () => query,
    limit: async () => account ? [account] : [],
  };
  const tx = {
    select: () => ({ from: () => query }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      writes.push({ table, value });
      return table === users ? { returning: async () => [{ id: 'new-user' }] } : Promise.resolve();
    } }),
  };
  const client = { transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)) };
  return {
    service: new IngestionService({ client } as never, {} as never),
    writes,
    client,
  };
}

describe('IngestionService.findOrCreateUser', () => {
  const active = {
    userId: 'person-1', accountTenantId: 'tenant-1', userTenantId: 'tenant-1',
    userStatus: 'active', linkStatus: 'linked', deletedAt: null, personLifecycle: 'active', pulseParticipant: true,
  };

  it('reuses a provisioned Person and excludes draft or non-participant Persons from runtime', async () => {
    const linked = setup(active);
    await expect(linked.service.findOrCreateUser(params)).resolves.toEqual({ userId: 'person-1', runtimeEligible: true });
    expect(linked.writes).toEqual([]);

    for (const account of [
      { ...active, userStatus: 'inactive', personLifecycle: 'draft' },
      { ...active, pulseParticipant: false },
      { ...active, personLifecycle: 'inactive' },
    ]) {
      const pending = setup(account);
      await expect(pending.service.findOrCreateUser(params)).resolves.toEqual({ userId: 'person-1', runtimeEligible: false });
      expect(pending.writes).toEqual([]);
    }
  });

  it('keeps active legacy users eligible while rejecting a cross-tenant account', async () => {
    await expect(setup({ ...active, personLifecycle: null, pulseParticipant: null })
      .service.findOrCreateUser(params)).resolves.toEqual({ userId: 'person-1', runtimeEligible: true });
    await expect(setup({ ...active, accountTenantId: 'tenant-2' })
      .service.findOrCreateUser(params)).rejects.toThrow('channel_account_tenant_mismatch');
  });

  it('reserves an unlinked Slack account without admitting runtime or creating a fallback user', async () => {
    const reserved = setup({ ...active, linkStatus: 'unlinked' });
    await expect(reserved.service.findOrCreateUser(params))
      .resolves.toEqual({ userId: 'person-1', runtimeEligible: false });
    expect(reserved.writes).toEqual([]);
  });

  it('creates the fallback user and account in one transaction only when no link exists', async () => {
    const { service, writes, client } = setup(null);
    await expect(service.findOrCreateUser(params)).resolves.toEqual({ userId: 'new-user', runtimeEligible: true });
    expect(client.transaction).toHaveBeenCalledOnce();
    expect(writes).toEqual([
      expect.objectContaining({ table: users }),
      expect.objectContaining({ table: channelAccounts, value: expect.objectContaining({ userId: 'new-user', tenantId: 'tenant-1' }) }),
    ]);
  });
});
