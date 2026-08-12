import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  OnModuleDestroy,
  OnModuleInit,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { Job, Queue } from 'bullmq';
import { channelAccounts, users } from '@entalent/database';
import {
  QUEUE_NAMES,
  type AdminProfileHydrationFailedJob,
  type AdminProfileHydrationMissingDisplayName,
  type AdminProfileHydrationStatus,
  type AdminProfileHydrationStatusResponse,
} from '@entalent/contracts';
import type { Env } from '@entalent/config';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

export interface ChannelAccountHydrationRow {
  userId: string;
  preferredName: string | null;
  channelType: string;
  externalWorkspaceId: string;
  externalUserId: string;
  channelDisplayName: string | null;
  profileMetadata: unknown;
}

@Controller('admin/profile-hydration/status')
@UseGuards(ApiKeyGuard)
export class ProfileHydrationStatusController implements OnModuleInit, OnModuleDestroy {
  private profileHydrationQueue: Queue | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const redisUrl = new URL(this.config.get('REDIS_URL', { infer: true }));
    const connection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port) || 6379,
      ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    };
    this.profileHydrationQueue = new Queue(QUEUE_NAMES.PROFILE_HYDRATION, { connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.profileHydrationQueue?.close();
  }

  @Get()
  async getStatus(
    @Query('tenantId') tenantId: string,
  ): Promise<AdminProfileHydrationStatusResponse> {
    const normalizedTenantId = tenantId?.trim();
    if (!normalizedTenantId) {
      throw new BadRequestException('tenantId is required');
    }

    const [rows, failedJobs] = await Promise.all([
      this.db.client
        .select({
          userId: users.id,
          preferredName: users.preferredName,
          channelType: channelAccounts.channelType,
          externalWorkspaceId: channelAccounts.externalWorkspaceId,
          externalUserId: channelAccounts.externalUserId,
          channelDisplayName: channelAccounts.displayName,
          profileMetadata: channelAccounts.profileMetadata,
        })
        .from(channelAccounts)
        .innerJoin(
          users,
          and(eq(channelAccounts.userId, users.id), eq(channelAccounts.tenantId, users.tenantId)),
        )
        .where(
          and(
            eq(channelAccounts.tenantId, normalizedTenantId),
            eq(channelAccounts.channelType, 'slack'),
            eq(users.status, 'active'),
          ),
        ),
      this.getFailedProfileHydrationJobs(normalizedTenantId),
    ]);

    return buildProfileHydrationStatusResponse(normalizedTenantId, rows, failedJobs);
  }

  private async getFailedProfileHydrationJobs(
    tenantId: string,
  ): Promise<AdminProfileHydrationFailedJob[]> {
    const jobs = await this.profileHydrationQueue?.getFailed(0, 200).catch(() => []);
    return (jobs ?? [])
      .map(toFailedJob)
      .filter((job) => job.data.tenantId === tenantId)
      .slice(0, 20);
  }
}

export function buildProfileHydrationStatusResponse(
  tenantId: string,
  rows: ChannelAccountHydrationRow[],
  failedJobs: AdminProfileHydrationFailedJob[],
): AdminProfileHydrationStatusResponse {
  const missingDisplayNames = rows
    .filter((row) => !hasText(row.preferredName) && !hasText(row.channelDisplayName))
    .map(toMissingDisplayName);

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    summary: {
      channelAccounts: rows.length,
      missingDisplayNames: missingDisplayNames.length,
      neverAttempted: missingDisplayNames.filter((row) => row.status === 'unknown').length,
      missingProfile: missingDisplayNames.filter((row) => row.status === 'missing_profile').length,
      failed: missingDisplayNames.filter((row) => row.status === 'failed').length,
      failedJobs: failedJobs.length,
    },
    missingDisplayNames,
    failedJobs,
  };
}

function toMissingDisplayName(
  row: ChannelAccountHydrationRow,
): AdminProfileHydrationMissingDisplayName {
  const hydration = readProfileHydration(row.profileMetadata);
  return {
    userId: row.userId,
    channelType: row.channelType,
    externalWorkspaceId: row.externalWorkspaceId,
    externalUserId: row.externalUserId,
    preferredName: row.preferredName,
    channelDisplayName: row.channelDisplayName,
    status: hydration.status,
    attemptCount: hydration.attemptCount,
    lastAttemptAt: hydration.lastAttemptAt,
    lastSuccessAt: hydration.lastSuccessAt,
    lastError: hydration.lastError,
    reason: hydration.reason,
  };
}

function readProfileHydration(metadata: unknown): {
  status: AdminProfileHydrationStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  reason: string | null;
} {
  const root = asRecord(metadata);
  const hydration = asRecord(root['profileHydration']);
  return {
    status: readStatus(hydration['status']),
    attemptCount: readNumber(hydration['attemptCount']),
    lastAttemptAt: readString(hydration['lastAttemptAt']),
    lastSuccessAt: readString(hydration['lastSuccessAt']),
    lastError: readString(hydration['lastError']),
    reason: readString(hydration['reason']),
  };
}

function toFailedJob(job: Job): AdminProfileHydrationFailedJob {
  const data = asRecord(job.data);
  const failedJob: AdminProfileHydrationFailedJob = {
    id: job.id ?? null,
    name: job.name,
    failedReason: sanitizeOperationalMessage(job.failedReason),
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    finishedOn: job.finishedOn ?? null,
    data: {},
  };

  for (const field of ['userId', 'tenantId', 'channelType', 'traceId'] as const) {
    const value = readString(data[field]);
    if (value) failedJob.data[field] = value;
  }

  return failedJob;
}

function readStatus(value: unknown): AdminProfileHydrationStatus {
  if (value === 'success' || value === 'missing_profile' || value === 'failed') return value;
  return 'unknown';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

function sanitizeOperationalMessage(message: string | undefined): string | null {
  if (!message) return null;
  return message
    .split('\n')[0]
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[redacted-slack-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 200);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
