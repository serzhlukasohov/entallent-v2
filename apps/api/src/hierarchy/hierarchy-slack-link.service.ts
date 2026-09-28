import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { matchSlackIdentity, type SlackIdentityMatch } from '@entalent/application';
import { auditLogs, channelAccounts, people, workspaceConnections } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, HierarchyAuthorizationError, type HierarchyActor } from './hierarchy-authorization';
import { SlackDirectoryService, type SlackDirectoryUser } from './slack-directory.service';
import { withSerializableRetry } from './serializable-retry';

export class HierarchySlackLinkError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HierarchySlackLinkError';
  }
}

@Injectable()
export class HierarchySlackLinkService {
  constructor(
    private readonly db: DatabaseService,
    private readonly directory: SlackDirectoryService,
  ) {}

  async linkByEmail(
    tenantId: string, personId: string, workspaceId: string, actor: HierarchyActor,
  ): Promise<SlackIdentityMatch> {
    try {
      const person = await this.getLinkablePerson(tenantId, personId, actor);
      const directoryUsers = await this.directory.listUsers(tenantId, workspaceId);
      const assigned = await this.db.client.select({
        externalUserId: channelAccounts.externalUserId, userId: channelAccounts.userId,
        linkStatus: channelAccounts.linkStatus,
      }).from(channelAccounts).where(and(
        eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.externalWorkspaceId, workspaceId),
      ));
      const assignedById = new Map(assigned.filter((account) => account.linkStatus === 'linked')
        .map((account) => [account.externalUserId, account.userId]));
      const match = matchSlackIdentity({
        tenantId, workspaceId, personId, workEmail: person.workEmail,
        candidates: directoryUsers.map((user) => ({
          tenantId, workspaceId, ...user, assignedPersonId: assignedById.get(user.externalUserId) ?? null,
        })),
      });
      if (match.status !== 'matched') {
        await this.auditRejected(tenantId, personId, workspaceId, actor, new HierarchySlackLinkError(match.status));
        return match;
      }
      await this.persistLink(tenantId, personId, workspaceId, match.externalUserId, actor);
      return match;
    } catch (error) {
      await this.auditRejected(tenantId, personId, workspaceId, actor, error);
      throw error;
    }
  }

  async linkManually(
    tenantId: string, personId: string, workspaceId: string, externalUserId: string, actor: HierarchyActor,
  ): Promise<void> {
    try {
      await this.getLinkablePerson(tenantId, personId, actor);
      const user = await this.directory.getUser(tenantId, workspaceId, externalUserId);
      if (!isEligible(user) || user.externalUserId !== externalUserId) {
        throw new HierarchySlackLinkError('slack_user_not_eligible');
      }
      await this.persistLink(tenantId, personId, workspaceId, externalUserId, actor);
    } catch (error) {
      await this.auditRejected(tenantId, personId, workspaceId, actor, error);
      throw error;
    }
  }

  async unlinkDraft(
    tenantId: string, personId: string, workspaceId: string, actor: HierarchyActor,
  ): Promise<void> {
    try {
      await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
        await assertHierarchyActorAuthorized(tx, tenantId, actor);
        const [person] = await tx.select({ lifecycleStatus: people.lifecycleStatus }).from(people)
          .where(and(eq(people.id, personId), eq(people.tenantId, tenantId))).for('update').limit(1);
        if (!person || person.lifecycleStatus !== 'draft') throw new HierarchySlackLinkError('person_not_unlinkable');
        const [account] = await tx.select({ id: channelAccounts.id, externalUserId: channelAccounts.externalUserId })
          .from(channelAccounts).where(and(
            eq(channelAccounts.tenantId, tenantId), eq(channelAccounts.userId, personId),
            eq(channelAccounts.channelType, 'slack'),
            eq(channelAccounts.externalWorkspaceId, workspaceId),
            eq(channelAccounts.linkStatus, 'linked'),
          )).for('update').limit(1);
        if (!account) throw new HierarchySlackLinkError('slack_link_not_found');
        await tx.update(channelAccounts).set({ linkStatus: 'unlinked', updatedAt: new Date() })
          .where(and(eq(channelAccounts.id, account.id), eq(channelAccounts.tenantId, tenantId)));
        await tx.insert(auditLogs).values({
          tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.slack.unlink',
          resourceType: 'person', resourceId: personId,
          metadata: { workspaceId, externalUserId: account.externalUserId, reserved: true,
            before: { accountId: account.id, linkStatus: 'linked', userId: personId },
            after: { accountId: account.id, linkStatus: 'unlinked', userId: personId } },
        });
      }, { isolationLevel: 'serializable' }));
    } catch (error) {
      await this.auditRejected(tenantId, personId, workspaceId, actor, error, 'unlink');
      throw error;
    }
  }

  private async getLinkablePerson(tenantId: string, personId: string, actor: HierarchyActor): Promise<{ workEmail: string }> {
    return this.db.client.transaction(async (tx) => {
      await assertHierarchyActorAuthorized(tx, tenantId, actor);
      const [person] = await tx.select({
        workEmail: people.workEmail, lifecycleStatus: people.lifecycleStatus,
      }).from(people).where(and(eq(people.id, personId), eq(people.tenantId, tenantId))).limit(1);
      if (!person || person.lifecycleStatus !== 'draft') throw new HierarchySlackLinkError('person_not_linkable');
      return person;
    });
  }

  private async persistLink(
    tenantId: string, personId: string, workspaceId: string, externalUserId: string, actor: HierarchyActor,
  ): Promise<void> {
    await withSerializableRetry(() => this.db.client.transaction(async (tx) => {
      await assertHierarchyActorAuthorized(tx, tenantId, actor);
      const [person] = await tx.select({ id: people.id, lifecycleStatus: people.lifecycleStatus })
        .from(people).where(and(eq(people.id, personId), eq(people.tenantId, tenantId)))
        .for('update').limit(1);
      if (!person || person.lifecycleStatus !== 'draft') throw new HierarchySlackLinkError('person_not_linkable');
      const [workspace] = await tx.select({ id: workspaceConnections.id }).from(workspaceConnections).where(and(
        eq(workspaceConnections.tenantId, tenantId),
        eq(workspaceConnections.channelType, 'slack'),
        eq(workspaceConnections.externalWorkspaceId, workspaceId),
        eq(workspaceConnections.status, 'active'),
      )).limit(1);
      if (!workspace) throw new HierarchySlackLinkError('slack_workspace_not_found');

      const [existingAccount] = await tx.select({
        id: channelAccounts.id, tenantId: channelAccounts.tenantId,
        userId: channelAccounts.userId, linkStatus: channelAccounts.linkStatus,
      }).from(channelAccounts).where(and(
        eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.externalWorkspaceId, workspaceId),
        eq(channelAccounts.externalUserId, externalUserId),
      )).limit(1);
      if (existingAccount && (existingAccount.tenantId !== tenantId ||
        (existingAccount.linkStatus === 'linked' && existingAccount.userId !== personId))) {
        throw new HierarchySlackLinkError('account_already_assigned');
      }
      const otherForPerson = await tx.select({ externalUserId: channelAccounts.externalUserId }).from(channelAccounts).where(and(
        eq(channelAccounts.tenantId, tenantId),
        eq(channelAccounts.userId, personId),
        eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.externalWorkspaceId, workspaceId),
        eq(channelAccounts.linkStatus, 'linked'),
      ));
      if (otherForPerson.some((account) => account.externalUserId !== externalUserId)) {
        throw new HierarchySlackLinkError('person_already_linked');
      }
      if (existingAccount?.linkStatus === 'linked') return;

      if (existingAccount) {
        await tx.update(channelAccounts).set({ userId: personId, linkStatus: 'linked', updatedAt: new Date() })
          .where(and(eq(channelAccounts.id, existingAccount.id), eq(channelAccounts.tenantId, tenantId),
            eq(channelAccounts.linkStatus, 'unlinked')));
      } else {

        await tx.insert(channelAccounts).values({
          tenantId, userId: personId, channelType: 'slack',
          externalWorkspaceId: workspaceId, externalUserId,
        });
      }
      await tx.insert(auditLogs).values({
        tenantId, actorType: actor.type, actorId: actorId(actor), action: 'org.slack.link',
        resourceType: 'person', resourceId: personId,
        metadata: { workspaceId, externalUserId,
          before: existingAccount
            ? { accountId: existingAccount.id, linkStatus: existingAccount.linkStatus,
              userId: existingAccount.userId }
            : null,
          after: { ...(existingAccount ? { accountId: existingAccount.id } : {}),
            linkStatus: 'linked', userId: personId } },
      });
    }, { isolationLevel: 'serializable' }));
  }

  private async auditRejected(
    tenantId: string, personId: string, workspaceId: string, actor: HierarchyActor, error: unknown,
    operation: 'link' | 'unlink' = 'link',
  ): Promise<void> {
    const code = error instanceof HierarchyAuthorizationError ? 'unauthorized'
      : error instanceof HierarchySlackLinkError ? error.code
        : typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
          ? 'account_already_assigned' : 'link_failed';
    await this.db.client.insert(auditLogs).values({
      tenantId, actorType: actor.type, actorId: actorId(actor), action: `org.slack.${operation}.rejected`,
      resourceType: 'person', resourceId: personId, reason: code,
      metadata: { workspaceId },
    });
  }
}

function isEligible(user: SlackDirectoryUser): boolean {
  return !user.isBot && !user.deleted;
}
