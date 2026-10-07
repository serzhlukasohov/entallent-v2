import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { PrimaryOrgRole } from '@entalent/application';
import { SlackAdapter } from '@entalent/channel-slack';
import {
  channelAccounts, conversations, orgOnboardingDeliveries, people, users,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { OnboardingIntroService } from '../onboarding/onboarding-intro.service';
import { WorkspaceConnectionRepository } from './repositories/workspace-connection.repository';

const RETRY_AFTER_MS = 60 * 60 * 1000;

@Injectable()
export class OnboardingDispatchService {
  private readonly logger = new Logger(OnboardingDispatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly workspaceRepo: WorkspaceConnectionRepository,
    private readonly intro: OnboardingIntroService,
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
      // Q18: no intro (and so no buttons whose reminder cannot be scheduled) before the calendar exists.
      sql`EXISTS (SELECT 1 FROM tenant_work_calendars wc WHERE wc.tenant_id = ${orgOnboardingDeliveries.tenantId})`,
    )).orderBy(orgOnboardingDeliveries.createdAt).limit(25);
    await this.logHeldWithoutCalendar(tenantId, unitId);

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
    await this.recoverStrandedTrustMessages(tenantId);
    return { found: rows.length, queued, failed };
  }

  /** Deliveries in tenants without a work calendar stay pending untouched; one log line per tick. Never throws. */
  private async logHeldWithoutCalendar(tenantId?: string, unitId?: string): Promise<void> {
    try {
      const [row] = (await this.db.client.execute(sql`
        SELECT count(*)::int AS held, count(DISTINCT d.tenant_id)::int AS tenants
        FROM org_onboarding_deliveries d
        WHERE d.status IN ('pending', 'failed')
          AND NOT EXISTS (SELECT 1 FROM tenant_work_calendars wc WHERE wc.tenant_id = d.tenant_id)
          ${tenantId ? sql`AND d.tenant_id = ${tenantId}` : sql``}
          ${unitId ? sql`AND d.unit_id = ${unitId}` : sql``}
      `)) as unknown as Array<{ held: number; tenants: number }>;
      if (row && Number(row.held) > 0) {
        this.logger.warn(`${row.held} onboarding deliveries held: ${row.tenants} tenant(s) have no work calendar (Q18)`);
      }
    } catch (error) {
      this.logger.error(`Held onboarding delivery check failed: ${(error as Error).message}`);
    }
  }

  /**
   * Safety net for the intro chain: an intro half that was delivered whose trust half was never queued
   * (crash between the two, lost job). Never throws; the deterministic job id makes repeats harmless.
   */
  private async recoverStrandedTrustMessages(tenantId?: string): Promise<void> {
    try {
      const rows = (await this.db.client.execute(sql`
        SELECT i.tenant_id AS tenant_id, i.conversation_id AS conversation_id, i.metadata AS metadata,
               c.channel_type AS channel_type, c.external_conversation_id AS external_conversation_id,
               ca.external_workspace_id AS external_workspace_id
        FROM messages i
        JOIN messages t ON t.id = (i.metadata->>'onboardingTrustMessageId')::uuid AND t.tenant_id = i.tenant_id
        JOIN conversations c ON c.id = i.conversation_id AND c.tenant_id = i.tenant_id
        JOIN channel_accounts ca ON ca.user_id = i.user_id AND ca.tenant_id = i.tenant_id
          AND ca.channel_type = c.channel_type AND ca.link_status = 'linked'
        WHERE i.message_type = 'onboarding_intro' AND i.direction = 'outbound'
          AND i.metadata->>'onboardingIntroPart' = 'intro'
          AND i.metadata->>'onboardingTrustMessageId' ~ '^[0-9a-f-]{36}$'
          AND i.sent_at IS NOT NULL AND i.sent_at > now() - interval '7 days'
          AND t.sent_at IS NULL AND t.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM messages n
            WHERE n.tenant_id = i.tenant_id AND n.user_id = i.user_id AND n.direction = 'outbound'
              AND n.message_type = 'onboarding_intro' AND n.metadata->>'onboardingIntroPart' = 'intro'
              AND n.occurred_at > i.occurred_at
          )
          ${tenantId ? sql`AND i.tenant_id = ${tenantId}` : sql``}
        ORDER BY i.sent_at
        LIMIT 25
      `)) as unknown as Array<{
        tenant_id: string; conversation_id: string; metadata: unknown; channel_type: string;
        external_conversation_id: string; external_workspace_id: string;
      }>;
      for (const r of rows) {
        try {
          await this.intro.enqueueTrustAfterIntro({
            tenantId: r.tenant_id, conversationId: r.conversation_id, channelType: r.channel_type,
            externalWorkspaceId: r.external_workspace_id, externalChannelId: r.external_conversation_id,
            introMetadata: r.metadata,
          });
        } catch (error) {
          this.logger.error(`Trust message recovery failed conversation=${r.conversation_id}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Trust message recovery sweep failed: ${(error as Error).message}`);
    }
  }

  private async dispatchOne(delivery: typeof orgOnboardingDeliveries.$inferSelect): Promise<void> {
    const [person] = await this.db.client.select({
      lifecycleStatus: people.lifecycleStatus,
      primaryRole: people.primaryRole,
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
    await this.intro.sendIntro({
      tenantId: delivery.tenantId, personId: delivery.personId, role: person.primaryRole as PrimaryOrgRole,
      deliveryId: delivery.id,
      conversation: {
        id: conversation.id, channelType: 'slack', externalConversationId: dmChannelId,
        externalWorkspaceId: delivery.externalWorkspaceId,
      },
    });
  }
}
