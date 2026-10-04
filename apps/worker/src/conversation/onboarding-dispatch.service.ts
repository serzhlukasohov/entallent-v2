import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { ProactiveCheckInUseCase } from '@entalent/application';
import { SlackAdapter } from '@entalent/channel-slack';
import {
  channelAccounts, conversations, orgOnboardingDeliveries, people, users,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { WorkspaceConnectionRepository } from './repositories/workspace-connection.repository';

const RETRY_AFTER_MS = 60 * 60 * 1000;

@Injectable()
export class OnboardingDispatchService {
  private readonly logger = new Logger(OnboardingDispatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly workspaceRepo: WorkspaceConnectionRepository,
    private readonly checkIn: ProactiveCheckInUseCase,
  ) {}

  async dispatchPending(tenantId?: string, unitId?: string): Promise<{ found: number; queued: number; failed: number }> {
    const retryBefore = new Date(Date.now() - RETRY_AFTER_MS);
    const rows = await this.db.client.select().from(orgOnboardingDeliveries).where(and(
      tenantId ? eq(orgOnboardingDeliveries.tenantId, tenantId) : undefined,
      unitId ? eq(orgOnboardingDeliveries.unitId, unitId) : undefined,
      or(
        eq(orgOnboardingDeliveries.status, 'pending'),
        and(eq(orgOnboardingDeliveries.status, 'failed'), lt(orgOnboardingDeliveries.lastAttemptAt, retryBefore)),
      ),
    )).orderBy(orgOnboardingDeliveries.createdAt).limit(25);

    let queued = 0;
    let failed = 0;
    for (const delivery of rows) {
      try {
        await this.dispatchOne(delivery);
        queued++;
      } catch (error) {
        failed++;
        await this.db.client.update(orgOnboardingDeliveries).set({
          status: 'failed', attemptCount: sql`${orgOnboardingDeliveries.attemptCount} + 1`,
          lastAttemptAt: new Date(), updatedAt: new Date(),
        }).where(and(
          eq(orgOnboardingDeliveries.id, delivery.id), eq(orgOnboardingDeliveries.tenantId, delivery.tenantId),
          or(eq(orgOnboardingDeliveries.status, 'pending'), eq(orgOnboardingDeliveries.status, 'failed')),
        ));
        this.logger.error(`Onboarding preparation failed delivery=${delivery.id}: ${(error as Error).message}`);
      }
    }
    return { found: rows.length, queued, failed };
  }

  private async dispatchOne(delivery: typeof orgOnboardingDeliveries.$inferSelect): Promise<void> {
    const [person] = await this.db.client.select({
      lifecycleStatus: people.lifecycleStatus,
      pulseParticipant: people.pulseParticipant,
      userStatus: users.status,
      deletedAt: users.deletedAt,
    }).from(people).innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
      .where(and(eq(people.id, delivery.personId), eq(people.tenantId, delivery.tenantId))).limit(1);
    if (!person || person.lifecycleStatus !== 'active' || person.userStatus !== 'active' || person.deletedAt !== null) {
      throw new Error('onboarding_person_not_active');
    }

    const accounts = await this.db.client.select({ externalUserId: channelAccounts.externalUserId })
      .from(channelAccounts).where(and(
        eq(channelAccounts.userId, delivery.personId), eq(channelAccounts.tenantId, delivery.tenantId),
        eq(channelAccounts.channelType, 'slack'),
        eq(channelAccounts.linkStatus, 'linked'),
        eq(channelAccounts.externalWorkspaceId, delivery.externalWorkspaceId),
      )).limit(2);
    if (accounts.length !== 1) throw new Error(accounts.length === 0
      ? 'onboarding_slack_account_missing' : 'onboarding_slack_account_ambiguous');

    const workspace = await this.workspaceRepo.findByExternalWorkspace('slack', delivery.externalWorkspaceId, delivery.tenantId);
    if (!workspace) throw new Error('onboarding_workspace_inactive');
    const dmChannelId = await new SlackAdapter({ botToken: workspace.botToken }).openDirectMessage(accounts[0].externalUserId);

    await this.db.client.insert(conversations).values({
      tenantId: delivery.tenantId, userId: delivery.personId,
      channelType: 'slack', externalConversationId: dmChannelId,
    }).onConflictDoNothing();
    const [conversation] = await this.db.client.select({ id: conversations.id, userId: conversations.userId, status: conversations.status })
      .from(conversations).where(and(
        eq(conversations.tenantId, delivery.tenantId),
        eq(conversations.channelType, 'slack'), eq(conversations.externalConversationId, dmChannelId),
      )).limit(1);
    if (!conversation || conversation.userId !== delivery.personId) throw new Error('onboarding_conversation_ownership_mismatch');
    if (conversation.status !== 'active') {
      await this.db.client.update(conversations).set({ status: 'active', updatedAt: new Date() })
        .where(and(eq(conversations.id, conversation.id), eq(conversations.tenantId, delivery.tenantId),
          eq(conversations.userId, delivery.personId)));
    }

    if (delivery.status === 'failed') {
      await this.db.client.update(orgOnboardingDeliveries).set({ status: 'pending', updatedAt: new Date() })
        .where(and(eq(orgOnboardingDeliveries.id, delivery.id), eq(orgOnboardingDeliveries.status, 'failed')));
    }
    await this.checkIn.execute({
      tenantId: delivery.tenantId, userId: delivery.personId,
      conversationId: conversation.id, externalWorkspaceId: delivery.externalWorkspaceId,
      externalConversationId: dmChannelId, traceId: `onboarding:${delivery.id}`,
      onboardingMessageId: delivery.id, pulseEnabled: person.pulseParticipant,
    });
  }
}
