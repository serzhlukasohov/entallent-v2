import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { featureFlags } from '@entalent/database';
import type { FeatureFlagPort, FeatureFlagContext } from '@entalent/application';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class FeatureFlagRepository implements FeatureFlagPort {
  constructor(private readonly db: DatabaseService) {}

  async isEnabled(key: string, context: FeatureFlagContext): Promise<boolean> {
    const rows = await this.db.client
      .select()
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.key, key),
          or(eq(featureFlags.tenantId, context.tenantId), isNull(featureFlags.tenantId)),
        ),
      );

    // Tenant-specific flag takes precedence over global
    const tenantFlag = rows.find((r) => r.tenantId === context.tenantId);
    const globalFlag = rows.find((r) => r.tenantId === null);
    const flag = tenantFlag ?? globalFlag;

    if (!flag) return false; // unknown flag → disabled by default

    if (!flag.enabled) return false;

    // Rollout percentage check using consistent hash of userId
    if (flag.rolloutPercentage < 100 && context.userId) {
      const bucket = userBucket(context.userId);
      return bucket < flag.rolloutPercentage;
    }

    return true;
  }
}

function userBucket(userId: string): number {
  const hash = createHash('md5').update(userId).digest('hex').slice(0, 8);
  return parseInt(hash, 16) % 100;
}
