import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
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
type RuntimeControlCanaryState = Pick<
  FeatureFlagRow,
  'tenantId' | 'enabled' | 'metadata' | 'rolloutPercentage'
>;

const USER_DENYLIST_METADATA_KEYS = ['userIds', 'denylistedUserIds', 'users'];
const CANARY_USER_METADATA_KEYS = ['internalUserIds', 'canaryUserIds', 'userIds'];
const CANARY_WORKSPACE_METADATA_KEYS = [
  'externalWorkspaceIds',
  'workspaceIds',
  'canaryWorkspaceIds',
];

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

    if (key === RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY) {
      const rows = await this.findScopedFlags(key, context);
      return runtimeControlRowsEnableCanary(rows, context);
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

export function runtimeControlRowsEnableCanary(
  rows: RuntimeControlCanaryState[],
  context: FeatureFlagContext,
): boolean {
  const row = runtimeControlSelectScopedRow(rows, context.tenantId);
  if (!row?.enabled) {
    return false;
  }

  if (!isRecord(row.metadata)) {
    return false;
  }

  const metadata = row.metadata;
  const userList = readStringAllowlist(metadata, CANARY_USER_METADATA_KEYS);
  const workspaceList = readStringAllowlist(metadata, CANARY_WORKSPACE_METADATA_KEYS);

  if (!userList.valid || !workspaceList.valid) {
    return false;
  }

  const hasAllowlist = userList.present || workspaceList.present;
  if (hasAllowlist) {
    return (
      (context.userId !== undefined && userList.values.includes(context.userId)) ||
      (context.externalWorkspaceId !== undefined &&
        workspaceList.values.includes(context.externalWorkspaceId))
    );
  }

  return runtimeControlPercentageIncludesUser(row.rolloutPercentage, context.userId);
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

function runtimeControlSelectScopedRow<T extends { tenantId: string | null }>(
  rows: T[],
  tenantId: string,
): T | undefined {
  const tenantRows = rows.filter((row) => row.tenantId === tenantId);
  if (tenantRows.length > 1) {
    return undefined;
  }
  if (tenantRows.length === 1) {
    return tenantRows[0];
  }

  const globalRows = rows.filter((row) => row.tenantId === null);
  return globalRows.length === 1 ? globalRows[0] : undefined;
}

function readStringAllowlist(
  metadata: Record<string, unknown>,
  keys: readonly string[],
): { present: boolean; valid: boolean; values: string[] } {
  const presentKeys = keys.filter((key) => Object.prototype.hasOwnProperty.call(metadata, key));
  if (presentKeys.length === 0) {
    return { present: false, valid: true, values: [] };
  }

  const values: string[] = [];
  for (const key of presentKeys) {
    const value = metadata[key];
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string' && item.trim().length > 0)
    ) {
      return { present: true, valid: false, values: [] };
    }
    values.push(...value);
  }

  return { present: true, valid: true, values };
}

function runtimeControlPercentageIncludesUser(rolloutPercentage: number, userId?: string): boolean {
  if (!Number.isFinite(rolloutPercentage) || rolloutPercentage <= 0) {
    return false;
  }
  if (!userId) {
    return false;
  }
  if (rolloutPercentage >= 100) {
    return true;
  }

  return runtimeControlUserBucket(userId) < rolloutPercentage;
}

function runtimeControlUserBucket(userId: string): number {
  const hash = createHash('md5').update(userId).digest('hex').slice(0, 8);
  return parseInt(hash, 16) % 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
