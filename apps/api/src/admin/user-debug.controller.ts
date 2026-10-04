import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  users,
  messages,
  memoryItems,
  userGoals,
  scheduledActions,
  riskSignals,
  surveyWindows,
  surveyAssessments,
  surveyQuestions,
} from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { DatabaseService } from '../database/database.service';

const PLACEHOLDER_TENANT = process.env['DEFAULT_TENANT_ID'] ?? '';

@Controller('admin/users/:userId/debug')
@UseGuards(ApiKeyGuard)
export class UserDebugController {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  @Get()
  async getDebugView(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('tenantId') tenantId: string = PLACEHOLDER_TENANT,
  ): Promise<Record<string, unknown>> {
    // Log every access — sensitive admin view
    await this.auditLog.append({
      tenantId,
      actorType: 'admin',
      actorId: 'admin',
      action: 'admin.user_debug_viewed',
      resourceType: 'user',
      resourceId: userId,
      reason: 'Admin debug view accessed',
    });

    const [
      userRows,
      recentMessages,
      memory,
      goals,
      actions,
      risks,
      surveyRows,
    ] = await Promise.all([
      this.db.client
        .select()
        .from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .limit(1),

      // Messages: return metadata + truncated text (first 120 chars)
      this.db.client
        .select({
          id: messages.id,
          direction: messages.direction,
          messageType: messages.messageType,
          occurredAt: messages.occurredAt,
          textPreview: messages.text,
        })
        .from(messages)
        .where(
          and(
            eq(messages.userId, userId),
            eq(messages.tenantId, tenantId),
            isNull(messages.deletedAt),
          ),
        )
        .orderBy(desc(messages.occurredAt))
        .limit(50),

      this.db.client
        .select()
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.userId, userId),
            eq(memoryItems.tenantId, tenantId),
            eq(memoryItems.status, 'active'),
          ),
        )
        .orderBy(desc(memoryItems.createdAt))
        .limit(50),

      this.db.client
        .select()
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.tenantId, tenantId))),

      this.db.client
        .select()
        .from(scheduledActions)
        .where(
          and(
            eq(scheduledActions.userId, userId),
            eq(scheduledActions.tenantId, tenantId),
          ),
        )
        .orderBy(desc(scheduledActions.createdAt))
        .limit(20),

      this.db.client
        .select()
        .from(riskSignals)
        .where(and(eq(riskSignals.userId, userId), eq(riskSignals.tenantId, tenantId)))
        .orderBy(desc(riskSignals.detectedAt)),

      // Survey: latest window assessments with question labels
      this.db.client
        .select({
          windowId: surveyWindows.id,
          periodStart: surveyWindows.periodStart,
          periodEnd: surveyWindows.periodEnd,
          windowStatus: surveyWindows.status,
          questionStableKey: surveyQuestions.stableKey,
          questionTitle: surveyQuestions.title,
          assessmentStatus: surveyAssessments.status,
          score: surveyAssessments.score,
          confidence: surveyAssessments.confidence,
          calculatedAt: surveyAssessments.calculatedAt,
        })
        .from(surveyAssessments)
        .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
        .innerJoin(surveyQuestions, eq(surveyAssessments.surveyQuestionId, surveyQuestions.id))
        .where(
          and(
            eq(surveyWindows.userId, userId),
            eq(surveyWindows.tenantId, tenantId),
          ),
        )
        .orderBy(desc(surveyWindows.periodStart)),
    ]);

    const user = userRows[0];
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // Truncate message text for the debug view — show only a preview
    const messagesWithPreview = recentMessages.map((m) => ({
      ...m,
      textPreview: m.textPreview
        ? m.textPreview.substring(0, 120) + (m.textPreview.length > 120 ? '…' : '')
        : null,
    }));

    // Risk: only expose non-sensitive fields
    const safeRisks = risks.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      status: r.status,
      detectedAt: r.detectedAt,
      resolvedAt: r.resolvedAt,
      expiresAt: r.expiresAt,
    }));

    return {
      user: {
        id: user.id,
        preferredName: user.preferredName,
        status: user.status,
        timezone: user.timezone,
        proactiveMessagingEnabled: user.proactiveMessagingEnabled,
        onboardingStatus: user.onboardingStatus,
        consentState: user.consentState,
        createdAt: user.createdAt,
      },
      recentMessages: messagesWithPreview,
      memory,
      goals,
      scheduledActions: actions,
      riskStatus: {
        hasActiveRisk: risks.some((r) => r.status === 'active'),
        signals: safeRisks,
      },
      surveyAssessments: surveyRows,
      accessedAt: new Date().toISOString(),
    };
  }
}
