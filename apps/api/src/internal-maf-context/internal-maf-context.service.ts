import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  channelAccounts,
  conversations,
  memoryItems,
  messages,
  riskSignals,
  surveyWindows,
  userGoals,
  users,
  userStyleProfiles,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export interface InternalMafContextReadRequest {
  tenantId: string;
  workspaceId: string;
  userId: string;
  conversationId: string;
  threadId?: string;
  sessionKey?: string;
  recentTurnLimit: number;
  memoryLimit: number;
  goalLimit: number;
  riskLimit: number;
  traceId?: string;
}

export interface InternalMafContextResponse {
  userProfile: Record<string, unknown> | null;
  memoryItems: Record<string, unknown>[];
  goals: Record<string, unknown>[];
  recentTurns: Record<string, unknown>[];
  surveyState: Record<string, unknown> | null;
  riskSignals: Record<string, unknown>[];
  diagnostics: {
    traceId?: string;
    counts: {
      memoryItems: number;
      goals: number;
      recentTurns: number;
      riskSignals: number;
      surveyWindows: number;
    };
  };
}

const MESSAGE_PREVIEW_LIMIT = 160;
const EMPTY_COUNTS = {
  memoryItems: 0,
  goals: 0,
  recentTurns: 0,
  riskSignals: 0,
  surveyWindows: 0,
};

@Injectable()
export class InternalMafContextService {
  constructor(private readonly db: DatabaseService) {}

  async readContext(request: InternalMafContextReadRequest): Promise<InternalMafContextResponse> {
    const [userRows, conversationRows, workspaceAccountRows] = await Promise.all([
      this.db.client
        .select({
          id: users.id,
          preferredName: users.preferredName,
          timezone: users.timezone,
          locale: users.locale,
          proactiveMessagingEnabled: users.proactiveMessagingEnabled,
          onboardingStatus: users.onboardingStatus,
          consentState: users.consentState,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(
          and(
            eq(users.id, request.userId),
            eq(users.tenantId, request.tenantId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1),
      this.db.client
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, request.conversationId),
            eq(conversations.userId, request.userId),
            eq(conversations.tenantId, request.tenantId),
            eq(conversations.status, 'active'),
          ),
        )
        .limit(1),
      this.db.client
        .select({ id: channelAccounts.id })
        .from(channelAccounts)
        .where(
          and(
            eq(channelAccounts.userId, request.userId),
            eq(channelAccounts.tenantId, request.tenantId),
            eq(channelAccounts.externalWorkspaceId, request.workspaceId),
          ),
        )
        .limit(1),
    ]);

    if (!userRows[0] || !conversationRows[0] || !workspaceAccountRows[0]) {
      return emptyContextResponse(request.traceId);
    }

    const [styleProfileRows, memoryRows, goalRows, riskRows, surveyWindowRows, recentTurnRows] =
      await Promise.all([
      this.db.client
        .select({
          id: userStyleProfiles.id,
          dimensions: userStyleProfiles.dimensions,
          phrases: userStyleProfiles.phrases,
          adaptationWeight: userStyleProfiles.adaptationWeight,
          conversationsAnalyzed: userStyleProfiles.conversationsAnalyzed,
          updatedAt: userStyleProfiles.updatedAt,
        })
        .from(userStyleProfiles)
        .where(
          and(
            eq(userStyleProfiles.userId, request.userId),
            eq(userStyleProfiles.tenantId, request.tenantId),
          ),
        )
        .limit(1),
      this.db.client
        .select({
          id: memoryItems.id,
          category: memoryItems.category,
          canonicalKey: memoryItems.canonicalKey,
          content: memoryItems.content,
          confidence: memoryItems.confidence,
          importance: memoryItems.importance,
          sensitivity: memoryItems.sensitivity,
          validFrom: memoryItems.validFrom,
          updatedAt: memoryItems.updatedAt,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.userId, request.userId),
            eq(memoryItems.tenantId, request.tenantId),
            eq(memoryItems.status, 'active'),
            isNull(memoryItems.supersededById),
          ),
        )
        .orderBy(desc(memoryItems.importance))
        .limit(request.memoryLimit),
      this.db.client
        .select({
          id: userGoals.id,
          title: userGoals.title,
          description: userGoals.description,
          category: userGoals.category,
          priority: userGoals.priority,
          targetDate: userGoals.targetDate,
          confidence: userGoals.confidence,
          nextCheckInAt: userGoals.nextCheckInAt,
          updatedAt: userGoals.updatedAt,
        })
        .from(userGoals)
        .where(
          and(
            eq(userGoals.userId, request.userId),
            eq(userGoals.tenantId, request.tenantId),
            eq(userGoals.status, 'active'),
          ),
        )
        .orderBy(desc(userGoals.updatedAt))
        .limit(request.goalLimit),
      this.db.client
        .select({
          id: riskSignals.id,
          type: riskSignals.type,
          severity: riskSignals.severity,
          confidence: riskSignals.confidence,
          recommendedAction: riskSignals.recommendedAction,
          detectedAt: riskSignals.detectedAt,
          expiresAt: riskSignals.expiresAt,
        })
        .from(riskSignals)
        .where(
          and(
            eq(riskSignals.userId, request.userId),
            eq(riskSignals.tenantId, request.tenantId),
            eq(riskSignals.status, 'active'),
          ),
        )
        .orderBy(desc(riskSignals.detectedAt))
        .limit(request.riskLimit),
      this.db.client
        .select({
          id: surveyWindows.id,
          status: surveyWindows.status,
          periodType: surveyWindows.periodType,
          periodStart: surveyWindows.periodStart,
          periodEnd: surveyWindows.periodEnd,
          coverage: surveyWindows.coverage,
          completedAt: surveyWindows.completedAt,
        })
        .from(surveyWindows)
        .where(
          and(
            eq(surveyWindows.userId, request.userId),
            eq(surveyWindows.tenantId, request.tenantId),
            eq(surveyWindows.status, 'active'),
          ),
        )
        .orderBy(desc(surveyWindows.periodStart))
        .limit(1),
      this.db.client
        .select({
          id: messages.id,
          direction: messages.direction,
          senderType: messages.senderType,
          messageType: messages.messageType,
          occurredAt: messages.occurredAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.userId, request.userId),
            eq(messages.tenantId, request.tenantId),
            eq(messages.conversationId, request.conversationId),
            threadFilter(messages, request.threadId),
            isNull(messages.deletedAt),
          ),
        )
        .orderBy(desc(messages.occurredAt))
        .limit(request.recentTurnLimit),
    ]);

    return {
      userProfile: formatUserProfile(userRows[0], styleProfileRows[0]),
      memoryItems: memoryRows.map(formatMemoryItem),
      goals: goalRows.map(formatGoal),
      recentTurns: recentTurnRows.map(formatRecentTurn),
      surveyState: formatSurveyWindow(surveyWindowRows[0]),
      riskSignals: riskRows.map(formatRiskSignal),
      diagnostics: {
        ...(request.traceId ? { traceId: request.traceId } : {}),
        counts: {
          memoryItems: memoryRows.length,
          goals: goalRows.length,
          recentTurns: recentTurnRows.length,
          riskSignals: riskRows.length,
          surveyWindows: surveyWindowRows.length,
        },
      },
    };
  }
}

function formatUserProfile(
  user: Record<string, unknown> | undefined,
  styleProfile: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!user) {
    return null;
  }

  return {
    id: user['id'],
    preferredName: user['preferredName'],
    timezone: user['timezone'],
    locale: user['locale'],
    proactiveMessagingEnabled: user['proactiveMessagingEnabled'],
    onboardingStatus: user['onboardingStatus'],
    consentState: user['consentState'],
    createdAt: isoOrNull(user['createdAt']),
    updatedAt: isoOrNull(user['updatedAt']),
    styleProfile: styleProfile
      ? {
          id: styleProfile['id'],
          dimensions: styleProfile['dimensions'],
          phrases: styleProfile['phrases'],
          adaptationWeight: numberOrNull(styleProfile['adaptationWeight']),
          conversationsAnalyzed: styleProfile['conversationsAnalyzed'],
          updatedAt: isoOrNull(styleProfile['updatedAt']),
        }
      : null,
  };
}

function formatMemoryItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row['id'],
    category: row['category'],
    canonicalKey: row['canonicalKey'],
    content: safeMemoryContent(row['content'], row['sensitivity']),
    confidence: numberOrNull(row['confidence']),
    importance: numberOrNull(row['importance']),
    sensitivity: row['sensitivity'],
    validFrom: isoOrNull(row['validFrom']),
    updatedAt: isoOrNull(row['updatedAt']),
  };
}

function formatGoal(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row['id'],
    title: row['title'],
    description: row['description'],
    category: row['category'],
    priority: row['priority'],
    targetDate: isoOrNull(row['targetDate']),
    confidence: numberOrNull(row['confidence']),
    nextCheckInAt: isoOrNull(row['nextCheckInAt']),
    updatedAt: isoOrNull(row['updatedAt']),
  };
}

function formatRiskSignal(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row['id'],
    type: row['type'],
    severity: row['severity'],
    confidence: numberOrNull(row['confidence']),
    recommendedAction: row['recommendedAction'],
    detectedAt: isoOrNull(row['detectedAt']),
    expiresAt: isoOrNull(row['expiresAt']),
  };
}

function formatSurveyWindow(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  return {
    id: row['id'],
    status: row['status'],
    periodType: row['periodType'],
    periodStart: isoOrNull(row['periodStart']),
    periodEnd: isoOrNull(row['periodEnd']),
    coverage: row['coverage'],
    completedAt: isoOrNull(row['completedAt']),
  };
}

function formatRecentTurn(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row['id'],
    direction: row['direction'],
    senderType: row['senderType'],
    messageType: row['messageType'],
    occurredAt: isoOrNull(row['occurredAt']),
  };
}

function emptyContextResponse(traceId: string | undefined): InternalMafContextResponse {
  return {
    userProfile: null,
    memoryItems: [],
    goals: [],
    recentTurns: [],
    surveyState: null,
    riskSignals: [],
    diagnostics: {
      ...(traceId ? { traceId } : {}),
      counts: EMPTY_COUNTS,
    },
  };
}

function isoOrNull(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeMemoryContent(value: unknown, sensitivity: unknown): string | null {
  if (sensitivity !== 'normal' || typeof value !== 'string') {
    return null;
  }
  if (containsSensitiveToken(value)) {
    return null;
  }
  if (value.length <= MESSAGE_PREVIEW_LIMIT) {
    return value;
  }
  return `${value.slice(0, MESSAGE_PREVIEW_LIMIT - 3)}...`;
}

function threadFilter(
  messageTable: typeof messages,
  threadId: string | undefined,
): ReturnType<typeof eq> | ReturnType<typeof isNull> {
  if (threadId) {
    return eq(messageTable.externalThreadId, threadId);
  }

  return isNull(messageTable.externalThreadId);
}

function containsSensitiveToken(value: string): boolean {
  return /\bBearer\s+[A-Za-z0-9._~+/-]+/i.test(value) || /\b(secret|token|password)\b/i.test(value);
}
