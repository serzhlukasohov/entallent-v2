import { Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  channelAccounts, conversationDispatchIntents, conversationJobAdmissions,
  conversationTurnEffects, conversations, users,
} from '@entalent/database';
import {
  resolveExternalProfileFacts,
  type ProfileHydrationAccountScope,
  type ProfileHydrationOutcome,
  type CommittedProfileHydrationInput,
  type CommittedProfileHydrationRepositoryPort,
} from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserProfileRepository implements CommittedProfileHydrationRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async isCommittedHydrationComplete(input: CommittedProfileHydrationInput): Promise<boolean> {
    const row = await this.findCommittedHydration(input, false);
    if (!row) throw new Error('profile_hydration_intent_scope_mismatch');
    return row.completedAt !== null;
  }

  async completeCommittedHydration(
    input: CommittedProfileHydrationInput,
    profile: { externalUserId?: string; displayName?: string; timezone?: string } | null,
    occurredAt: Date,
  ): Promise<void> {
    await this.db.withTransaction(async () => {
      const row = await this.findCommittedHydration(input, true);
      if (!row) throw new Error('profile_hydration_intent_scope_mismatch');
      if (row.completedAt !== null) return;
      if (profile) {
        await this.updateProfile(input.userId, input.tenantId, {
          ...profile,
          channelType: input.channelType,
          externalWorkspaceId: input.externalWorkspaceId,
        });
      }
      await this.recordProfileHydrationOutcome(
        input.userId, input.tenantId, input.channelType,
        { status: profile ? 'success' : 'missing_profile',
          ...(profile ? {} : { reason: 'external_profile_unavailable' }),
          occurredAt },
        input.externalWorkspaceId ? { externalWorkspaceId: input.externalWorkspaceId } : undefined,
      );
      await this.db.client.update(conversationDispatchIntents)
        .set({ completedAt: new Date() })
        .where(eq(conversationDispatchIntents.id, row.id));
    });
  }

  private async findCommittedHydration(
    input: CommittedProfileHydrationInput,
    lock: boolean,
  ): Promise<{ id: string; completedAt: Date | null } | null> {
    const rows = await this.db.client.execute(sql`select intent.id, intent.completed_at
      from ${conversationDispatchIntents} intent
      join ${conversationTurnEffects} effect on effect.inbound_message_id = intent.inbound_message_id
      join ${conversationJobAdmissions} admission on admission.message_id = effect.inbound_message_id
        and admission.tenant_id = effect.tenant_id and admission.user_id = effect.user_id
        and admission.conversation_id = effect.conversation_id
      join ${conversations} owner on owner.id = effect.conversation_id
        and owner.tenant_id = effect.tenant_id and owner.user_id = effect.user_id
        and owner.external_conversation_id = admission.external_conversation_id
      where intent.inbound_message_id = ${input.inboundMessageId}::uuid
        and intent.kind = 'profile_hydration' and intent.target_id = effect.inbound_message_id
        and effect.tenant_id = ${input.tenantId}::uuid
        and effect.user_id = ${input.userId}::uuid
        and owner.channel_type = ${input.channelType}
        and ${input.externalWorkspaceId
          ? sql`admission.external_workspace_id = ${input.externalWorkspaceId}` : sql`true`}
      limit 1
      ${lock ? sql`for update of intent` : sql``}`);
    const row = rows[0];
    return row ? {
      id: String(row['id']),
      completedAt: row['completed_at'] ? new Date(String(row['completed_at'])) : null,
    } : null;
  }
  async updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void> {
    await this.db.client
      .update(users)
      .set({ timezone, timezoneUpdatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  }

  async updateProfile(
    userId: string,
    tenantId: string,
    profile: {
      channelType?: string;
      externalWorkspaceId?: string;
      externalUserId?: string;
      displayName?: string;
      timezone?: string;
    },
  ): Promise<void> {
    const updateSet: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    const [user] = await this.db.client
      .select({ preferredName: users.preferredName })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    const profileFacts = resolveExternalProfileFacts(profile, {
      preferredName: user?.preferredName,
    });

    if (profileFacts.timezone) {
      updateSet.timezone = profileFacts.timezone;
      updateSet.timezoneUpdatedAt = new Date();
    }

    if (profileFacts.preferredName) {
      updateSet.preferredName = profileFacts.preferredName;
    }

    await this.db.client
      .update(users)
      .set(updateSet)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    if (profileFacts.displayName) {
      await this.db.client
        .update(channelAccounts)
        .set({ displayName: profileFacts.displayName, updatedAt: new Date() })
        .where(and(...buildChannelAccountPredicates(userId, tenantId, profile)));
    }
  }

  async recordProfileHydrationOutcome(
    userId: string,
    tenantId: string,
    channelType: string,
    outcome: ProfileHydrationOutcome,
    scope: ProfileHydrationAccountScope = {},
  ): Promise<void> {
    const predicates = buildChannelAccountPredicates(userId, tenantId, {
      channelType,
      ...scope,
    });

    await this.db.client
      .update(channelAccounts)
      .set({
        profileMetadata: buildProfileHydrationMetadataUpdate(outcome),
        updatedAt: new Date(),
      })
      .where(and(...predicates));
  }
}

function buildProfileHydrationMetadataUpdate(outcome: ProfileHydrationOutcome): SQL {
  const occurredAt = outcome.occurredAt.toISOString();
  const safeError = outcome.error === 'external_profile_fetch_failed'
    || outcome.error === 'profile_update_failed'
    ? outcome.error
    : outcome.error ? 'profile_hydration_failed' : null;
  const safeReason = outcome.reason === 'external_profile_unavailable'
    ? outcome.reason : null;
  const metadata =
    sql`CASE WHEN jsonb_typeof(${channelAccounts.profileMetadata}) = 'object' THEN ${channelAccounts.profileMetadata} ELSE '{}'::jsonb END`;
  const attemptCountText = sql`${channelAccounts.profileMetadata}->'profileHydration'->>'attemptCount'`;
  const attemptCount = sql`CASE WHEN (${attemptCountText}) ~ '^[0-9]+$' THEN (${attemptCountText})::int ELSE 0 END`;

  return sql`jsonb_set(
    ${metadata},
    '{profileHydration}',
    jsonb_strip_nulls(jsonb_build_object(
      'status', ${outcome.status}::text,
      'attemptCount', ${attemptCount} + 1,
      'lastAttemptAt', ${occurredAt}::text,
      'lastSuccessAt', CASE
        WHEN ${outcome.status}::text = 'success' THEN ${occurredAt}::text
        ELSE ${channelAccounts.profileMetadata}->'profileHydration'->>'lastSuccessAt'
      END,
      'reason', ${safeReason}::text,
      'lastError', ${safeError}::text
    )),
    true
  )`;
}

function buildChannelAccountPredicates(
  userId: string,
  tenantId: string,
  scope: {
    channelType?: string;
    externalWorkspaceId?: string;
    externalUserId?: string;
  },
): SQL[] {
  const predicates: SQL[] = [
    eq(channelAccounts.userId, userId),
    eq(channelAccounts.tenantId, tenantId),
    eq(channelAccounts.linkStatus, 'linked'),
  ];

  if (scope.channelType) {
    predicates.push(eq(channelAccounts.channelType, scope.channelType));
  }
  if (scope.externalWorkspaceId) {
    predicates.push(eq(channelAccounts.externalWorkspaceId, scope.externalWorkspaceId));
  }
  if (scope.externalUserId) {
    predicates.push(eq(channelAccounts.externalUserId, scope.externalUserId));
  }

  return predicates;
}
