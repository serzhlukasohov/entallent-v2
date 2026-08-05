import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  RUNTIME_CONTROL_FLAGS,
  type FeatureFlagContext,
  type RuntimeControlFlagKey,
  type RuntimeControlFlagPort,
} from '@entalent/application';
import { featureFlags } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { FeatureFlagRepository } from './feature-flag.repository';

type FeatureFlagRow = typeof featureFlags.$inferSelect;
type RuntimeControlFlagState = Pick<FeatureFlagRow, 'tenantId' | 'enabled'>;
type RuntimeControlDenylistState = Pick<FeatureFlagRow, 'enabled' | 'metadata'>;

const USER_DENYLIST_METADATA_KEYS = ['userIds', 'denylistedUserIds', 'users'];

@Injectable()
export class RuntimeControlFlagRepository implements RuntimeControlFlagPort {
  constructor(
    private readonly featureFlagRepository: FeatureFlagRepository,
    private readonly db: DatabaseService,
  ) {}

  async isEnabled(key: RuntimeControlFlagKey, context: FeatureFlagContext): Promise<boolean> {
    if (key === RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_DISABLED) {
      const rows = await this.findScopedFlags(key, context);
      return runtimeControlRowsEnableKillSwitch(rows, context.tenantId);
    }

    return this.featureFlagRepository.isEnabled(key, context);
  }

  async isUserDenylisted(context: FeatureFlagContext): Promise<boolean> {
    const rows = await this.findScopedFlags(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_USER_DENYLIST, context);
    return runtimeControlRowsDenylistUser(rows, context.userId);
  }

  private async findScopedFlags(
    key: RuntimeControlFlagKey,
    context: FeatureFlagContext,
  ): Promise<FeatureFlagRow[]> {
    return this.db.client
      .select()
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.key, key),
          or(eq(featureFlags.tenantId, context.tenantId), isNull(featureFlags.tenantId)),
        ),
      );
  }
}

export function runtimeControlRowsEnableKillSwitch(rows: RuntimeControlFlagState[], tenantId: string): boolean {
  return rows.some((row) => row.enabled && (row.tenantId === null || row.tenantId === tenantId));
}

export function runtimeControlRowsDenylistUser(rows: RuntimeControlDenylistState[], userId?: string): boolean {
  return rows.some((row) => row.enabled && runtimeControlMetadataDeniesUser(row.metadata, userId));
}

export function runtimeControlMetadataDeniesUser(metadata: unknown, userId?: string): boolean {
  const record = isRecord(metadata) ? metadata : {};
  const presentKeys = USER_DENYLIST_METADATA_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(record, key));

  if (presentKeys.length === 0) {
    return true;
  }

  if (!userId) {
    return true;
  }

  return presentKeys.some((key) => {
    const value = record[key];

    if (!Array.isArray(value)) {
      return true;
    }

    if (!value.every((item) => typeof item === 'string')) {
      return true;
    }

    return value.includes(userId);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
