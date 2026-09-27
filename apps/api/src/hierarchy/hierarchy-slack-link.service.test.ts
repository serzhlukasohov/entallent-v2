import { describe, expect, it } from 'vitest';
import { auditLogs, channelAccounts, people, workspaceConnections } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { HierarchySlackLinkError, HierarchySlackLinkService } from './hierarchy-slack-link.service';
import { SlackDirectoryService } from './slack-directory.service';

const tenantId = '00000000-0000-0000-0000-000000000001';
const personId = '00000000-0000-0000-0000-000000000002';
const workspaceId = 'T-1';
const actor = { type: 'internal_operator' as const, operatorId: 'operator-1' };
const directoryUser = { externalUserId: 'U-1', email: 'person@example.com', isBot: false, deleted: false };

function setup(existingAccounts: Array<{ externalUserId: string; userId: string; linkStatus?: string }> = [], directoryUsers = [directoryUser], personStatus = 'draft') {
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const accounts = existingAccounts.map((account, index) => ({
    id: `account-${index}`, tenantId, linkStatus: 'linked', ...account,
  }));
  const rowsFor = (table: unknown) => table === people
    ? [{ id: personId, workEmail: 'person@example.com', lifecycleStatus: personStatus }]
    : table === workspaceConnections ? [{ id: 'workspace-record' }]
      : table === channelAccounts ? accounts : [];
  const dbClient = {
    select: () => ({ from: (table: unknown) => ({
      where: () => {
        const rows = rowsFor(table);
        const query = {
          for: () => query,
          limit: async (count: number) => rows.slice(0, count),
          then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return query;
      },
    }) }),
    insert: (table: unknown) => ({ values: async (value: unknown) => { writes.push({ table, value }); } }),
    update: (table: unknown) => ({ set: (value: unknown) => ({ where: async () => { writes.push({ table, value }); } }) }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(dbClient),
  };
  const directory = {
    listUsers: async () => directoryUsers,
    getUser: async () => directoryUsers[0],
  } as unknown as SlackDirectoryService;
  return {
    service: new HierarchySlackLinkService({ client: dbClient } as unknown as DatabaseService, directory),
    writes,
  };
}

describe('HierarchySlackLinkService', () => {
  it('links a verified eligible Slack account and audits the Person', async () => {
    const { service, writes } = setup();
    await service.linkManually(tenantId, personId, workspaceId, 'U-1', actor);
    expect(writes.find((write) => write.table === channelAccounts)?.value).toMatchObject({
      tenantId, userId: personId, externalWorkspaceId: workspaceId, externalUserId: 'U-1',
    });
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.slack.link', resourceId: personId,
      metadata: { before: null, after: { userId: personId, linkStatus: 'linked' } },
    });
  });

  it('rejects an account already assigned to another user without changing its owner', async () => {
    const { service, writes } = setup([{ externalUserId: 'U-1', userId: 'someone-else' }]);
    await expect(service.linkManually(tenantId, personId, workspaceId, 'U-1', actor))
      .rejects.toMatchObject({ code: 'account_already_assigned' } satisfies Partial<HierarchySlackLinkError>);
    expect(writes.some((write) => write.table === channelAccounts)).toBe(false);
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.slack.link.rejected', reason: 'account_already_assigned',
    });
  });

  it('leaves ambiguous directory matches unlinked and records the rejection', async () => {
    const { service, writes } = setup([], [directoryUser, { ...directoryUser, externalUserId: 'U-2' }]);
    await expect(service.linkByEmail(tenantId, personId, workspaceId, actor))
      .resolves.toEqual({ status: 'ambiguous_slack_match' });
    expect(writes.some((write) => write.table === channelAccounts)).toBe(false);
    expect(writes.find((write) => write.table === auditLogs)?.value).toMatchObject({
      action: 'org.slack.link.rejected', reason: 'ambiguous_slack_match',
    });
  });

  it('does not link a deactivated Person even when the Slack account is available', async () => {
    const { service, writes } = setup([], [directoryUser], 'inactive');
    await expect(service.linkManually(tenantId, personId, workspaceId, 'U-1', actor))
      .rejects.toMatchObject({ code: 'person_not_linkable' });
    expect(writes.some((write) => write.table === channelAccounts)).toBe(false);
  });

  it('reserves an unlinked draft account so inbound cannot create a fallback identity', async () => {
    const { service, writes } = setup([{ externalUserId: 'U-1', userId: personId }]);
    await service.unlinkDraft(tenantId, personId, workspaceId, actor);
    expect(writes.find((write) => write.table === channelAccounts)?.value)
      .toMatchObject({ linkStatus: 'unlinked' });
    expect(writes.find((write) => write.table === auditLogs)?.value)
      .toMatchObject({ action: 'org.slack.unlink', metadata: { reserved: true,
        before: { userId: personId, linkStatus: 'linked' },
        after: { userId: personId, linkStatus: 'unlinked' } } });
  });

  it('reassigns a reserved account to the correct draft Person without creating a duplicate account', async () => {
    const { service, writes } = setup([{ externalUserId: 'U-1', userId: 'formerly-linked-person', linkStatus: 'unlinked' }]);
    await service.linkManually(tenantId, personId, workspaceId, 'U-1', actor);
    expect(writes.find((write) => write.table === channelAccounts)?.value)
      .toMatchObject({ userId: personId, linkStatus: 'linked' });
    expect(writes.filter((write) => write.table === channelAccounts)).toHaveLength(1);
  });

  it('rejects unlinking an active Person', async () => {
    const { service, writes } = setup([{ externalUserId: 'U-1', userId: personId }], [directoryUser], 'active');
    await expect(service.unlinkDraft(tenantId, personId, workspaceId, actor))
      .rejects.toMatchObject({ code: 'person_not_unlinkable' });
    expect(writes.some((write) => write.table === channelAccounts)).toBe(false);
  });
});
