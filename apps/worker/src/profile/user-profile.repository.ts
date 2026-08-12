import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { channelAccounts, users } from '@entalent/database';
import type { UserProfileRepositoryPort } from '@entalent/application';
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
}
