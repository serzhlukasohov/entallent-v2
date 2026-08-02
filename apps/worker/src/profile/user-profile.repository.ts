import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { users } from '@entalent/database';
import type { UserProfileRepositoryPort } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserProfileRepository implements UserProfileRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async updateTimezone(userId: string, tenantId: string, timezone: string): Promise<void> {
    await this.db.client.update(users)
      .set({ timezone, timezoneUpdatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  }
}
