import { Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { channelAccounts, users } from '@entalent/database';
import {
  resolveExternalProfileFacts,
  type ProfileHydrationAccountScope,
  type ProfileHydrationOutcome,
  type UserProfileRepositoryPort,
} from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserProfileRepository implements UserProfileRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
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
  const sanitizedError = outcome.error ? sanitizeOperationalMessage(outcome.error) : null;
  const metadata =
    sql`CASE WHEN jsonb_typeof(${channelAccounts.profileMetadata}) = 'object' THEN ${channelAccounts.profileMetadata} ELSE '{}'::jsonb END`;
  const attemptCountText = sql`${channelAccounts.profileMetadata}->'profileHydration'->>'attemptCount'`;
  const attemptCount = sql`CASE WHEN ${attemptCountText} ~ '^[0-9]+$' THEN ${attemptCountText}::int ELSE 0 END`;

  return sql`jsonb_set(
    ${metadata},
    '{profileHydration}',
    jsonb_strip_nulls(jsonb_build_object(
      'status', ${outcome.status},
      'attemptCount', ${attemptCount} + 1,
      'lastAttemptAt', ${occurredAt},
      'lastSuccessAt', CASE
        WHEN ${outcome.status} = 'success' THEN ${occurredAt}
        ELSE ${channelAccounts.profileMetadata}->'profileHydration'->>'lastSuccessAt'
      END,
      'reason', ${outcome.reason ?? null},
      'lastError', ${sanitizedError}
    )),
    true
  )`;
}

function sanitizeOperationalMessage(message: string): string {
  return message
    .split('\n')[0]
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[redacted-slack-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 200);
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
