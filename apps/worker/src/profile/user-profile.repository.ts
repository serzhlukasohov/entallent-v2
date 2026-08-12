import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { channelAccounts, users } from '@entalent/database';
import type { ProfileHydrationOutcome, UserProfileRepositoryPort } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

type ProfileMetadata = Record<string, unknown>;

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
    profile: { displayName?: string; timezone?: string },
  ): Promise<void> {
    const displayName = profile.displayName?.trim();
    const updateSet: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (profile.timezone) {
      updateSet.timezone = profile.timezone;
      updateSet.timezoneUpdatedAt = new Date();
    }

    const [user] = await this.db.client
      .select({ preferredName: users.preferredName })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1);

    if (displayName && !user?.preferredName?.trim()) {
      updateSet.preferredName = displayName;
    }

    await this.db.client
      .update(users)
      .set(updateSet)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    if (displayName) {
      await this.db.client
        .update(channelAccounts)
        .set({ displayName, updatedAt: new Date() })
        .where(and(eq(channelAccounts.userId, userId), eq(channelAccounts.tenantId, tenantId)));
    }
  }

  async recordProfileHydrationOutcome(
    userId: string,
    tenantId: string,
    channelType: string,
    outcome: ProfileHydrationOutcome,
  ): Promise<void> {
    const rows = await this.db.client
      .select({
        id: channelAccounts.id,
        profileMetadata: channelAccounts.profileMetadata,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.userId, userId),
          eq(channelAccounts.tenantId, tenantId),
          eq(channelAccounts.channelType, channelType),
        ),
      );

    await Promise.all(
      rows.map((row) => {
        const currentMetadata = normalizeMetadata(row.profileMetadata);
        const currentHydration = normalizeMetadata(currentMetadata['profileHydration']);
        const previousAttemptCount = Number(currentHydration['attemptCount'] ?? 0);
        const attemptCount = Number.isFinite(previousAttemptCount) ? previousAttemptCount + 1 : 1;
        const hydration: ProfileMetadata = {
          status: outcome.status,
          attemptCount,
          lastAttemptAt: outcome.occurredAt.toISOString(),
        };

        if (outcome.status === 'success') {
          hydration['lastSuccessAt'] = outcome.occurredAt.toISOString();
        } else if (typeof currentHydration['lastSuccessAt'] === 'string') {
          hydration['lastSuccessAt'] = currentHydration['lastSuccessAt'];
        }
        if (outcome.reason) {
          hydration['reason'] = outcome.reason;
        }
        if (outcome.error) {
          hydration['lastError'] = sanitizeOperationalMessage(outcome.error);
        }

        return this.db.client
          .update(channelAccounts)
          .set({
            profileMetadata: {
              ...currentMetadata,
              profileHydration: hydration,
            },
            updatedAt: new Date(),
          })
          .where(eq(channelAccounts.id, row.id));
      }),
    );
  }
}

function sanitizeOperationalMessage(message: string): string {
  return message
    .split('\n')[0]
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[redacted-slack-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 200);
}

function normalizeMetadata(value: unknown): ProfileMetadata {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProfileMetadata)
    : {};
}
