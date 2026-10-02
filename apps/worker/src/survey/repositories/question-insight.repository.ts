import { Injectable } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';
import {
  messages,
  pulseBacklog,
  surveyAssessments,
  surveyEvidence,
  surveyGroupStates,
  surveyDefinitions,
  surveyQuestions,
  surveyQuestionConfirmationBundles,
  surveyQuestionInsights,
  surveyQuestionVerdictReceipts,
  surveyQuestionWorkingInsights,
  surveyScoringPolicies,
  surveyWindowScoringPolicies,
  surveyWindows,
} from '@entalent/database';
import type {
  ApprovedQuestionRubric,
  FinalQuestionInsight,
  QuestionFinalizationContext,
  QuestionFinalizationRepositoryPort,
  QuestionInsightInputRecord,
  PriorQuestionScoreRecord,
  QuestionInsightInputRepositoryPort,
  QuestionWorkingCapturePort,
  CaptureQuestionMeaningInput,
  QuestionConfirmationPort,
  ReadyQuestionBundle,
  AwaitingQuestionBundle,
  QuestionBundleVerdict,
  PendingQuestionClarification,
  QuestionClarificationVerdict,
  AppliedQuestionVerdict,
} from '@entalent/application';
import {
  hasCompleteV2ScoringPolicy,
  hasLegacyV2ScoringPolicy,
  isApprovedQuestionRubric,
  validateQuestionBundleVerdict,
  validateQuestionClarificationPrompt,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
import { TeamRepository } from './team.repository';

@Injectable()
export class QuestionInsightRepository implements QuestionFinalizationRepositoryPort, QuestionInsightInputRepositoryPort, QuestionWorkingCapturePort, QuestionConfirmationPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly teamRepository: TeamRepository,
  ) {}

  async findAppliedQuestionVerdictForInbound(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<AppliedQuestionVerdict | null> {
    const [row] = await this.db.client.select().from(surveyQuestionVerdictReceipts).where(and(
      eq(surveyQuestionVerdictReceipts.inboundMessageId, input.inboundMessageId),
      eq(surveyQuestionVerdictReceipts.tenantId, input.tenantId),
      eq(surveyQuestionVerdictReceipts.userId, input.userId),
      eq(surveyQuestionVerdictReceipts.conversationId, input.conversationId),
    )).limit(1);
    if (!row) return null;
    if (row.bundleId && (row.verdictKind === 'agree' || row.verdictKind === 'partial'
      || row.verdictKind === 'reject')) {
      return { kind: 'bundle', verdictKind: row.verdictKind, questionGroup: row.questionGroup };
    }
    if (row.workingInsightId && (row.verdictKind === 'clarified'
      || row.verdictKind === 'declined')) {
      return { kind: 'clarification', verdictKind: row.verdictKind, questionGroup: row.questionGroup };
    }
    throw new Error('v2_verdict_receipt_invalid');
  }

  async findPendingQuestionClarification(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<PendingQuestionClarification | null> {
    const [inbound] = await this.db.client.select({ occurredAt: messages.occurredAt })
      .from(messages).where(and(
        eq(messages.id, input.inboundMessageId),
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'inbound'),
        isNull(messages.deletedAt),
      )).limit(1);
    if (!inbound) return null;
    const [row] = await this.db.client.select({
      workingInsightId: surveyQuestionWorkingInsights.id,
      surveyWindowId: surveyQuestionWorkingInsights.surveyWindowId,
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
      workingSummary: surveyQuestionWorkingInsights.workingSummary,
      clarificationPromptMessageId: surveyQuestionWorkingInsights.clarificationPromptMessageId,
      questionGroup: surveyQuestionConfirmationBundles.questionGroup,
      components: surveyQuestionConfirmationBundles.components,
    }).from(surveyQuestionWorkingInsights)
      .innerJoin(surveyQuestionConfirmationBundles,
        eq(surveyQuestionConfirmationBundles.id, surveyQuestionWorkingInsights.confirmationBundleId))
      .innerJoin(messages, eq(messages.id, surveyQuestionConfirmationBundles.promptMessageId))
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyQuestionWorkingInsights.surveyWindowId))
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyQuestionWorkingInsights.surveyQuestionId))
      .where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.status, 'pending_clarification'),
        isNull(surveyQuestionWorkingInsights.purgedAt),
        eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
        eq(surveyQuestionConfirmationBundles.userId, input.userId),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindows.status, 'active'),
        gt(surveyWindows.periodEnd, inbound.occurredAt),
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'outbound'),
        isNotNull(messages.sentAt),
        isNull(messages.deletedAt),
      )).orderBy(surveyQuestions.displayOrder).limit(1);
    if (!row || !row.workingSummary?.trim()) return null;
    const component = parseBundleComponents(row.components, 'clarification')
      .find((item) => item.surveyQuestionId === row.surveyQuestionId);
    if (!component) throw new Error('v2_clarification_mapping_missing');

    let clarificationPromptSentAt: Date | null = null;
    if (row.clarificationPromptMessageId) {
      const [prompt] = await this.db.client.select({ sentAt: messages.sentAt })
        .from(messages).where(and(
          eq(messages.id, row.clarificationPromptMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      if (!prompt) throw new Error('v2_clarification_prompt_scope_mismatch');
      clarificationPromptSentAt = prompt.sentAt;
    }
    return {
      workingInsightId: row.workingInsightId,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: row.surveyWindowId,
      surveyQuestionId: row.surveyQuestionId,
      questionGroup: row.questionGroup,
      workingSummary: row.workingSummary,
      disputedStatement: component.statement,
      clarificationPromptMessageId: row.clarificationPromptMessageId,
      clarificationPromptSentAt,
    };
  }

  async previewPendingQuestionClarificationAfterBundleVerdict(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
    bundleId: string; disputedQuestionIds: string[];
  }): Promise<PendingQuestionClarification | null> {
    if (input.disputedQuestionIds.length === 0) return null;
    const awaiting = await this.findAwaitingQuestionBundle(input);
    if (!awaiting || awaiting.id !== input.bundleId) {
      throw new Error('v2_clarification_preview_bundle_stale');
    }
    const disputed = new Set(input.disputedQuestionIds);
    if (disputed.size !== input.disputedQuestionIds.length
      || input.disputedQuestionIds.some((id) => !awaiting.components.some(
        (component) => component.surveyQuestionId === id))) {
      throw new Error('v2_clarification_preview_mapping_invalid');
    }
    const rows = await this.db.client.select({
      id: surveyQuestionWorkingInsights.id,
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
      workingSummary: surveyQuestionWorkingInsights.workingSummary,
    }).from(surveyQuestionWorkingInsights)
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyQuestionWorkingInsights.surveyQuestionId))
      .where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, awaiting.surveyWindowId),
        eq(surveyQuestionWorkingInsights.confirmationBundleId, awaiting.id),
        eq(surveyQuestionWorkingInsights.status, 'pending_confirmation'),
        isNull(surveyQuestionWorkingInsights.purgedAt),
        inArray(surveyQuestionWorkingInsights.surveyQuestionId, input.disputedQuestionIds),
      )).orderBy(surveyQuestions.displayOrder);
    if (rows.length !== disputed.size || rows.some((row) => !row.workingSummary?.trim())) {
      throw new Error('v2_clarification_preview_working_stale');
    }
    const first = rows[0]!;
    const component = awaiting.components.find((item) =>
      item.surveyQuestionId === first.surveyQuestionId);
    if (!component) throw new Error('v2_clarification_preview_mapping_invalid');
    return {
      workingInsightId: first.id,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: awaiting.surveyWindowId,
      surveyQuestionId: first.surveyQuestionId,
      questionGroup: awaiting.questionGroup,
      workingSummary: first.workingSummary!,
      disputedStatement: component.statement,
      clarificationPromptMessageId: null,
      clarificationPromptSentAt: null,
    };
  }

  async previewPendingQuestionClarificationAfterVerdict(input: {
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string;
  }): Promise<PendingQuestionClarification | null> {
    const [current] = await this.db.client.select({
      bundleId: surveyQuestionWorkingInsights.confirmationBundleId,
      surveyWindowId: surveyQuestionWorkingInsights.surveyWindowId,
      questionGroup: surveyQuestionConfirmationBundles.questionGroup,
      components: surveyQuestionConfirmationBundles.components,
    }).from(surveyQuestionWorkingInsights)
      .innerJoin(surveyQuestionConfirmationBundles,
        eq(surveyQuestionConfirmationBundles.id, surveyQuestionWorkingInsights.confirmationBundleId))
      .innerJoin(messages, eq(messages.id, surveyQuestionConfirmationBundles.promptMessageId))
      .where(and(
        eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.status, 'pending_clarification'),
        isNull(surveyQuestionWorkingInsights.purgedAt),
        eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
        eq(surveyQuestionConfirmationBundles.userId, input.userId),
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'outbound'),
        isNull(messages.deletedAt),
      )).limit(1);
    if (!current?.bundleId) throw new Error('v2_clarification_preview_scope_mismatch');
    const [next] = await this.db.client.select({
      id: surveyQuestionWorkingInsights.id,
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
      workingSummary: surveyQuestionWorkingInsights.workingSummary,
      clarificationPromptMessageId: surveyQuestionWorkingInsights.clarificationPromptMessageId,
    }).from(surveyQuestionWorkingInsights)
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyQuestionWorkingInsights.surveyQuestionId))
      .where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.confirmationBundleId, current.bundleId),
        ne(surveyQuestionWorkingInsights.id, input.workingInsightId),
        eq(surveyQuestionWorkingInsights.status, 'pending_clarification'),
        isNull(surveyQuestionWorkingInsights.purgedAt),
      )).orderBy(surveyQuestions.displayOrder).limit(1);
    if (!next) return null;
    if (!next.workingSummary?.trim() || next.clarificationPromptMessageId) {
      throw new Error('v2_clarification_preview_working_stale');
    }
    const component = parseBundleComponents(current.components, 'clarification')
      .find((item) => item.surveyQuestionId === next.surveyQuestionId);
    if (!component) throw new Error('v2_clarification_preview_mapping_invalid');
    return {
      workingInsightId: next.id,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: current.surveyWindowId,
      surveyQuestionId: next.surveyQuestionId,
      questionGroup: current.questionGroup,
      workingSummary: next.workingSummary,
      disputedStatement: component.statement,
      clarificationPromptMessageId: null,
      clarificationPromptSentAt: null,
    };
  }

  async stageQuestionClarificationPrompt(input: {
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string; promptMessageId: string; displayedText: string;
  }): Promise<boolean> {
    validateQuestionClarificationPrompt(input.displayedText);
    return this.db.client.transaction(async (tx) => {
      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
        )).for('update').limit(1);
      if (!working || working.status !== 'pending_clarification'
        || working.clarificationPromptMessageId || working.purgedAt) return false;
      const [bundle] = await tx.select({
        promptMessageId: surveyQuestionConfirmationBundles.promptMessageId,
        purgedAt: surveyQuestionConfirmationBundles.purgedAt,
      })
        .from(surveyQuestionConfirmationBundles).where(and(
          eq(surveyQuestionConfirmationBundles.id, working.confirmationBundleId!),
          eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, input.userId),
        )).limit(1);
      const [originalPrompt] = bundle?.promptMessageId && !bundle.purgedAt
        ? await tx.select({ conversationId: messages.conversationId }).from(messages).where(and(
          eq(messages.id, bundle.promptMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.direction, 'outbound'),
          isNotNull(messages.sentAt),
          isNull(messages.deletedAt),
        )).limit(1)
        : [];
      if (originalPrompt?.conversationId !== input.conversationId) {
        throw new Error('v2_clarification_bundle_scope_mismatch');
      }
      const [scope] = await tx.select({
        windowStatus: surveyWindows.status,
        periodEnd: surveyWindows.periodEnd,
        messageText: messages.text,
        messageSentAt: messages.sentAt,
      }).from(surveyWindows)
        .innerJoin(messages, eq(messages.id, input.promptMessageId))
        .where(and(
          eq(surveyWindows.id, working.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      if (!scope || scope.windowStatus !== 'active' || scope.periodEnd <= new Date()
        || scope.messageSentAt || scope.messageText !== input.displayedText) {
        throw new Error('v2_clarification_prompt_scope_mismatch');
      }
      await tx.update(surveyQuestionWorkingInsights).set({
        clarificationPromptMessageId: input.promptMessageId,
        updatedAt: new Date(),
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      return true;
    });
  }

  async applyQuestionClarificationVerdict(input: {
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string; inboundMessageId: string;
    verdict: Exclude<QuestionClarificationVerdict, { kind: 'unrelated' }>;
  }): Promise<boolean> {
    if (input.verdict.kind === 'clarified' && !input.verdict.correctedSummary.trim()) {
      throw new Error('v2_clarification_summary_empty');
    }
    return this.db.client.transaction(async (tx) => {
      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
        )).for('update').limit(1);
      if (!working || working.status !== 'pending_clarification'
        || !working.clarificationPromptMessageId || !working.confirmationBundleId) return false;
      const [bundle] = await tx.select({
        components: surveyQuestionConfirmationBundles.components,
        purgedAt: surveyQuestionConfirmationBundles.purgedAt,
        promptMessageId: surveyQuestionConfirmationBundles.promptMessageId,
        questionGroup: surveyQuestionConfirmationBundles.questionGroup,
      }).from(surveyQuestionConfirmationBundles).where(and(
        eq(surveyQuestionConfirmationBundles.id, working.confirmationBundleId),
        eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
        eq(surveyQuestionConfirmationBundles.userId, input.userId),
      )).for('update').limit(1);
      if (!bundle || bundle.purgedAt) throw new Error('v2_clarification_bundle_scope_mismatch');
      const [originalPrompt] = bundle.promptMessageId
        ? await tx.select({ id: messages.id }).from(messages).where(and(
          eq(messages.id, bundle.promptMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
          isNotNull(messages.sentAt),
          isNull(messages.deletedAt),
        )).limit(1)
        : [];
      if (!originalPrompt) throw new Error('v2_clarification_bundle_scope_mismatch');
      const bundleComponents = parseBundleComponents(bundle.components, 'clarification');
      if (!bundleComponents.some((component) => component.surveyQuestionId === working.surveyQuestionId)) {
        throw new Error('v2_clarification_bundle_components_stale');
      }
      const [prompt] = await tx.select({ sentAt: messages.sentAt })
        .from(messages).where(and(
          eq(messages.id, working.clarificationPromptMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      const [inbound] = await tx.select({ occurredAt: messages.occurredAt })
        .from(messages).where(and(
          eq(messages.id, input.inboundMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      const [window] = await tx.select({ periodEnd: surveyWindows.periodEnd, status: surveyWindows.status })
        .from(surveyWindows).where(and(
          eq(surveyWindows.id, working.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
        )).limit(1);
      if (!prompt?.sentAt || !inbound || !window || window.status !== 'active'
        || inbound.occurredAt <= prompt.sentAt || inbound.occurredAt >= window.periodEnd) {
        throw new Error('v2_clarification_reply_scope_mismatch');
      }
      if (input.verdict.kind === 'clarified') {
        await tx.update(surveyQuestionWorkingInsights).set({
          status: 'confirmed',
          confirmedSemanticSummary: input.verdict.correctedSummary.trim(),
          confirmationMessageId: input.inboundMessageId,
          confirmedAt: inbound.occurredAt,
          readyForConfirmation: false,
          updatedAt: inbound.occurredAt,
        }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      } else {
        await tx.update(surveyQuestionWorkingInsights).set({
          status: 'declined',
          workingSummary: null,
          confirmedSemanticSummary: null,
          sourceMessageIds: [],
          clarificationPromptMessageId: null,
          confirmationMessageId: null,
          confirmedAt: null,
          readyForConfirmation: false,
          purgedAt: inbound.occurredAt,
          updatedAt: inbound.occurredAt,
        }).where(eq(surveyQuestionWorkingInsights.id, working.id));
        await tx.update(pulseBacklog).set({
          status: 'done', doneAt: inbound.occurredAt,
          resultedInCoverage: false, updatedAt: inbound.occurredAt,
        }).where(and(
          eq(pulseBacklog.tenantId, input.tenantId),
          eq(pulseBacklog.userId, input.userId),
          eq(pulseBacklog.surveyWindowId, working.surveyWindowId),
          eq(pulseBacklog.surveyQuestionId, working.surveyQuestionId),
        ));
      }
      const remaining = await tx.select({ surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId })
        .from(surveyQuestionWorkingInsights).where(and(
          eq(surveyQuestionWorkingInsights.confirmationBundleId, working.confirmationBundleId),
          eq(surveyQuestionWorkingInsights.status, 'pending_clarification'),
        ));
      const remainingIds = new Set(remaining.map((row) => row.surveyQuestionId));
      const remainingComponents = bundleComponents.filter((component) =>
        remainingIds.has(component.surveyQuestionId));
      if (remainingComponents.length !== remainingIds.size) {
        throw new Error('v2_clarification_bundle_components_stale');
      }
      await tx.update(surveyQuestionConfirmationBundles).set({
        displayedText: null,
        components: remaining.length ? remainingComponents : null,
        ...(remaining.length ? {} : { purgedAt: inbound.occurredAt }),
      }).where(and(
        eq(surveyQuestionConfirmationBundles.id, working.confirmationBundleId),
        eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
      ));
      await tx.insert(surveyQuestionVerdictReceipts).values({
        inboundMessageId: input.inboundMessageId,
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId: input.conversationId,
        questionGroup: bundle.questionGroup,
        verdictKind: input.verdict.kind,
        workingInsightId: working.id,
      });
      return true;
    });
  }

  async findAwaitingQuestionBundle(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<AwaitingQuestionBundle | null> {
    const [inbound] = await this.db.client.select({ occurredAt: messages.occurredAt })
      .from(messages).where(and(
        eq(messages.id, input.inboundMessageId),
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'inbound'),
        isNull(messages.deletedAt),
      )).limit(1);
    if (!inbound) throw new Error('v2_confirmation_inbound_scope_mismatch');

    const bundles = await this.db.client.select({
      id: surveyQuestionConfirmationBundles.id,
      surveyWindowId: surveyQuestionConfirmationBundles.surveyWindowId,
      questionGroup: surveyQuestionConfirmationBundles.questionGroup,
      displayedText: surveyQuestionConfirmationBundles.displayedText,
      components: surveyQuestionConfirmationBundles.components,
      periodEnd: surveyWindows.periodEnd,
    }).from(surveyQuestionConfirmationBundles)
      .innerJoin(messages, eq(messages.id, surveyQuestionConfirmationBundles.promptMessageId))
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyQuestionConfirmationBundles.surveyWindowId))
      .where(and(
        eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
        eq(surveyQuestionConfirmationBundles.userId, input.userId),
        inArray(surveyQuestionConfirmationBundles.status, ['pending_delivery', 'awaiting_confirmation']),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindows.status, 'active'),
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'outbound'),
        isNull(messages.deletedAt),
        lt(messages.sentAt, inbound.occurredAt),
      )).limit(2);
    if (bundles.length === 0) return null;
    if (bundles.length !== 1) throw new Error('v2_multiple_awaiting_question_bundles');
    const bundle = bundles[0];
    if (inbound.occurredAt >= bundle.periodEnd) return null;
    return {
      id: bundle.id,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: bundle.surveyWindowId,
      questionGroup: bundle.questionGroup,
      displayedText: bundle.displayedText ?? '',
      components: parseBundleComponents(bundle.components),
    };
  }

  async applyQuestionBundleVerdict(input: {
    tenantId: string; userId: string; conversationId: string;
    inboundMessageId: string; bundleId: string;
    verdict: Exclude<QuestionBundleVerdict, { kind: 'unrelated' }>;
  }): Promise<boolean> {
    return this.db.client.transaction(async (tx) => {
      const [bundle] = await tx.select().from(surveyQuestionConfirmationBundles)
        .where(and(
          eq(surveyQuestionConfirmationBundles.id, input.bundleId),
          eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, input.userId),
        )).for('update').limit(1);
      if (!bundle || !['pending_delivery', 'awaiting_confirmation'].includes(bundle.status)) return false;
      const components = parseBundleComponents(bundle.components);
      const verdict = validateQuestionBundleVerdict(
        input.verdict, components.map((component) => component.surveyQuestionId),
      );
      if (verdict.kind === 'unrelated') return false;

      const [inbound] = await tx.select({ occurredAt: messages.occurredAt })
        .from(messages).where(and(
          eq(messages.id, input.inboundMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      const [prompt] = await tx.select({ sentAt: messages.sentAt })
        .from(messages).where(and(
          eq(messages.id, bundle.promptMessageId!),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      const [window] = await tx.select({ periodEnd: surveyWindows.periodEnd, status: surveyWindows.status })
        .from(surveyWindows).where(and(
          eq(surveyWindows.id, bundle.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
        )).limit(1);
      if (!inbound || !prompt?.sentAt || !window || window.status !== 'active'
        || inbound.occurredAt <= prompt.sentAt || inbound.occurredAt >= window.periodEnd) {
        throw new Error('v2_confirmation_reply_scope_mismatch');
      }

      const working = await tx.select().from(surveyQuestionWorkingInsights).where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, bundle.surveyWindowId),
        eq(surveyQuestionWorkingInsights.confirmationBundleId, bundle.id),
      )).orderBy(surveyQuestionWorkingInsights.surveyQuestionId).for('update');
      if (working.length !== components.length || working.some((row) => row.status !== 'pending_confirmation'
        || !components.some((component) => component.surveyQuestionId === row.surveyQuestionId
          && component.questionVersion === row.questionVersion))) {
        throw new Error('v2_confirmation_working_state_stale');
      }

      for (const row of working) {
        const component = components.find((item) => item.surveyQuestionId === row.surveyQuestionId)!;
        const outcome = verdict.kind === 'agree' ? 'accepted'
          : verdict.kind === 'reject' ? 'reset'
            : verdict.acceptedQuestionIds.includes(row.surveyQuestionId) ? 'accepted'
              : verdict.disputedQuestionIds.includes(row.surveyQuestionId) ? 'disputed'
                : 'declined';
        if (outcome === 'accepted') {
          await tx.update(surveyQuestionWorkingInsights).set({
            status: 'confirmed',
            confirmedSemanticSummary: component.statement,
            confirmationMessageId: input.inboundMessageId,
            confirmedAt: inbound.occurredAt,
            readyForConfirmation: false,
            updatedAt: inbound.occurredAt,
          }).where(eq(surveyQuestionWorkingInsights.id, row.id));
        } else if (outcome === 'disputed') {
          await tx.update(surveyQuestionWorkingInsights).set({
            status: 'pending_clarification',
            readyForConfirmation: false,
            updatedAt: inbound.occurredAt,
          }).where(eq(surveyQuestionWorkingInsights.id, row.id));
        } else {
          await tx.update(surveyQuestionWorkingInsights).set({
            status: outcome === 'reset' ? 'reset' : 'declined',
            workingSummary: null,
            confirmedSemanticSummary: null,
            sourceMessageIds: [],
            clarificationPromptMessageId: null,
            confirmationMessageId: null,
            confirmedAt: null,
            readyForConfirmation: false,
            purgedAt: inbound.occurredAt,
            updatedAt: inbound.occurredAt,
          }).where(eq(surveyQuestionWorkingInsights.id, row.id));
          await tx.update(pulseBacklog).set(outcome === 'reset' ? {
            status: 'pending', doneAt: null, evidenceCapturedCount: 0,
            resultedInCoverage: null, updatedAt: inbound.occurredAt,
          } : {
            status: 'done', doneAt: inbound.occurredAt,
            resultedInCoverage: false, updatedAt: inbound.occurredAt,
          }).where(and(
            eq(pulseBacklog.tenantId, input.tenantId),
            eq(pulseBacklog.userId, input.userId),
            eq(pulseBacklog.surveyWindowId, bundle.surveyWindowId),
            eq(pulseBacklog.surveyQuestionId, row.surveyQuestionId),
          ));
        }
      }
      const needsClarification = verdict.kind === 'partial' && verdict.disputedQuestionIds.length > 0;
      await tx.update(surveyQuestionConfirmationBundles).set({
        status: verdict.kind === 'reject' ? 'rejected' : 'resolved',
        displayedText: null,
        components: needsClarification
          ? components.filter((component) => verdict.disputedQuestionIds.includes(component.surveyQuestionId))
          : null,
        ...(needsClarification ? {} : { purgedAt: inbound.occurredAt }),
      }).where(eq(surveyQuestionConfirmationBundles.id, bundle.id));
      await tx.insert(surveyQuestionVerdictReceipts).values({
        inboundMessageId: input.inboundMessageId,
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId: input.conversationId,
        questionGroup: bundle.questionGroup,
        verdictKind: verdict.kind,
        bundleId: bundle.id,
      });
      return true;
    });
  }

  async findReadyQuestionBundle(input: {
    tenantId: string; userId: string;
  }): Promise<ReadyQuestionBundle | null> {
    const windows = await this.db.client.select({
      id: surveyWindows.id,
      surveyDefinitionId: surveyWindows.surveyDefinitionId,
      periodEnd: surveyWindows.periodEnd,
    }).from(surveyWindows)
      .innerJoin(surveyWindowScoringPolicies,
        eq(surveyWindowScoringPolicies.surveyWindowId, surveyWindows.id))
      .where(and(
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindows.status, 'active'),
        eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
      )).limit(2);
    if (windows.length === 0) return null;
    if (windows.length !== 1) throw new Error('v2_multiple_active_survey_windows');
    const window = windows[0];
    if (window.periodEnd <= new Date()) return null;
    if (await this.getWindowMode({ ...input, surveyWindowId: window.id }) !== 'v2') {
      throw new Error('v2_question_bundle_policy_unbound');
    }

    const [unresolvedBundle] = await this.db.client.select({ id: surveyQuestionConfirmationBundles.id })
      .from(surveyQuestionConfirmationBundles).where(and(
        eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
        eq(surveyQuestionConfirmationBundles.userId, input.userId),
        eq(surveyQuestionConfirmationBundles.surveyWindowId, window.id),
        inArray(surveyQuestionConfirmationBundles.status, ['pending_delivery', 'awaiting_confirmation']),
      )).limit(1);
    if (unresolvedBundle) return null;
    const [pendingClarification] = await this.db.client.select({ id: surveyQuestionWorkingInsights.id })
      .from(surveyQuestionWorkingInsights).where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, window.id),
        eq(surveyQuestionWorkingInsights.status, 'pending_clarification'),
      )).limit(1);
    if (pendingClarification) return null;

    const questions = await this.db.client.select({
      id: surveyQuestions.id,
      version: surveyQuestions.version,
      questionGroup: surveyQuestions.questionGroup,
      displayOrder: surveyQuestions.displayOrder,
    }).from(surveyQuestions).where(and(
      eq(surveyQuestions.surveyDefinitionId, window.surveyDefinitionId),
      eq(surveyQuestions.responseType, 'open_ended'),
      inArray(surveyQuestions.questionGroup, ['autonomy', 'growth', 'purpose', 'belonging']),
    ));
    const working = await this.db.client.select({
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
      questionVersion: surveyQuestionWorkingInsights.questionVersion,
      status: surveyQuestionWorkingInsights.status,
      readyForConfirmation: surveyQuestionWorkingInsights.readyForConfirmation,
      workingSummary: surveyQuestionWorkingInsights.workingSummary,
      purgedAt: surveyQuestionWorkingInsights.purgedAt,
      finalizedAt: surveyQuestionWorkingInsights.finalizedAt,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
      eq(surveyQuestionWorkingInsights.userId, input.userId),
      eq(surveyQuestionWorkingInsights.surveyWindowId, window.id),
    ));
    const byQuestion = new Map(working.map((row) => [row.surveyQuestionId, row]));
    for (const questionGroup of ['autonomy', 'growth', 'purpose', 'belonging']) {
      const groupQuestions = questions.filter((question) => question.questionGroup === questionGroup)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      if (groupQuestions.length !== 3) continue;
      const rows = groupQuestions.map((question) => byQuestion.get(question.id));
      const ready = rows.map((row, index) => ({ row, question: groupQuestions[index]! }))
        .filter(({ row }) => row?.status === 'collecting' && row.readyForConfirmation
          && row.workingSummary?.trim() && row.purgedAt === null);
      if (ready.length === 0 || rows.some((row, index) => !row
        || row.questionVersion !== groupQuestions[index]!.version
        || (!ready.some((item) => item.row === row)
          && !(row.status === 'confirmed' && row.purgedAt && row.finalizedAt)))) continue;
      return {
        ...input,
        surveyWindowId: window.id,
        questionGroup,
        questions: ready.map(({ question, row }) => ({
          surveyQuestionId: question.id,
          questionVersion: question.version,
          workingSummary: row!.workingSummary!,
        })),
      };
    }
    return null;
  }

  async stageQuestionConfirmationBundle(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    surveyWindowId: string;
    questionGroup: string;
    promptMessageId: string;
    displayedText: string;
    components: Array<{
      surveyQuestionId: string; questionVersion: string; statement: string; expectedWorkingSummary: string;
    }>;
  }): Promise<string> {
    if (!['autonomy', 'growth', 'purpose', 'belonging'].includes(input.questionGroup)
      || input.components.length < 1 || input.components.length > 3
      || new Set(input.components.map((component) => component.surveyQuestionId)).size !== input.components.length
      || new Set(input.components.map((component) => component.statement.trim())).size !== input.components.length
      || !input.displayedText.trim()
      || input.components.some((component) => !component.statement.trim()
        || !input.displayedText.includes(component.statement)
        || input.displayedText.split(component.statement).length !== 2
        || !component.expectedWorkingSummary.trim()
        || !component.questionVersion.trim())) {
      throw new Error('v2_confirmation_bundle_invalid_composition');
    }

    return this.db.client.transaction(async (tx) => {
      const [scope] = await tx.select({
        windowStatus: surveyWindows.status,
        periodEnd: surveyWindows.periodEnd,
        messageText: messages.text,
        messageSentAt: messages.sentAt,
      }).from(surveyWindows)
        .innerJoin(surveyWindowScoringPolicies,
          eq(surveyWindowScoringPolicies.surveyWindowId, surveyWindows.id))
        .innerJoin(messages, eq(messages.id, input.promptMessageId))
        .where(and(
          eq(surveyWindows.id, input.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
          eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
          isNull(messages.deletedAt),
        )).for('update').limit(1);
      if (!scope || scope.windowStatus !== 'active' || scope.periodEnd <= new Date()
        || scope.messageSentAt || scope.messageText !== input.displayedText) {
        throw new Error('v2_confirmation_bundle_scope_mismatch');
      }
      const [anotherBundle] = await tx.select({ id: surveyQuestionConfirmationBundles.id })
        .from(surveyQuestionConfirmationBundles).where(and(
          eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, input.userId),
          eq(surveyQuestionConfirmationBundles.surveyWindowId, input.surveyWindowId),
          inArray(surveyQuestionConfirmationBundles.status, ['pending_delivery', 'awaiting_confirmation']),
        )).limit(1);
      const [pendingClarification] = await tx.select({ id: surveyQuestionWorkingInsights.id })
        .from(surveyQuestionWorkingInsights).where(and(
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
          eq(surveyQuestionWorkingInsights.status, 'pending_clarification'),
        )).limit(1);
      if (anotherBundle || pendingClarification) {
        throw new Error('v2_confirmation_bundle_already_unresolved');
      }

      const questions = await tx.select({ id: surveyQuestions.id, version: surveyQuestions.version })
        .from(surveyQuestions)
        .innerJoin(surveyWindows,
          eq(surveyWindows.surveyDefinitionId, surveyQuestions.surveyDefinitionId))
        .where(and(
          eq(surveyWindows.id, input.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyQuestions.questionGroup, input.questionGroup),
          eq(surveyQuestions.responseType, 'open_ended'),
        ));
      if (questions.length !== 3 || input.components.some((component) => !questions.some(
        (question) => component.surveyQuestionId === question.id && component.questionVersion === question.version,
      ))) throw new Error('v2_confirmation_bundle_question_set_mismatch');

      const working = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
          inArray(surveyQuestionWorkingInsights.surveyQuestionId, questions.map((question) => question.id)),
        )).orderBy(surveyQuestionWorkingInsights.surveyQuestionId).for('update');
      const selected = working.filter((row) => input.components.some(
        (component) => component.surveyQuestionId === row.surveyQuestionId));
      if (working.length !== 3 || selected.length !== input.components.length
        || working.some((row) => {
          const component = input.components.find((item) => item.surveyQuestionId === row.surveyQuestionId);
          return component
            ? row.status !== 'collecting' || !row.readyForConfirmation
              || !row.workingSummary?.trim() || row.sourceMessageIds.length === 0 || row.purgedAt !== null
              || component.questionVersion !== row.questionVersion
              || component.expectedWorkingSummary !== row.workingSummary
            : row.status !== 'confirmed' || !row.purgedAt || !row.finalizedAt;
        })) {
        throw new Error('v2_confirmation_bundle_working_state_stale');
      }

      const [bundle] = await tx.insert(surveyQuestionConfirmationBundles).values({
        tenantId: input.tenantId,
        userId: input.userId,
        surveyWindowId: input.surveyWindowId,
        questionGroup: input.questionGroup,
        version: `message:${input.promptMessageId}`,
        displayedText: input.displayedText,
        components: input.components.map((component) => ({
          surveyQuestionId: component.surveyQuestionId,
          questionVersion: component.questionVersion,
          statement: component.statement,
          sourceMessageIds: selected.find((row) => row.surveyQuestionId === component.surveyQuestionId)!.sourceMessageIds,
        })),
        promptMessageId: input.promptMessageId,
      }).returning({ id: surveyQuestionConfirmationBundles.id });
      await tx.update(surveyQuestionWorkingInsights).set({
        status: 'pending_confirmation',
        confirmationBundleId: bundle.id,
        updatedAt: new Date(),
      }).where(inArray(surveyQuestionWorkingInsights.id, selected.map((row) => row.id)));
      return bundle.id;
    });
  }

  async activateDeliveredQuestionBundle(input: {
    promptMessageId: string; tenantId: string; conversationId: string; deliveredAt: Date;
  }): Promise<void> {
    await this.db.client.transaction(async (tx) => {
      const [bundle] = await tx.select({
        id: surveyQuestionConfirmationBundles.id,
        status: surveyQuestionConfirmationBundles.status,
        messageSentAt: messages.sentAt,
      }).from(surveyQuestionConfirmationBundles)
        .innerJoin(messages, eq(messages.id, surveyQuestionConfirmationBundles.promptMessageId))
        .where(and(
          eq(surveyQuestionConfirmationBundles.promptMessageId, input.promptMessageId),
          eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'),
        )).for('update').limit(1);
      if (!bundle) return;
      if (!bundle.messageSentAt || bundle.messageSentAt.getTime() !== input.deliveredAt.getTime()) {
        throw new Error('v2_confirmation_delivery_not_recorded');
      }
      if (bundle.status === 'awaiting_confirmation') return;
      if (bundle.status !== 'pending_delivery') return;
      await tx.update(surveyQuestionConfirmationBundles).set({ status: 'awaiting_confirmation' })
        .where(eq(surveyQuestionConfirmationBundles.id, bundle.id));
    });
  }

  async getWindowMode(input: {
    tenantId: string; userId: string; surveyWindowId: string;
  }): Promise<'v1' | 'v2'> {
    const [bound] = await this.db.client.select({
      windowStatus: surveyWindows.status,
      surveyDefinitionId: surveyWindows.surveyDefinitionId,
      rubrics: surveyScoringPolicies.rubrics,
      policyVersion: surveyScoringPolicies.version,
      definitionVersion: surveyDefinitions.version,
    }).from(surveyWindowScoringPolicies)
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyWindowScoringPolicies.surveyWindowId))
      .innerJoin(surveyDefinitions, eq(surveyDefinitions.id, surveyWindows.surveyDefinitionId))
      .innerJoin(surveyScoringPolicies,
        eq(surveyScoringPolicies.id, surveyWindowScoringPolicies.scoringPolicyId))
      .where(and(
        eq(surveyWindowScoringPolicies.surveyWindowId, input.surveyWindowId),
        eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyScoringPolicies.tenantId, input.tenantId),
      )).limit(1);
    if (!bound) {
      const [window] = await this.db.client.select({ definitionVersion: surveyDefinitions.version })
        .from(surveyWindows)
        .innerJoin(surveyDefinitions, eq(surveyDefinitions.id, surveyWindows.surveyDefinitionId))
        .where(and(
          eq(surveyWindows.id, input.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
        )).limit(1);
      if (window?.definitionVersion === 'v2-policy-1.0.0') {
        throw new Error('v2_window_policy_binding_missing');
      }
      return 'v1';
    }
    if (bound.windowStatus !== 'active') throw new Error('v2_survey_window_inactive');

    const questions = await this.db.client.select({
      stableKey: surveyQuestions.stableKey,
      responseType: surveyQuestions.responseType,
      questionGroup: surveyQuestions.questionGroup,
      title: surveyQuestions.title,
      canonicalMeaning: surveyQuestions.canonicalMeaning,
      version: surveyQuestions.version,
    }).from(surveyQuestions)
      .where(eq(surveyQuestions.surveyDefinitionId, bound.surveyDefinitionId));
    if (!(bound.policyVersion === '1.0.0'
      ? bound.definitionVersion === 'v2-policy-1.0.0'
        && hasCompleteV2ScoringPolicy(questions, bound.rubrics)
      : hasLegacyV2ScoringPolicy(questions, bound.rubrics))) {
      throw new Error('v2_scoring_policy_incomplete');
    }

    const [legacyEvidence] = await this.db.client.select({ id: surveyEvidence.id })
      .from(surveyEvidence)
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyEvidence.surveyQuestionId))
      .where(and(
        eq(surveyEvidence.surveyWindowId, input.surveyWindowId),
        eq(surveyEvidence.userId, input.userId),
        eq(surveyQuestions.responseType, 'open_ended'),
      )).limit(1);
    const [legacyGroup] = await this.db.client.select({ id: surveyGroupStates.id })
      .from(surveyGroupStates).where(and(
        eq(surveyGroupStates.surveyWindowId, input.surveyWindowId),
        eq(surveyGroupStates.tenantId, input.tenantId),
        eq(surveyGroupStates.userId, input.userId),
        inArray(surveyGroupStates.questionGroup, ['autonomy', 'growth', 'purpose', 'belonging']),
      )).limit(1);
    if (legacyEvidence || legacyGroup) throw new Error('v2_window_contains_legacy_open_ended_data');
    return 'v2';
  }

  async reopenDeclinedQuestion(input: {
    tenantId: string; userId: string; conversationId: string;
    surveyWindowId: string; surveyQuestionId: string; questionVersion: string;
    sourceMessageId: string;
  }): Promise<boolean> {
    return this.db.client.transaction(async (tx) => {
      const [scope] = await tx.select({
        periodStart: surveyWindows.periodStart,
        periodEnd: surveyWindows.periodEnd,
        sourceOccurredAt: messages.occurredAt,
      }).from(surveyWindows)
        .innerJoin(surveyQuestions,
          eq(surveyQuestions.surveyDefinitionId, surveyWindows.surveyDefinitionId))
        .innerJoin(messages, eq(messages.id, input.sourceMessageId))
        .innerJoin(surveyWindowScoringPolicies,
          eq(surveyWindowScoringPolicies.surveyWindowId, surveyWindows.id))
        .where(and(
          eq(surveyWindows.id, input.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
          eq(surveyWindows.status, 'active'),
          gt(surveyWindows.periodEnd, new Date()),
          eq(surveyQuestions.id, input.surveyQuestionId),
          eq(surveyQuestions.version, input.questionVersion),
          eq(surveyQuestions.responseType, 'open_ended'),
          inArray(surveyQuestions.questionGroup, ['autonomy', 'growth', 'purpose', 'belonging']),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
          eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
        )).limit(1);
      if (!scope || scope.sourceOccurredAt < scope.periodStart
        || scope.sourceOccurredAt >= scope.periodEnd) return false;

      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
          eq(surveyQuestionWorkingInsights.surveyQuestionId, input.surveyQuestionId),
          eq(surveyQuestionWorkingInsights.questionVersion, input.questionVersion),
        )).for('update').limit(1);
      if (!working || working.status !== 'declined'
        || working.purgedAt === null || scope.sourceOccurredAt <= working.purgedAt) return false;

      await tx.update(surveyQuestionWorkingInsights).set({
        status: 'reset', workingSummary: null, confirmedSemanticSummary: null,
        sourceMessageIds: [], readyForConfirmation: false,
        confirmationBundleId: null, confirmationMessageId: null,
        clarificationPromptMessageId: null, confirmedAt: null,
        finalizedAt: null, updatedAt: scope.sourceOccurredAt,
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      await tx.update(pulseBacklog).set({
        status: 'pending', doneAt: null, evidenceCapturedCount: 0,
        resultedInCoverage: null, updatedAt: scope.sourceOccurredAt,
      }).where(and(
        eq(pulseBacklog.tenantId, input.tenantId),
        eq(pulseBacklog.userId, input.userId),
        eq(pulseBacklog.surveyWindowId, input.surveyWindowId),
        eq(pulseBacklog.surveyQuestionId, input.surveyQuestionId),
        eq(pulseBacklog.status, 'done'),
      ));
      return true;
    });
  }

  async captureMeaning(input: CaptureQuestionMeaningInput): Promise<'captured' | 'ignored'> {
    const meaning = input.meaning.trim();
    if (!meaning || !input.questionVersion.trim()) return 'ignored';
    return this.db.client.transaction(async (tx) => {
      const [scope] = await tx.select({
        periodStart: surveyWindows.periodStart,
        periodEnd: surveyWindows.periodEnd,
        sourceOccurredAt: messages.occurredAt,
      }).from(surveyWindows)
        .innerJoin(surveyQuestions,
          eq(surveyQuestions.surveyDefinitionId, surveyWindows.surveyDefinitionId))
        .innerJoin(messages, eq(messages.id, input.sourceMessageId))
        .innerJoin(surveyWindowScoringPolicies,
          eq(surveyWindowScoringPolicies.surveyWindowId, surveyWindows.id))
        .where(and(
          eq(surveyWindows.id, input.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
          eq(surveyWindows.status, 'active'),
          eq(surveyQuestions.id, input.surveyQuestionId),
          eq(surveyQuestions.version, input.questionVersion),
          eq(surveyQuestions.responseType, 'open_ended'),
          inArray(surveyQuestions.questionGroup, ['autonomy', 'growth', 'purpose', 'belonging']),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
          eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
        )).limit(1);
      if (!scope || scope.periodEnd <= new Date() || scope.sourceOccurredAt < scope.periodStart
        || scope.sourceOccurredAt >= scope.periodEnd) return 'ignored';

      const [currentInsight] = await tx.select({ confirmedAt: surveyQuestionInsights.confirmedAt })
        .from(surveyQuestionInsights).where(and(
          eq(surveyQuestionInsights.tenantId, input.tenantId),
          eq(surveyQuestionInsights.userId, input.userId),
          eq(surveyQuestionInsights.surveyWindowId, input.surveyWindowId),
          eq(surveyQuestionInsights.surveyQuestionId, input.surveyQuestionId),
          eq(surveyQuestionInsights.questionVersion, input.questionVersion),
          eq(surveyQuestionInsights.isCurrent, true),
        )).limit(1);
      if (currentInsight && scope.sourceOccurredAt <= currentInsight.confirmedAt) return 'ignored';

      const key = and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
        eq(surveyQuestionWorkingInsights.surveyQuestionId, input.surveyQuestionId),
        eq(surveyQuestionWorkingInsights.questionVersion, input.questionVersion),
      );
      let [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(key).for('update').limit(1);
      if (!working) {
        const [created] = await tx.insert(surveyQuestionWorkingInsights).values({
          tenantId: input.tenantId,
          userId: input.userId,
          surveyWindowId: input.surveyWindowId,
          surveyQuestionId: input.surveyQuestionId,
          questionVersion: input.questionVersion,
          workingSummary: meaning,
          readyForConfirmation: input.sufficientMeaning,
          sourceMessageIds: [input.sourceMessageId],
        }).onConflictDoNothing().returning({ id: surveyQuestionWorkingInsights.id });
        if (created) return 'captured';
        [working] = await tx.select().from(surveyQuestionWorkingInsights)
          .where(key).for('update').limit(1);
      }
      if (!working || (!['collecting', 'reset'].includes(working.status)
        && !(working.status === 'confirmed' && working.purgedAt && working.finalizedAt))
        || working.sourceMessageIds.includes(input.sourceMessageId)) return 'ignored';

      const reopened = working.status === 'reset' || Boolean(working.purgedAt && working.finalizedAt);
      await tx.update(surveyQuestionWorkingInsights).set({
        status: 'collecting',
        readyForConfirmation: reopened ? input.sufficientMeaning
          : working.readyForConfirmation || input.sufficientMeaning,
        workingSummary: reopened || !working.workingSummary
          ? meaning
          : working.workingSummary.includes(meaning)
            ? working.workingSummary
            : `${working.workingSummary}\n${meaning}`,
        sourceMessageIds: reopened
          ? [input.sourceMessageId]
          : [...working.sourceMessageIds, input.sourceMessageId],
        ...(reopened ? {
          confirmedSemanticSummary: null,
          confirmationBundleId: null,
          clarificationPromptMessageId: null,
          confirmationMessageId: null,
          confirmedAt: null,
          finalizedAt: null,
        } : {}),
        purgedAt: null,
        updatedAt: new Date(),
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      return 'captured';
    });
  }

  async findWindowPeriod(input: {
    tenantId: string; userId: string; surveyWindowId: string; surveyDefinitionId: string;
  }): Promise<{ periodStart: Date; periodEnd: Date } | null> {
    const [window] = await this.db.client.select({
      periodStart: surveyWindows.periodStart,
      periodEnd: surveyWindows.periodEnd,
    })
      .from(surveyWindows).where(and(
        eq(surveyWindows.id, input.surveyWindowId),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindows.surveyDefinitionId, input.surveyDefinitionId),
      )).limit(1);
    return window ?? null;
  }

  async findFinalizedQuestions(input: {
    tenantId: string; userId: string; surveyWindowId: string;
    surveyDefinitionId: string; questionGroup: string;
  }): Promise<QuestionInsightInputRecord[]> {
    const rows = await this.db.client.select({
      questionId: surveyQuestionInsights.surveyQuestionId,
      questionVersion: surveyQuestionInsights.questionVersion,
      deidentifiedSummary: surveyQuestionInsights.deidentifiedSummary,
      outcome: surveyQuestionInsights.outcome,
      score: surveyQuestionInsights.score,
      scoringPolicyVersion: surveyQuestionInsights.scoringPolicyVersion,
      confirmedAt: surveyQuestionInsights.confirmedAt,
    }).from(surveyQuestionInsights)
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyQuestionInsights.surveyWindowId))
      .where(and(
      eq(surveyQuestionInsights.tenantId, input.tenantId),
      eq(surveyQuestionInsights.userId, input.userId),
      eq(surveyQuestionInsights.surveyWindowId, input.surveyWindowId),
      eq(surveyQuestionInsights.surveyDefinitionId, input.surveyDefinitionId),
      eq(surveyQuestionInsights.questionGroup, input.questionGroup),
      eq(surveyWindows.tenantId, input.tenantId),
      eq(surveyWindows.userId, input.userId),
      eq(surveyWindows.surveyDefinitionId, input.surveyDefinitionId),
      gte(surveyQuestionInsights.confirmedAt, surveyWindows.periodStart),
      lt(surveyQuestionInsights.confirmedAt, surveyWindows.periodEnd),
      isNull(surveyQuestionInsights.withdrawnAt),
      eq(surveyQuestionInsights.isCurrent, true),
      inArray(surveyQuestionInsights.outcome, ['scored', 'insufficient_evidence']),
    ));
    return rows.map((row) => ({
      ...row,
      outcome: row.outcome as QuestionInsightInputRecord['outcome'],
      score: row.score === null ? null : Number(row.score),
    }));
  }

  async findPriorFinalizedQuestionScores(input: {
    tenantId: string; userId: string; surveyWindowId: string;
    surveyDefinitionId: string; questionGroup: string; questionIds: readonly string[];
  }): Promise<PriorQuestionScoreRecord[]> {
    if (input.questionIds.length === 0) return [];
    const [currentWindow] = await this.db.client.select({ periodStart: surveyWindows.periodStart })
      .from(surveyWindows).where(and(
        eq(surveyWindows.id, input.surveyWindowId),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindows.surveyDefinitionId, input.surveyDefinitionId),
      )).limit(1);
    if (!currentWindow) throw new Error('question_insight_current_window_missing');
    const rows = await this.db.client.select({
      questionId: surveyQuestionInsights.surveyQuestionId,
      questionVersion: surveyQuestionInsights.questionVersion,
      score: surveyQuestionInsights.score,
      scoringPolicyVersion: surveyQuestionInsights.scoringPolicyVersion,
      periodStart: surveyWindows.periodStart,
      periodEnd: surveyWindows.periodEnd,
      confirmedAt: surveyQuestionInsights.confirmedAt,
    }).from(surveyQuestionInsights)
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyQuestionInsights.surveyWindowId))
      .where(and(
        eq(surveyQuestionInsights.tenantId, input.tenantId),
        eq(surveyQuestionInsights.userId, input.userId),
        eq(surveyQuestionInsights.surveyDefinitionId, input.surveyDefinitionId),
        eq(surveyQuestionInsights.questionGroup, input.questionGroup),
        inArray(surveyQuestionInsights.surveyQuestionId, [...input.questionIds]),
        isNull(surveyQuestionInsights.withdrawnAt),
        eq(surveyQuestionInsights.isCurrent, true),
        eq(surveyQuestionInsights.outcome, 'scored'),
        isNotNull(surveyQuestionInsights.score),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindows.surveyDefinitionId, input.surveyDefinitionId),
        eq(surveyWindows.status, 'closed'),
        gte(surveyQuestionInsights.confirmedAt, surveyWindows.periodStart),
        lt(surveyQuestionInsights.confirmedAt, surveyWindows.periodEnd),
        lt(surveyWindows.periodStart, currentWindow.periodStart),
        lte(surveyWindows.periodEnd, currentWindow.periodStart),
      ));
    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }

  async listPendingConfirmedUsers(): Promise<Array<{ tenantId: string; userId: string }>> {
    return this.db.client.selectDistinct({
      tenantId: surveyQuestionWorkingInsights.tenantId,
      userId: surveyQuestionWorkingInsights.userId,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.status, 'confirmed'),
      isNull(surveyQuestionWorkingInsights.purgedAt),
      isNotNull(surveyQuestionWorkingInsights.confirmedSemanticSummary),
    )).orderBy(surveyQuestionWorkingInsights.tenantId, surveyQuestionWorkingInsights.userId);
  }

  async listPendingConfirmedQuestions(input: {
    tenantId: string; userId: string;
  }): Promise<Array<{ surveyWindowId: string; surveyQuestionId: string }>> {
    return this.db.client.select({
      surveyWindowId: surveyQuestionWorkingInsights.surveyWindowId,
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
      eq(surveyQuestionWorkingInsights.userId, input.userId),
      eq(surveyQuestionWorkingInsights.status, 'confirmed'),
      isNull(surveyQuestionWorkingInsights.purgedAt),
    )).orderBy(surveyQuestionWorkingInsights.confirmedAt);
  }

  async loadConfirmedQuestion(input: {
    tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId: string;
  }): Promise<QuestionFinalizationContext | 'already_finalized' | null> {
    const [row] = await this.db.client.select({
      working: surveyQuestionWorkingInsights,
      window: surveyWindows,
      question: surveyQuestions,
      policy: surveyScoringPolicies,
    }).from(surveyQuestionWorkingInsights)
      .innerJoin(surveyWindows, eq(surveyWindows.id, surveyQuestionWorkingInsights.surveyWindowId))
      .innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyQuestionWorkingInsights.surveyQuestionId))
      .innerJoin(surveyWindowScoringPolicies,
        eq(surveyWindowScoringPolicies.surveyWindowId, surveyQuestionWorkingInsights.surveyWindowId))
      .innerJoin(surveyScoringPolicies,
        eq(surveyScoringPolicies.id, surveyWindowScoringPolicies.scoringPolicyId))
      .where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
        eq(surveyQuestionWorkingInsights.surveyQuestionId, input.surveyQuestionId),
        eq(surveyQuestionWorkingInsights.status, 'confirmed'),
        eq(surveyWindows.tenantId, input.tenantId),
        eq(surveyWindows.userId, input.userId),
        eq(surveyWindowScoringPolicies.tenantId, input.tenantId),
        eq(surveyScoringPolicies.tenantId, input.tenantId),
      )).limit(1);
    if (!row?.working.confirmedAt) return null;
    const [existing] = await this.db.client.select({ id: surveyQuestionInsights.id })
      .from(surveyQuestionInsights).where(and(
        eq(surveyQuestionInsights.workingInsightId, row.working.id),
        eq(surveyQuestionInsights.confirmedAt, row.working.confirmedAt),
      )).limit(1);
    if (existing) return 'already_finalized';
    if (!row.working.confirmedSemanticSummary
      || row.working.purgedAt || row.question.version !== row.working.questionVersion
      || row.question.surveyDefinitionId !== row.window.surveyDefinitionId
      || row.working.confirmedAt < row.window.periodStart
      || row.working.confirmedAt >= row.window.periodEnd) return null;

    const rubric = rubricForQuestion(row.policy.rubrics, row.question.stableKey);
    const knownIdentifiers = await this.teamRepository.findCurrentHierarchyIdentifiers(input.userId, input.tenantId);
    const externalSources = row.working.sourceMessageIds.length
      ? await this.db.client.select({ externalMessageId: messages.externalMessageId })
        .from(messages).where(and(
          inArray(messages.id, row.working.sourceMessageIds),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.direction, 'inbound'),
        ))
      : [];
    return {
      workingInsightId: row.working.id,
      workingUpdatedAt: row.working.updatedAt,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: input.surveyWindowId,
      surveyDefinitionId: row.window.surveyDefinitionId,
      surveyQuestionId: input.surveyQuestionId,
      questionVersion: row.question.version,
      questionGroup: row.question.questionGroup,
      confirmedSemanticSummary: row.working.confirmedSemanticSummary,
      confirmedAt: row.working.confirmedAt,
      scoringPolicyVersion: row.policy.version,
      rubric,
      knownIdentifiers,
      sourceMessageIds: [...new Set([
        ...row.working.sourceMessageIds,
        ...externalSources.flatMap((source) => source.externalMessageId?.trim() ? [source.externalMessageId.trim()] : []),
      ])],
    };
  }

  async persistFinalAndPurge(input: {
    final: FinalQuestionInsight;
    workingInsightId: string;
    expectedWorkingUpdatedAt: Date;
  }): Promise<'finalized' | 'already_finalized' | 'stale'> {
    const { final } = input;
    return this.db.client.transaction(async (tx) => {
      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
          eq(surveyQuestionWorkingInsights.tenantId, final.tenantId),
          eq(surveyQuestionWorkingInsights.userId, final.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId, final.surveyWindowId),
          eq(surveyQuestionWorkingInsights.surveyQuestionId, final.surveyQuestionId),
        )).for('update').limit(1);
      if (!working) return 'stale';

      const [existing] = await tx.select({ id: surveyQuestionInsights.id })
        .from(surveyQuestionInsights)
        .where(and(
          eq(surveyQuestionInsights.workingInsightId, working.id),
          eq(surveyQuestionInsights.confirmedAt, final.confirmedAt),
        )).limit(1);
      if (existing && working.purgedAt) return 'already_finalized';
      if (working.status !== 'confirmed' || !working.confirmedAt
        || working.confirmedAt.getTime() !== final.confirmedAt.getTime()
        || working.updatedAt.getTime() !== input.expectedWorkingUpdatedAt.getTime()
        || !working.confirmedSemanticSummary || working.purgedAt) return 'stale';

      if (!existing) {
        await tx.update(surveyQuestionInsights).set({ isCurrent: false }).where(and(
          eq(surveyQuestionInsights.tenantId, final.tenantId),
          eq(surveyQuestionInsights.userId, final.userId),
          eq(surveyQuestionInsights.surveyWindowId, final.surveyWindowId),
          eq(surveyQuestionInsights.surveyDefinitionId, final.surveyDefinitionId),
          eq(surveyQuestionInsights.surveyQuestionId, final.surveyQuestionId),
          eq(surveyQuestionInsights.questionVersion, final.questionVersion),
          eq(surveyQuestionInsights.isCurrent, true),
        ));
        await tx.insert(surveyQuestionInsights).values({
          tenantId: final.tenantId,
          userId: final.userId,
          surveyWindowId: final.surveyWindowId,
          surveyDefinitionId: final.surveyDefinitionId,
          surveyQuestionId: final.surveyQuestionId,
          questionVersion: final.questionVersion,
          questionGroup: final.questionGroup,
          deidentifiedSummary: final.deidentifiedSummary,
          outcome: final.outcome,
          score: final.score === null ? null : String(final.score),
          isCurrent: true,
          workingInsightId: working.id,
          signalDirection: final.signalDirection,
          signalSeverity: final.signalSeverity,
          rootCauseCategory: final.rootCauseCategory,
          confidence: String(final.confidence),
          scoringPolicyVersion: final.scoringPolicyVersion,
          questionRubricVersion: final.questionRubricVersion,
          modelId: final.modelId,
          promptVersion: final.promptVersion,
          privacyPolicyVersion: final.privacyPolicyVersion,
          confirmedAt: final.confirmedAt,
          scoredAt: final.scoredAt,
        });
      }

      const purgedAt = new Date();
      await tx.update(surveyQuestionWorkingInsights).set({
        workingSummary: null,
        confirmedSemanticSummary: null,
        sourceMessageIds: [],
        clarificationPromptMessageId: null,
        confirmationMessageId: null,
        finalizedAt: purgedAt,
        purgedAt,
        updatedAt: purgedAt,
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      await tx.delete(surveyEvidence).where(and(
        eq(surveyEvidence.surveyWindowId, final.surveyWindowId),
        eq(surveyEvidence.surveyQuestionId, final.surveyQuestionId),
        eq(surveyEvidence.userId, final.userId),
      ));
      await tx.update(surveyAssessments).set({ reasoningSummary: null, evidenceIds: [] }).where(and(
        eq(surveyAssessments.surveyWindowId, final.surveyWindowId),
        eq(surveyAssessments.surveyQuestionId, final.surveyQuestionId),
      ));

      if (working.confirmationBundleId) {
        const bundleQuestions = await tx.select({ purgedAt: surveyQuestionWorkingInsights.purgedAt })
          .from(surveyQuestionWorkingInsights)
          .where(eq(surveyQuestionWorkingInsights.confirmationBundleId, working.confirmationBundleId));
        if (bundleQuestions.every((question) => question.purgedAt !== null)) {
          await tx.update(surveyQuestionConfirmationBundles).set({
            displayedText: null,
            components: null,
            status: 'purged',
            purgedAt,
          }).where(eq(surveyQuestionConfirmationBundles.id, working.confirmationBundleId));
        }
      }
      return existing ? 'already_finalized' : 'finalized';
    });
  }
}

function rubricForQuestion(value: unknown, stableKey: string): ApprovedQuestionRubric | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[stableKey];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const rubric = candidate as Record<string, unknown>;
  if (!isApprovedQuestionRubric(rubric)) return null;
  return rubric as unknown as ApprovedQuestionRubric;
}

function parseBundleComponents(
  value: unknown,
  mode: 'bundle' | 'clarification' = 'bundle',
): AwaitingQuestionBundle['components'] {
  if (!Array.isArray(value)
    || (mode === 'bundle' ? value.length < 1 || value.length > 3 : value.length < 1 || value.length > 2)) {
    throw new Error('v2_confirmation_bundle_components_invalid');
  }
  const components = value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('v2_confirmation_bundle_components_invalid');
    }
    const item = raw as Record<string, unknown>;
    if (typeof item['surveyQuestionId'] !== 'string' || !item['surveyQuestionId'].trim()
      || typeof item['questionVersion'] !== 'string' || !item['questionVersion'].trim()
      || typeof item['statement'] !== 'string' || !item['statement'].trim()) {
      throw new Error('v2_confirmation_bundle_components_invalid');
    }
    return {
      surveyQuestionId: item['surveyQuestionId'],
      questionVersion: item['questionVersion'],
      statement: item['statement'],
    };
  });
  if (new Set(components.map((component) => component.surveyQuestionId)).size !== components.length) {
    throw new Error('v2_confirmation_bundle_components_invalid');
  }
  return components;
}
