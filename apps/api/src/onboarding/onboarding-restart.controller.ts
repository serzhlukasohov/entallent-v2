import { Controller, HttpCode, Logger, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Env } from '@entalent/config';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { assertInternalDashboardEnabled } from '../admin/internal-dashboard-gate';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingRestartService } from './onboarding-restart.service';

export interface AdminOnboardingRestartResult {
  stateDeleted: boolean;
  deliveryRequeued: boolean;
  introQueued: boolean;
}

/**
 * Production counterpart of the dev reset's onboarding step: restarts one person's onboarding v2 and re-sends the
 * intro. Conversation history and pulse data are left untouched.
 */
@Controller('admin/users/:userId/onboarding/restart')
@UseGuards(ApiKeyGuard)
export class OnboardingRestartController {
  private readonly logger = new Logger(OnboardingRestartController.name);

  constructor(
    private readonly onboardingRestart: OnboardingRestartService,
    private readonly auditLog: AuditLogRepository,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(QUEUE_NAMES.PROACTIVE_SCAN) private readonly scanQueue: Queue<{ tenantId?: string; unitId?: string }>,
  ) {}

  @Post()
  @HttpCode(200)
  async restart(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<AdminOnboardingRestartResult> {
    assertInternalDashboardEnabled(this.config);
    await this.auditLog.append({
      tenantId,
      actorType: 'admin',
      actorId: 'admin',
      action: 'admin.onboarding_restart_requested',
      resourceType: 'user',
      resourceId: userId,
      reason: 'Admin restarted onboarding from dashboard',
    });

    const restart = await this.onboardingRestart.restart({ tenantId, personId: userId });
    if (restart.unitId) {
      await this.scanQueue.add('onboarding-only', { tenantId, unitId: restart.unitId }, {
        jobId: `admin-onboarding-restart-${userId}-${Date.now()}`, attempts: 1,
      });
    }
    const result = {
      stateDeleted: restart.stateDeleted,
      deliveryRequeued: restart.deliveryRequeued,
      introQueued: Boolean(restart.unitId),
    };

    await this.auditLog.append({
      tenantId,
      actorType: 'admin',
      actorId: 'admin',
      action: 'admin.onboarding_restart_completed',
      resourceType: 'user',
      resourceId: userId,
      reason: 'Admin restarted onboarding from dashboard',
      metadata: { ...result },
    });
    this.logger.log(`Admin: onboarding restart user=${userId} introQueued=${result.introQueued}`);
    return result;
  }
}
