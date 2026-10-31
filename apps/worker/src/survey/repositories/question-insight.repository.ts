import {readReportConfigSource,readReportConfigHead,reportSourceFingerprint} from '@entalent/database';
import { canonicalCompanyLocale } from '@entalent/contracts';
import type { QuestionScoreResult } from '@entalent/application';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import {
  lockPulseReportSubject,
  pulseReportAdmission,
  messages,
  pulseBacklog,
  surveyAssessments,
  surveyEvidence,
  surveyGroupStates,
  surveyDefinitions,
  surveyEngagementContractQuestions,
  surveyEngagementCollectionContracts,
  surveyQuestions,
  surveyQuestionConfirmationBundles,
  surveyQuestionInsights,
  surveyReportInsightRevisions,
  surveyQuestionVerdictReceipts,
  surveyQuestionWorkingInsights,
  surveyScoringPolicies,
  surveyWindowScoringPolicies,
  surveyWindows,
} from '@entalent/database';
import type {
  PulseReportAdmissionInput,
  PulseReportCollectionUnavailable,
  ApprovedQuestionRubric,
  FinalQuestionInsight,
  QuestionFinalizationContext,
  QuestionFinalizationRepositoryPort,
  QuestionFinalizationScope,
  QuestionInsightInputRecord,
  PriorQuestionScoreRecord,
  QuestionInsightInputRepositoryPort,
  QuestionWorkingCapturePort,
  CaptureQuestionMeaningInput,
  QuestionConfirmationPort,
  ReadyQuestionBundle,
  AwaitingQuestionBundle,
  QuestionBundleKind,
  QuestionBundleVerdict,
  PendingQuestionClarification,
  QuestionClarificationVerdict,
  AppliedQuestionVerdict,
  CycleProgressSnapshot,
  QuestionWorkingCoverage,
} from '@entalent/application';
import {
  accumulateQuestionReadiness,
  needsDriver,
  hasCompleteV2ScoringPolicy,
  hasCompleteReportEngagementPolicy,
  hasLegacyV2ScoringPolicy,
  isApprovedQuestionRubric,
  isBundleShownIn,
  MAX_QUESTION_CLARIFICATIONS,
  validateQuestionBundleVerdict,
  validateQuestionClarificationPrompt,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
import { TeamRepository } from './team.repository';

const V2_QUESTION_GROUPS = ['autonomy', 'growth', 'purpose', 'belonging'] as const;

@Injectable()
export class QuestionInsightRepository implements QuestionFinalizationRepositoryPort, QuestionInsightInputRepositoryPort, QuestionWorkingCapturePort, QuestionConfirmationPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly teamRepository: TeamRepository,
  ) {}

  private async orgNativeWindow(surveyWindowId: string, tx: { execute(query: ReturnType<typeof sql>): PromiseLike<unknown> } = this.db.client): Promise<boolean> {
    const rows = await tx.execute(sql`select exists(select 1 from survey_report_window_bindings where survey_window_id = ${surveyWindowId}::uuid) as native`) as unknown as { native: boolean }[];
    return rows[0]?.native ?? false;
  }

  private async trustedNativeReceipt(input:{tenantId:string;userId:string;inboundMessageId:string},windowId:string,tx:{execute(query:ReturnType<typeof sql>):PromiseLike<unknown>}):Promise<boolean>{
    const rows=await tx.execute(sql`select exists(select 1 from survey_report_inbound_work w join survey_report_window_bindings b on b.survey_window_id=${windowId}::uuid and b.tenant_id=w.tenant_id join survey_report_participants p on p.id=b.participant_id and p.user_id=w.user_id where w.inbound_receipt_id=${input.inboundMessageId}::uuid and w.tenant_id=${input.tenantId}::uuid and w.user_id=${input.userId}::uuid and w.trust='db-receipt-v1' and pulse_input_receipt_in_scope(w.tenant_id,w.user_id,b.cycle_scoring_policy_id,w.received_at,null,false)) trusted`) as unknown as {trusted:boolean}[];return rows[0]?.trusted??false;
  }

  async collectionAdmission(input: { tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId?: string; sourceMessageId?: string }): Promise<string> {
    return this.db.client.transaction((tx) => pulseReportAdmission(tx, input));
  }

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
      // GC round 3 S4b: a statement this verdict declined stays reported as not collected.
      const [declined] = row.verdictKind === 'partial'
        ? await this.db.client.select({ id: surveyQuestionWorkingInsights.id })
          .from(surveyQuestionWorkingInsights).where(and(
            eq(surveyQuestionWorkingInsights.confirmationBundleId, row.bundleId),
            eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
            eq(surveyQuestionWorkingInsights.userId, input.userId),
            eq(surveyQuestionWorkingInsights.status, 'declined'),
          )).limit(1)
        : [];
      return {
        kind: 'bundle', verdictKind: row.verdictKind, questionGroup: row.questionGroup,
        questionNotCollected: Boolean(declined),
      };
    }
    if (row.workingInsightId && (row.verdictKind === 'clarified'
      || row.verdictKind === 'declined')) {
      return {
        kind: 'clarification', verdictKind: row.verdictKind, questionGroup: row.questionGroup,
        questionNotCollected: row.verdictKind === 'declined',
      };
    }
    throw new Error('v2_verdict_receipt_invalid');
  }

  async findPendingQuestionClarification(input: {
    tenantId: string; userId: string; conversationId: string; inboundMessageId: string;
  }): Promise<PendingQuestionClarification | null> {
    const [inbound] = await this.db.client.select({ occurredAt: messages.occurredAt, receivedAt: messages.receivedAt })
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
      questionVersion: surveyQuestionWorkingInsights.questionVersion,
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
        sql`${surveyWindows.periodEnd} > case when exists(select 1 from survey_report_window_bindings b where b.survey_window_id = ${surveyWindows.id}) then ${inbound.receivedAt?.toISOString() ?? null}::timestamptz else ${inbound.occurredAt.toISOString()}::timestamptz end`,
        eq(messages.tenantId, input.tenantId),
        eq(messages.userId, input.userId),
        eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'outbound'),
        isNotNull(messages.sentAt),
        isNull(messages.deletedAt),
      )).orderBy(surveyQuestions.displayOrder).limit(1);
    if (!row || !row.workingSummary?.trim()) return null;
    if (await this.collectionAdmission({ ...input, surveyWindowId: row.surveyWindowId, surveyQuestionId: row.surveyQuestionId, sourceMessageId: input.inboundMessageId }) !== 'allowed') return null;
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
      const admittedAt = await this.orgNativeWindow(row.surveyWindowId) ? inbound.receivedAt : inbound.occurredAt;
      if (!admittedAt || (clarificationPromptSentAt && admittedAt <= clarificationPromptSentAt)) return null;
    }
    return {
      workingInsightId: row.workingInsightId,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: row.surveyWindowId,
      surveyQuestionId: row.surveyQuestionId,
      questionVersion: row.questionVersion,
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
      questionVersion: surveyQuestionWorkingInsights.questionVersion,
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
      questionVersion: first.questionVersion,
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
      questionVersion: surveyQuestionWorkingInsights.questionVersion,
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
      questionVersion: next.questionVersion,
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
  }): Promise<boolean | PulseReportCollectionUnavailable> {
    validateQuestionClarificationPrompt(input.displayedText);
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
        )).for('update').limit(1);
      if (!working) return false;
      const decision = await pulseReportAdmission(tx, { ...input, surveyWindowId: working.surveyWindowId, surveyQuestionId: working.surveyQuestionId });
      if (decision !== 'allowed') return { kind: 'collection_unavailable', reason: decision as PulseReportCollectionUnavailable['reason'] };
      if (working.status !== 'pending_clarification' || working.clarificationPromptMessageId || working.purgedAt) return false;
      if (working.clarificationAttempts >= MAX_QUESTION_CLARIFICATIONS) {
        throw new Error('v2_clarification_budget_exhausted');
      }
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
      // The delivered message may answer the employee first (GC round 3 CAP-4); the staged
      // question must still be shown exactly once, at the end.
      if (!scope || scope.windowStatus !== 'active' || scope.periodEnd <= new Date()
        || scope.messageSentAt || !isBundleShownIn(scope.messageText, input.displayedText)) {
        throw new Error('v2_clarification_prompt_scope_mismatch');
      }
      await tx.update(surveyQuestionWorkingInsights).set({
        clarificationPromptMessageId: input.promptMessageId,
        clarificationAttempts: working.clarificationAttempts + 1,
        updatedAt: new Date(),
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      return true;
    });
  }

  async applyQuestionClarificationVerdict(input: {
    nativeReportClaimToken?: string;
    tenantId: string; userId: string; conversationId: string;
    workingInsightId: string; inboundMessageId: string;
    verdict: Exclude<QuestionClarificationVerdict, { kind: 'unrelated' }>;
  }): Promise<boolean | PulseReportCollectionUnavailable> {
    if (input.verdict.kind === 'clarified' && !input.verdict.correctedSummary.trim()) {
      throw new Error('v2_clarification_summary_empty');
    }
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      await tx.execute(sql`select pulse_input_verify_claim(${input.tenantId}::uuid,${input.userId}::uuid,${input.inboundMessageId}::uuid,${input.nativeReportClaimToken ?? null}::uuid)`);
      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
        )).for('update').limit(1);
      if (!working) return false;
      const decision = await pulseReportAdmission(tx, { ...input, surveyWindowId: working.surveyWindowId, surveyQuestionId: working.surveyQuestionId, sourceMessageId: input.inboundMessageId });
      if (decision !== 'allowed') return { kind: 'collection_unavailable', reason: decision as PulseReportCollectionUnavailable['reason'] };
      if (working.status !== 'pending_clarification' || working.purgedAt || !working.clarificationPromptMessageId || !working.confirmationBundleId) return false;
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
      const [inbound] = await tx.select({ occurredAt: messages.occurredAt, receivedAt: messages.receivedAt })
        .from(messages).where(and(
          eq(messages.id, input.inboundMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      const admittedAt = inbound && (await this.orgNativeWindow(working.surveyWindowId, tx) ? inbound.receivedAt : inbound.occurredAt);
      const [window] = await tx.select({ periodEnd: surveyWindows.periodEnd, status: surveyWindows.status })
        .from(surveyWindows).where(and(
          eq(surveyWindows.id, working.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
        )).limit(1);
      if (!prompt?.sentAt || !inbound || !admittedAt || !window || window.status !== 'active'
        || admittedAt! <= prompt.sentAt || admittedAt! >= window.periodEnd) {
        throw new Error('v2_clarification_reply_scope_mismatch');
      }
      if (input.verdict.kind === 'clarified') {
        // GC round 3 CAP-3: the corrected meaning is not confirmed yet. It returns to collecting,
        // ready to be shown back as a one-statement bundle in the same reply; the correction
        // message joins its sources.
        await tx.update(surveyQuestionWorkingInsights).set({
          status: 'collecting',
          workingSummary: input.verdict.correctedSummary.trim(),
          sourceMessageIds: [...new Set([...working.sourceMessageIds, input.inboundMessageId])],
          confirmedSemanticSummary: null,
          confirmationMessageId: null,
          confirmedAt: null,
          // The old bundle link stays until the receipt below is written (its DB guard walks
          // working -> bundle -> prompt); staging the corrected statement replaces it.
          clarificationPromptMessageId: null,
          readyForConfirmation: true,
          updatedAt: admittedAt,
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
          purgedAt: admittedAt,
          updatedAt: admittedAt,
        }).where(eq(surveyQuestionWorkingInsights.id, working.id));
        await tx.update(pulseBacklog).set({
          status: 'done', doneAt: admittedAt,
          resultedInCoverage: false, updatedAt: admittedAt,
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
        ...(remaining.length ? {} : { purgedAt: admittedAt }),
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
    const native = await this.db.client.execute(sql`select w.inbound_receipt_id from survey_report_inbound_work w join survey_report_participants p on p.tenant_id=w.tenant_id and p.user_id=w.user_id join survey_cycle_scoring_policies c on c.id=p.cycle_scoring_policy_id join survey_report_cycle_openings o on o.cycle_scoring_policy_id=c.id where w.inbound_receipt_id=${input.inboundMessageId}::uuid and w.tenant_id=${input.tenantId}::uuid and w.user_id=${input.userId}::uuid and w.conversation_id=${input.conversationId}::uuid and w.trust='db-receipt-v1' and w.received_at>=greatest(c.period_start,o.opened_at) and w.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end)) limit 1`);
    if (native.length) {
      const forms = await this.db.client.execute(sql`select s.bundle_id,s.survey_window_id,s.survey_question_id,s.question_version,s.ordinal,s.component_hash,m.metadata,b.question_group,b.kind,
        case when s.full_body_hash is null then m.text else substring(m.text from s.form_start_character for s.form_character_length) end displayed_text,
        case when s.full_body_hash is null then encode(sha256(convert_to(m.text,'UTF8')),'hex')=s.form_hash
          else s.full_body_hash=encode(sha256(convert_to(m.text,'UTF8')),'hex') and s.form_start_character>0 and s.form_character_length>0
            and encode(sha256(convert_to(substring(m.text from s.form_start_character for s.form_character_length),'UTF8')),'hex')=s.form_hash end valid_form,
        encode(sha256(convert_to(m.metadata->'nativeShownComponents'->(s.ordinal-1)->>'statement','UTF8')),'hex')=s.component_hash valid_component
        from survey_report_inbound_work w join messages m on m.tenant_id=w.tenant_id and m.user_id=w.user_id and m.conversation_id=w.conversation_id and m.direction='outbound'
        join survey_report_shown_components s on s.prompt_message_id=m.id and s.tenant_id=m.tenant_id and s.user_id=m.user_id
        join survey_report_window_bindings binding on binding.survey_window_id=s.survey_window_id and binding.tenant_id=s.tenant_id
        join survey_question_confirmation_bundles b on b.id=s.bundle_id and b.survey_window_id=s.survey_window_id
        where w.inbound_receipt_id=${input.inboundMessageId}::uuid and w.tenant_id=${input.tenantId}::uuid and w.user_id=${input.userId}::uuid and m.deleted_at is null and s.body_disposition='retained' and s.sent_at<w.received_at and s.acknowledged_at<w.received_at
          and pulse_input_receipt_in_scope(w.tenant_id,w.user_id,binding.cycle_scoring_policy_id,w.received_at,null,false)
          and m.id=(select latest.id from messages latest where latest.tenant_id=w.tenant_id and latest.user_id=w.user_id and latest.conversation_id=w.conversation_id and latest.direction='outbound' and latest.sent_at<w.received_at and latest.delivery_recorded_at<w.received_at order by latest.sent_at desc,latest.id desc limit 1)
          and not exists(select 1 from messages ambiguous where ambiguous.tenant_id=w.tenant_id and ambiguous.user_id=w.user_id and ambiguous.conversation_id=w.conversation_id and ambiguous.direction='outbound' and engagement_delivery_ambiguous(ambiguous.persisted_at,ambiguous.delivery_attempted_at,ambiguous.delivery_recorded_at,w.received_at))
        order by s.ordinal`) as unknown as Record<string,unknown>[];
      if (!forms.length) {
        const missing=await this.db.client.execute(sql`select 1 from survey_report_inbound_work w join messages m on m.tenant_id=w.tenant_id and m.user_id=w.user_id and m.conversation_id=w.conversation_id and m.direction='outbound'
          join survey_question_confirmation_bundles bundle on bundle.prompt_message_id=m.id and bundle.tenant_id=m.tenant_id and bundle.user_id=m.user_id
          join survey_report_window_bindings binding on binding.survey_window_id=bundle.survey_window_id and binding.tenant_id=bundle.tenant_id
          where w.inbound_receipt_id=${input.inboundMessageId}::uuid and pulse_input_receipt_in_scope(w.tenant_id,w.user_id,binding.cycle_scoring_policy_id,w.received_at,null,false)
          and m.sent_at<w.received_at and m.delivery_recorded_at<w.received_at and m.deleted_at is null and not exists(select 1 from survey_report_shown_components s where s.prompt_message_id=m.id and s.body_disposition='deleted') and m.id=(select latest.id from messages latest where latest.tenant_id=w.tenant_id and latest.user_id=w.user_id and latest.conversation_id=w.conversation_id and latest.direction='outbound' and latest.sent_at<w.received_at and latest.delivery_recorded_at<w.received_at order by latest.sent_at desc,latest.id desc limit 1) limit 1`);
        if(missing.length)throw new Error('pulse_input_shown_form_proof_unavailable');
        return null;
      }
      const first=forms[0]!;
      const components=parseBundleComponents((first.metadata as Record<string,unknown>)['nativeShownComponents']);
      if (forms.some((f,i)=>!f.valid_form || !f.valid_component || f.bundle_id!==first.bundle_id || components[i]?.surveyQuestionId!==f.survey_question_id || components[i]?.questionVersion!==f.question_version) || components.length!==forms.length) throw new Error('pulse_input_shown_form_proof_unavailable');
      const kind=parseBundleKind(String(first.kind));
      let clarificationAttempts:number|undefined;
      if(kind==='corrected_statement') {
        const [linked]=await this.db.client.select({clarificationAttempts:surveyQuestionWorkingInsights.clarificationAttempts}).from(surveyQuestionWorkingInsights).where(and(
          eq(surveyQuestionWorkingInsights.tenantId,input.tenantId),eq(surveyQuestionWorkingInsights.userId,input.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId,String(first.survey_window_id)),eq(surveyQuestionWorkingInsights.confirmationBundleId,String(first.bundle_id)),isNull(surveyQuestionWorkingInsights.purgedAt),
        )).limit(1);
        clarificationAttempts=linked?.clarificationAttempts??MAX_QUESTION_CLARIFICATIONS;
      }
      return {id:String(first.bundle_id),tenantId:input.tenantId,userId:input.userId,surveyWindowId:String(first.survey_window_id),questionGroup:String(first.question_group),displayedText:String(first.displayed_text),components,kind,...(clarificationAttempts!==undefined?{clarificationAttempts}:{})};
    }
    const [inbound] = await this.db.client.select({ occurredAt: messages.occurredAt, receivedAt: messages.receivedAt })
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
      kind: surveyQuestionConfirmationBundles.kind,
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
        sql`${messages.sentAt} < case when exists(select 1 from survey_report_window_bindings b where b.survey_window_id = ${surveyWindows.id}) then ${inbound.receivedAt?.toISOString() ?? null}::timestamptz else ${inbound.occurredAt.toISOString()}::timestamptz end`,
      )).limit(2);
    if (bundles.length === 0) return null;
    if (bundles.length !== 1) throw new Error('v2_multiple_awaiting_question_bundles');
    const bundle = bundles[0];
    const admittedAt = await this.orgNativeWindow(bundle.surveyWindowId) ? inbound.receivedAt : inbound.occurredAt;
    if (!admittedAt || admittedAt >= bundle.periodEnd) return null;
    const originalComponents = parseBundleComponents(bundle.components);
    const permittedComponents = [];
    for (const component of originalComponents) {
      const decision = await this.collectionAdmission({ ...input, surveyWindowId: bundle.surveyWindowId, surveyQuestionId: component.surveyQuestionId, sourceMessageId: input.inboundMessageId });
      if (decision === 'allowed') permittedComponents.push(component);
      else if (decision !== 'lineage_excluded') return null;
    }
    if (!permittedComponents.length) return null;
    const kind = parseBundleKind(bundle.kind);
    let clarificationAttempts: number | undefined;
    if (kind === 'corrected_statement') {
      // A read never fails the turn: a missing link counts as a spent budget, and applying the
      // verdict then reports the stale working state through its own guard.
      const [linked] = await this.db.client.select({
        clarificationAttempts: surveyQuestionWorkingInsights.clarificationAttempts,
      }).from(surveyQuestionWorkingInsights).where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, bundle.surveyWindowId),
        eq(surveyQuestionWorkingInsights.confirmationBundleId, bundle.id),
        isNull(surveyQuestionWorkingInsights.purgedAt),
      )).limit(1);
      clarificationAttempts = linked?.clarificationAttempts ?? MAX_QUESTION_CLARIFICATIONS;
    }
    return {
      id: bundle.id,
      tenantId: input.tenantId,
      userId: input.userId,
      surveyWindowId: bundle.surveyWindowId,
      questionGroup: bundle.questionGroup,
      displayedText: bundle.displayedText!,
      components: originalComponents,
      kind,
      ...(clarificationAttempts !== undefined ? { clarificationAttempts } : {}),
    };
  }

  async applyQuestionBundleVerdict(input: {
    nativeReportClaimToken?: string;
    tenantId: string; userId: string; conversationId: string;
    inboundMessageId: string; bundleId: string;
    verdict: Exclude<QuestionBundleVerdict, { kind: 'unrelated' }>;
  }): Promise<boolean | PulseReportCollectionUnavailable> {
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      await tx.execute(sql`select pulse_input_verify_claim(${input.tenantId}::uuid,${input.userId}::uuid,${input.inboundMessageId}::uuid,${input.nativeReportClaimToken ?? null}::uuid)`);
      const [bundle] = await tx.select().from(surveyQuestionConfirmationBundles)
        .where(and(
          eq(surveyQuestionConfirmationBundles.id, input.bundleId),
          eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, input.userId),
        )).for('update').limit(1);
      if (!bundle) return false;
      if (await this.trustedNativeReceipt(input,bundle.surveyWindowId,tx) && input.verdict.kind==='agree' && !['pending_delivery','awaiting_confirmation'].includes(bundle.status)) {
        const exact=await tx.execute(sql`select s.* from survey_report_shown_components s join survey_report_inbound_work w on w.inbound_receipt_id=${input.inboundMessageId}::uuid and w.tenant_id=s.tenant_id and w.user_id=s.user_id where s.bundle_id=${bundle.id}::uuid and s.tenant_id=${input.tenantId}::uuid and s.user_id=${input.userId}::uuid and s.conversation_id=${input.conversationId}::uuid and s.sent_at<w.received_at and s.acknowledged_at<w.received_at and exists(select 1 from survey_report_component_verdicts v where v.prompt_message_id=s.prompt_message_id and v.ordinal=s.ordinal and v.outcome='accepted')`) as unknown as Record<string,unknown>[];
        const total=await tx.execute(sql`select count(*)::integer n from survey_report_shown_components where bundle_id=${bundle.id}::uuid`) as unknown as {n:number}[];
        if(!exact.length||exact.length!==total[0]?.n)throw new Error('pulse_input_stale_form_reconciliation');
        for(const form of exact)await tx.execute(sql`insert into survey_report_component_verdicts(tenant_id,user_id,inbound_receipt_id,prompt_message_id,ordinal,outcome)values(${input.tenantId}::uuid,${input.userId}::uuid,${input.inboundMessageId}::uuid,${String(form.prompt_message_id)}::uuid,${Number(form.ordinal)},'duplicate') on conflict do nothing`);
        await tx.insert(surveyQuestionVerdictReceipts).values({inboundMessageId:input.inboundMessageId,tenantId:input.tenantId,userId:input.userId,conversationId:input.conversationId,questionGroup:bundle.questionGroup,verdictKind:'agree',bundleId:bundle.id});
        return true;
      }
      if (!bundle.components && !['pending_delivery', 'awaiting_confirmation'].includes(bundle.status)) return false;
      if (await this.trustedNativeReceipt(input,bundle.surveyWindowId,tx)) {
        const proof=await tx.execute(sql`select 1 from survey_report_inbound_work w join survey_report_shown_components s on s.bundle_id=${bundle.id}::uuid and s.tenant_id=w.tenant_id and s.user_id=w.user_id and s.conversation_id=w.conversation_id where w.inbound_receipt_id=${input.inboundMessageId}::uuid and s.sent_at<w.received_at and s.acknowledged_at<w.received_at limit 1`);
        if(!proof.length)throw new Error('pulse_input_shown_form_proof_unavailable');
      }
      const originalComponents = parseBundleComponents(bundle.components);
      const excludedIds = new Set<string>();
      for (const component of originalComponents) {
        const decision = await pulseReportAdmission(tx, { ...input, surveyWindowId: bundle.surveyWindowId, surveyQuestionId: component.surveyQuestionId, sourceMessageId: input.inboundMessageId });
        if (decision === 'lineage_excluded') excludedIds.add(component.surveyQuestionId);
        else if (decision !== 'allowed') return { kind: 'collection_unavailable', reason: decision as PulseReportCollectionUnavailable['reason'] };
      }
      const components = originalComponents.filter((component) => !excludedIds.has(component.surveyQuestionId));
      if (!components.length) return { kind: 'collection_unavailable', reason: 'lineage_excluded' };
      if (!['pending_delivery', 'awaiting_confirmation'].includes(bundle.status)) return false;
      const supplied = input.verdict;
      let verdict: QuestionBundleVerdict;
      if (supplied.kind === 'partial') {
        const projection = {
          kind: 'partial' as const,
          acceptedQuestionIds: supplied.acceptedQuestionIds.filter((id) => !excludedIds.has(id)),
          disputedQuestionIds: supplied.disputedQuestionIds.filter((id) => !excludedIds.has(id)),
          declinedQuestionIds: supplied.declinedQuestionIds.filter((id) => !excludedIds.has(id)),
        };
        // Validate original identity boundaries before accepting a surviving subset of an older prepared verdict.
        validateQuestionBundleVerdict({ ...projection, declinedQuestionIds: [...projection.declinedQuestionIds, ...excludedIds] }, originalComponents.map((component) => component.surveyQuestionId));
        verdict = validateQuestionBundleVerdict(projection, components.map((component) => component.surveyQuestionId));
      } else verdict = validateQuestionBundleVerdict(supplied, components.map((component) => component.surveyQuestionId));
      if (verdict.kind === 'unrelated') return false;

      const [inbound] = await tx.select({ occurredAt: messages.occurredAt, receivedAt: messages.receivedAt })
        .from(messages).where(and(
          eq(messages.id, input.inboundMessageId),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      const admittedAt = inbound && (await this.orgNativeWindow(bundle.surveyWindowId, tx) ? inbound.receivedAt : inbound.occurredAt);
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
      const nativeWindow=await this.orgNativeWindow(bundle.surveyWindowId,tx);
      if (!inbound || !admittedAt || !prompt?.sentAt || !window || !nativeWindow && (window.status !== 'active'
        || admittedAt! <= prompt.sentAt || admittedAt! >= window.periodEnd)) {
        throw new Error('v2_confirmation_reply_scope_mismatch');
      }

      const linkedWorking = await tx.select().from(surveyQuestionWorkingInsights).where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, bundle.surveyWindowId),
        eq(surveyQuestionWorkingInsights.confirmationBundleId, bundle.id),
      )).orderBy(surveyQuestionWorkingInsights.id).for('update');
      const working = linkedWorking.filter((row) => !excludedIds.has(row.surveyQuestionId));
      if (working.length !== components.length || working.some((row) => row.status !== 'pending_confirmation'
        || !components.some((component) => component.surveyQuestionId === row.surveyQuestionId
          && component.questionVersion === row.questionVersion))) {
        throw new Error('v2_confirmation_working_state_stale');
      }
      // GC round 3 S4b: a corrected meaning (one that used a clarification) is never reset, and a
      // dispute needs clarification budget. Checked per row, whatever the bundle kind says.
      if (verdict.kind === 'reject' && working.some((row) => row.clarificationAttempts > 0)) {
        throw new Error('v2_corrected_statement_reject_unmapped');
      }
      if (verdict.kind === 'partial' && working.some((row) => verdict.disputedQuestionIds.includes(row.surveyQuestionId)
        && row.clarificationAttempts >= MAX_QUESTION_CLARIFICATIONS)) {
        throw new Error('v2_clarification_budget_exhausted');
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
            confirmedAt: admittedAt,
            readyForConfirmation: false,
            updatedAt: admittedAt,
          }).where(eq(surveyQuestionWorkingInsights.id, row.id));
        } else if (outcome === 'disputed') {
          await tx.update(surveyQuestionWorkingInsights).set({
            status: 'pending_clarification',
            readyForConfirmation: false,
            updatedAt: admittedAt,
          }).where(eq(surveyQuestionWorkingInsights.id, row.id));
        } else {
          await tx.update(surveyQuestionWorkingInsights).set({
            status: outcome === 'reset' ? 'reset' : 'declined',
            ...(outcome === 'reset' ? { clarificationAttempts: 0 } : {}),
            workingSummary: null,
            confirmedSemanticSummary: null,
            sourceMessageIds: [],
            clarificationPromptMessageId: null,
            confirmationMessageId: null,
            confirmedAt: null,
            readyForConfirmation: false,
            purgedAt: admittedAt,
            updatedAt: admittedAt,
          }).where(eq(surveyQuestionWorkingInsights.id, row.id));
          await tx.update(pulseBacklog).set(outcome === 'reset' ? {
            status: 'pending', doneAt: null, evidenceCapturedCount: 0,
            resultedInCoverage: null, updatedAt: admittedAt,
          } : {
            status: 'done', doneAt: admittedAt,
            resultedInCoverage: false, updatedAt: admittedAt,
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
        components: verdict.kind === 'partial' && needsClarification
          ? components.filter((component) => verdict.disputedQuestionIds.includes(component.surveyQuestionId))
          : null,
        ...(needsClarification ? {} : { purgedAt: admittedAt }),
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

  async hasReadyQuestionBundle(input: { tenantId: string; userId: string }): Promise<boolean> {
    return (await this.findReadyQuestionBundle(input)) !== null;
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
    if (await this.collectionAdmission({ ...input, surveyWindowId: window.id }) !== 'allowed') return null;
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
      clarificationAttempts: surveyQuestionWorkingInsights.clarificationAttempts,
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
      const excludedIds = new Set<string>();
      for (const question of groupQuestions) {
        const decision = await this.collectionAdmission({ ...input, surveyWindowId: window.id, surveyQuestionId: question.id });
        if (decision === 'lineage_excluded') excludedIds.add(question.id);
        else if (decision !== 'allowed') return null;
      }
      const rows = groupQuestions.map((question) => byQuestion.get(question.id));
      const ready = rows.map((row, index) => ({ row, question: groupQuestions[index]! }))
        .filter(({ row, question }) => !excludedIds.has(question.id) && row?.status === 'collecting' && row.readyForConfirmation
          && row.workingSummary?.trim() && row.purgedAt === null);
      // GC round 3 S4b: a clarified meaning not yet shown back travels alone as a corrected statement;
      // its siblings may already be confirmed or declined.
      const corrected = ready.find(({ row }) => row!.clarificationAttempts > 0);
      if (ready.length === 0 || rows.some((row, index) => {
        if (excludedIds.has(groupQuestions[index]!.id)) return false;
        return !row || row.questionVersion !== groupQuestions[index]!.version
          || (!ready.some((item) => item.row === row)
            && !(row.status === 'confirmed' && row.purgedAt && row.finalizedAt)
            && !(corrected && row.status === 'declined' && row.purgedAt));
      })) continue;
      if (corrected) {
        return {
          ...input,
          surveyWindowId: window.id,
          questionGroup,
          kind: 'corrected_statement',
          questions: [{
            surveyQuestionId: corrected.question.id,
            questionVersion: corrected.question.version,
            workingSummary: corrected.row!.workingSummary!,
          }],
        };
      }
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
  }): Promise<string | PulseReportCollectionUnavailable> {
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
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      for (const surveyQuestionId of input.components.map((component) => component.surveyQuestionId)) {
        const decision = await pulseReportAdmission(tx, { ...input, surveyQuestionId });
        if (decision !== 'allowed') return { kind: 'collection_unavailable', reason: decision as PulseReportCollectionUnavailable['reason'] };
      }
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
      // The delivered message may answer the employee first (GC round 3 CAP-4); the staged
      // bundle must still be shown exactly once, at the end.
      if (!scope || scope.windowStatus !== 'active' || scope.periodEnd <= new Date()
        || scope.messageSentAt || !isBundleShownIn(scope.messageText, input.displayedText, {
          statements: input.components.map((component) => component.statement),
        })) {
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

      const excludedIds = new Set<string>();
      for (const question of questions) {
        if (await pulseReportAdmission(tx, { ...input, surveyQuestionId: question.id }) === 'lineage_excluded') excludedIds.add(question.id);
      }
      const working = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
          eq(surveyQuestionWorkingInsights.userId, input.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
          inArray(surveyQuestionWorkingInsights.surveyQuestionId, questions.map((question) => question.id)),
        )).orderBy(surveyQuestionWorkingInsights.surveyQuestionId).for('update');
      const selected = working.filter((row) => input.components.some(
        (component) => component.surveyQuestionId === row.surveyQuestionId));
      // GC round 3 S4b: the kind follows the meaning. A clarified meaning is shown alone, and other
      // ready meanings of its group wait for a later bundle.
      const correctedSelection = selected.some((row) => row.clarificationAttempts > 0);
      if (correctedSelection && selected.length !== 1) {
        throw new Error('v2_confirmation_bundle_invalid_composition');
      }
      if (working.filter((row) => !excludedIds.has(row.surveyQuestionId)).length !== questions.length - excludedIds.size || selected.length !== input.components.length
        || working.some((row) => {
        if (excludedIds.has(row.surveyQuestionId)) return false;
          const component = input.components.find((item) => item.surveyQuestionId === row.surveyQuestionId);
          return component
            ? row.status !== 'collecting' || !row.readyForConfirmation
              || !row.workingSummary?.trim() || row.sourceMessageIds.length === 0 || row.purgedAt !== null
              || component.questionVersion !== row.questionVersion
              || component.expectedWorkingSummary !== row.workingSummary
            : !(row.status === 'confirmed' && row.purgedAt && row.finalizedAt)
              && !(correctedSelection && row.status === 'collecting' && !row.confirmationBundleId)
              && !(correctedSelection && row.status === 'declined' && row.purgedAt);
        })) {
        throw new Error('v2_confirmation_bundle_working_state_stale');
      }

      const [bundle] = await tx.insert(surveyQuestionConfirmationBundles).values({
        tenantId: input.tenantId,
        userId: input.userId,
        surveyWindowId: input.surveyWindowId,
        questionGroup: input.questionGroup,
        version: `message:${input.promptMessageId}`,
        kind: correctedSelection ? 'corrected_statement' : 'confirmation',
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

  /**
   * GC round 3 CAP-3: after a `clarified` verdict the corrected statement is shown back as a
   * one-statement bundle linked to the same working row; other statements of the group may still
   * wait for clarification. The bundle then follows the ordinary verdict path.
   */
  async stageCorrectedStatementConfirmation(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    surveyWindowId: string;
    questionGroup: string;
    workingInsightId: string;
    surveyQuestionId: string;
    questionVersion: string;
    promptMessageId: string;
    displayedText: string;
    statement: string;
    expectedWorkingSummary: string;
  }): Promise<string | PulseReportCollectionUnavailable> {
    if (!(V2_QUESTION_GROUPS as readonly string[]).includes(input.questionGroup)
      || !input.displayedText.trim() || !input.statement.trim() || !input.expectedWorkingSummary.trim()
      || !input.questionVersion.trim() || input.displayedText.split(input.statement).length !== 2) {
      throw new Error('v2_corrected_statement_invalid_composition');
    }
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      for (const surveyQuestionId of [input.surveyQuestionId]) {
        const decision = await pulseReportAdmission(tx, { ...input, surveyQuestionId });
        if (decision !== 'allowed') return { kind: 'collection_unavailable', reason: decision as PulseReportCollectionUnavailable['reason'] };
      }
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
        || scope.messageSentAt || !isBundleShownIn(scope.messageText, input.displayedText, {
          statements: [input.statement],
        })) {
        throw new Error('v2_corrected_statement_scope_mismatch');
      }
      const [anotherBundle] = await tx.select({ id: surveyQuestionConfirmationBundles.id })
        .from(surveyQuestionConfirmationBundles).where(and(
          eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, input.userId),
          eq(surveyQuestionConfirmationBundles.surveyWindowId, input.surveyWindowId),
          inArray(surveyQuestionConfirmationBundles.status, ['pending_delivery', 'awaiting_confirmation']),
        )).limit(1);
      if (anotherBundle) throw new Error('v2_corrected_statement_already_unresolved');
      const [working] = await tx.select().from(surveyQuestionWorkingInsights).where(and(
        eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
      )).for('update').limit(1);
      if (!working || working.surveyQuestionId !== input.surveyQuestionId
        || working.questionVersion !== input.questionVersion
        || working.status !== 'collecting' || !working.readyForConfirmation
        || working.workingSummary !== input.expectedWorkingSummary
        || working.purgedAt !== null || working.sourceMessageIds.length === 0) {
        throw new Error('v2_corrected_statement_working_state_stale');
      }
      const [bundle] = await tx.insert(surveyQuestionConfirmationBundles).values({
        tenantId: input.tenantId,
        userId: input.userId,
        surveyWindowId: input.surveyWindowId,
        questionGroup: input.questionGroup,
        version: `message:${input.promptMessageId}`,
        kind: 'corrected_statement',
        displayedText: input.displayedText,
        components: [{
          surveyQuestionId: input.surveyQuestionId,
          questionVersion: input.questionVersion,
          statement: input.statement,
          sourceMessageIds: working.sourceMessageIds,
        }],
        promptMessageId: input.promptMessageId,
      }).returning({ id: surveyQuestionConfirmationBundles.id });
      await tx.update(surveyQuestionWorkingInsights).set({
        status: 'pending_confirmation',
        confirmationBundleId: bundle.id,
        updatedAt: new Date(),
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      return bundle.id;
    });
  }

  /** GC round 3 CAP-3: per-question statuses of the active V2 window; null without one. */
  async findCycleProgress(input: { tenantId: string; userId: string }): Promise<CycleProgressSnapshot | null> {
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
    const window = windows[0]!;
    if (window.periodEnd <= new Date()) return null;
    if (await this.collectionAdmission({ ...input, surveyWindowId: window.id }) !== 'allowed') return null;
    if (await this.getWindowMode({ ...input, surveyWindowId: window.id }) !== 'v2') return null;
    const questions = await this.db.client.select({
      id: surveyQuestions.id,
      questionGroup: surveyQuestions.questionGroup,
      displayOrder: surveyQuestions.displayOrder,
    }).from(surveyQuestions).where(and(
      eq(surveyQuestions.surveyDefinitionId, window.surveyDefinitionId),
      eq(surveyQuestions.responseType, 'open_ended'),
      inArray(surveyQuestions.questionGroup, [...V2_QUESTION_GROUPS]),
    ));
    const working = await this.db.client.select({
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
      status: surveyQuestionWorkingInsights.status,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
      eq(surveyQuestionWorkingInsights.userId, input.userId),
      eq(surveyQuestionWorkingInsights.surveyWindowId, window.id),
    ));
    const statusByQuestion = new Map(working.map((row) => [row.surveyQuestionId, row.status]));
    return {
      surveyWindowId: window.id,
      // Mirrors findReadyQuestionBundle: a group is a topic of this cycle only with its three questions.
      groups: V2_QUESTION_GROUPS.flatMap((questionGroup) => {
        const groupQuestions = questions.filter((question) => question.questionGroup === questionGroup)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        return groupQuestions.length === 3
          ? [{
              questionGroup,
              questions: groupQuestions.map((question) => ({
                surveyQuestionId: question.id, status: statusByQuestion.get(question.id) ?? 'no_data',
              })),
            }]
          : [];
      }),
    };
  }

  async activateDeliveredQuestionBundle(input: {
    promptMessageId: string; tenantId: string; conversationId: string; deliveredAt: Date;
  }): Promise<void> {
    await this.db.client.transaction(async (tx) => {
      const [subject] = await tx.select({ userId: messages.userId }).from(messages).where(and(eq(messages.id, input.promptMessageId), eq(messages.tenantId, input.tenantId))).limit(1);
      if (!subject) return;
      await lockPulseReportSubject(tx, input.tenantId, subject.userId);
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
      if (window && ['v2-policy-1.0.0', 'v2-report-engagement-1.0.0'].includes(window.definitionVersion)) {
        throw new Error('v2_window_policy_binding_missing');
      }
      return 'v1';
    }
    if (bound.windowStatus !== 'active' && !await this.orgNativeWindow(input.surveyWindowId)) throw new Error('v2_survey_window_inactive');

    const questions = await this.db.client.select({
      id: surveyQuestions.id,
      stableKey: surveyQuestions.stableKey,
      responseType: surveyQuestions.responseType,
      questionGroup: surveyQuestions.questionGroup,
      title: surveyQuestions.title,
      canonicalMeaning: surveyQuestions.canonicalMeaning,
      version: surveyQuestions.version,
    }).from(surveyQuestions)
      .where(eq(surveyQuestions.surveyDefinitionId, bound.surveyDefinitionId));
    const contracts = bound.definitionVersion === 'v2-report-engagement-1.0.0' ? await this.db.client.select().from(surveyEngagementContractQuestions).where(eq(surveyEngagementContractQuestions.surveyDefinitionId, bound.surveyDefinitionId)) : [];
    const [collection] = bound.definitionVersion === 'v2-report-engagement-1.0.0' ? await this.db.client.select().from(surveyEngagementCollectionContracts).where(and(eq(surveyEngagementCollectionContracts.surveyDefinitionId, bound.surveyDefinitionId), eq(surveyEngagementCollectionContracts.tenantId, input.tenantId))) : [];
    if (!(bound.policyVersion === '1.0.0'
      ? ['v2-policy-1.0.0', 'v2-report-engagement-1.0.0'].includes(bound.definitionVersion)
        && (bound.definitionVersion === 'v2-report-engagement-1.0.0' ? collection && hasCompleteReportEngagementPolicy(questions, bound.rubrics, contracts) : hasCompleteV2ScoringPolicy(questions, bound.rubrics))
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
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      if (await pulseReportAdmission(tx, input) !== 'allowed') return false;
      const native = await this.orgNativeWindow(input.surveyWindowId, tx);
      const [scope] = await tx.select({
        periodStart: surveyWindows.periodStart,
        periodEnd: surveyWindows.periodEnd,
        sourceOccurredAt: sql<Date>`case when exists(select 1 from survey_report_window_bindings b where b.survey_window_id = ${surveyWindows.id}) then ${messages.receivedAt} else ${messages.occurredAt} end`.mapWith(messages.occurredAt),
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
          ...(native ? [] : [eq(surveyWindows.status, 'active')]),
          ...(native ? [] : [gt(surveyWindows.periodEnd, new Date())]),
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
        sourceMessageIds: [], readyForConfirmation: false, clarificationAttempts: 0,
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

  /** GC round 3 CAP-1, CAP-2: per-question V2 working state of one window for topic selection. */
  async findQuestionCoverage(input: { tenantId: string; userId: string; surveyWindowId: string }):
    Promise<QuestionWorkingCoverage[]> {
    const rows = await this.db.client.select({
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
      questionVersion: surveyQuestionWorkingInsights.questionVersion,
      status: surveyQuestionWorkingInsights.status,
      readyForConfirmation: surveyQuestionWorkingInsights.readyForConfirmation,
      meaningSufficient: surveyQuestionWorkingInsights.meaningSufficient,
      driverResolved: surveyQuestionWorkingInsights.driverResolved,
      driverRequestedAt: surveyQuestionWorkingInsights.driverRequestedAt,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
      eq(surveyQuestionWorkingInsights.userId, input.userId),
      eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
    ));
    return rows.map((row) => {
      const driverRequested = row.driverRequestedAt !== null;
      return {
        surveyQuestionId: row.surveyQuestionId,
        questionVersion: row.questionVersion,
        status: row.status,
        readyForConfirmation: row.readyForConfirmation,
        needsDriver: needsDriver({ ...row, driverRequested }),
        driverRequested,
      };
    });
  }

  /** GC round 3 CAP-2: the driver is asked at most once per question and window. */
  async recordDriverRequested(input: {
    tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId: string; requestedAt: Date;
  }): Promise<boolean> {
    return this.db.client.transaction(async (tx) => {
    if (await pulseReportAdmission(tx, input) !== 'allowed') return false;
    const updated = await tx.update(surveyQuestionWorkingInsights)
      .set({ driverRequestedAt: input.requestedAt, updatedAt: input.requestedAt })
      .where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
        eq(surveyQuestionWorkingInsights.surveyQuestionId, input.surveyQuestionId),
        eq(surveyQuestionWorkingInsights.status, 'collecting'),
        isNull(surveyQuestionWorkingInsights.driverRequestedAt),
      )).returning({ id: surveyQuestionWorkingInsights.id });
    return updated.length > 0;
    });
  }

  /**
   * GC round 3 CAP-2: an explicit decline to say what drives a captured status resolves the driver
   * (honoured on the first refusal). Only a newer in-period employee message of the same
   * conversation counts; the working summary is not touched.
   */
  async recordDriverDeclined(input: {
    tenantId: string; userId: string; conversationId: string; surveyWindowId: string;
    surveyQuestionId: string; questionVersion: string; sourceMessageId: string;
  }): Promise<boolean> {
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      if (await pulseReportAdmission(tx, input) !== 'allowed') return false;
      const native = await this.orgNativeWindow(input.surveyWindowId, tx);
      const [scope] = await tx.select({
        periodStart: surveyWindows.periodStart,
        periodEnd: surveyWindows.periodEnd,
        sourceOccurredAt: sql<Date>`case when exists(select 1 from survey_report_window_bindings b where b.survey_window_id = ${surveyWindows.id}) then ${messages.receivedAt} else ${messages.occurredAt} end`.mapWith(messages.occurredAt),
      }).from(surveyWindows)
        .innerJoin(messages, eq(messages.id, input.sourceMessageId))
        .where(and(
          eq(surveyWindows.id, input.surveyWindowId),
          eq(surveyWindows.tenantId, input.tenantId),
          eq(surveyWindows.userId, input.userId),
          ...(native ? [] : [eq(surveyWindows.status, 'active')]),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'inbound'),
          isNull(messages.deletedAt),
        )).limit(1);
      if (!scope || (!native && scope.periodEnd <= new Date()) || scope.sourceOccurredAt < scope.periodStart
        || scope.sourceOccurredAt >= scope.periodEnd) return false;
      const [working] = await tx.select().from(surveyQuestionWorkingInsights).where(and(
        eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
        eq(surveyQuestionWorkingInsights.userId, input.userId),
        eq(surveyQuestionWorkingInsights.surveyWindowId, input.surveyWindowId),
        eq(surveyQuestionWorkingInsights.surveyQuestionId, input.surveyQuestionId),
        eq(surveyQuestionWorkingInsights.questionVersion, input.questionVersion),
      )).for('update').limit(1);
      if (!working || working.status !== 'collecting' || working.purgedAt !== null
        || working.driverResolved || working.sourceMessageIds.includes(input.sourceMessageId)) return false;
      const sourceClock = native ? messages.receivedAt : messages.occurredAt;
      const [latestSource] = working.sourceMessageIds.length === 0 ? [] : await tx.select({ admittedAt: sourceClock })
        .from(messages).where(and(inArray(messages.id, working.sourceMessageIds), eq(messages.tenantId, input.tenantId), eq(messages.userId, input.userId)))
        .orderBy(desc(sourceClock)).limit(1);
      if ((native && working.sourceMessageIds.length > 0 && !latestSource?.admittedAt)
        || (latestSource?.admittedAt && scope.sourceOccurredAt <= latestSource.admittedAt)) return false;
      await tx.update(surveyQuestionWorkingInsights).set({
        driverResolved: true,
        readyForConfirmation: working.readyForConfirmation || working.meaningSufficient,
        updatedAt: new Date(),
      }).where(eq(surveyQuestionWorkingInsights.id, working.id));
      return true;
    });
  }

  async captureMeaning(input: CaptureQuestionMeaningInput): Promise<'captured' | 'ignored'> {
    const meaning = input.meaning.trim();
    if (!meaning || !input.questionVersion.trim()) return 'ignored';
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      if (await pulseReportAdmission(tx, input) !== 'allowed') return 'ignored';
      const native = await this.orgNativeWindow(input.surveyWindowId, tx);
      const [scope] = await tx.select({
        periodStart: surveyWindows.periodStart,
        periodEnd: surveyWindows.periodEnd,
        sourceOccurredAt: sql<Date>`case when exists(select 1 from survey_report_window_bindings b where b.survey_window_id = ${surveyWindows.id}) then ${messages.receivedAt} else ${messages.occurredAt} end`.mapWith(messages.occurredAt),
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
          ...(native ? [] : [eq(surveyWindows.status, 'active')]),
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
      if (!scope || (!native && scope.periodEnd <= new Date()) || scope.sourceOccurredAt < scope.periodStart
        || scope.sourceOccurredAt >= scope.periodEnd) return 'ignored';

      const [currentInsight] = native
        ? await tx.select({ confirmedAt: surveyReportInsightRevisions.confirmationReceivedAt }).from(surveyQuestionInsights)
          .leftJoin(surveyReportInsightRevisions, eq(surveyReportInsightRevisions.insightId, surveyQuestionInsights.id))
        .where(and(
          eq(surveyQuestionInsights.tenantId, input.tenantId), eq(surveyQuestionInsights.userId, input.userId),
          eq(surveyQuestionInsights.surveyWindowId, input.surveyWindowId), eq(surveyQuestionInsights.surveyQuestionId, input.surveyQuestionId),
          eq(surveyQuestionInsights.questionVersion, input.questionVersion), eq(surveyQuestionInsights.isCurrent, true),
        )).limit(1)
        : await tx.select({ confirmedAt: surveyQuestionInsights.confirmedAt }).from(surveyQuestionInsights)
        .where(and(
          eq(surveyQuestionInsights.tenantId, input.tenantId), eq(surveyQuestionInsights.userId, input.userId),
          eq(surveyQuestionInsights.surveyWindowId, input.surveyWindowId), eq(surveyQuestionInsights.surveyQuestionId, input.surveyQuestionId),
          eq(surveyQuestionInsights.questionVersion, input.questionVersion), eq(surveyQuestionInsights.isCurrent, true),
        )).limit(1);
      if (currentInsight && (!currentInsight.confirmedAt || scope.sourceOccurredAt <= currentInsight.confirmedAt)) return 'ignored';

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
          ...readinessColumns(accumulateQuestionReadiness(null, input)),
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
      // GC round 3 CAP-2: ready only with sufficient meaning and a driver or decline, which may
      // arrive in different messages. A row already ready (including legacy rows) stays ready.
      const readiness = accumulateQuestionReadiness(reopened ? null : working, input);
      await tx.update(surveyQuestionWorkingInsights).set({
        status: 'collecting',
        ...readinessColumns(readiness),
        ...(reopened ? {} : { readyForConfirmation: working.readyForConfirmation || readiness.ready }),
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
          clarificationAttempts: 0,
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

  private pendingFinalizationScope(scope?: QuestionFinalizationScope) {
    if (!scope) return undefined;
    const native = sql`exists(select 1 from survey_report_window_bindings binding
      where binding.survey_window_id=${surveyQuestionWorkingInsights.surveyWindowId}
        and binding.tenant_id=${surveyQuestionWorkingInsights.tenantId})`;
    return scope === 'native_only' ? native : sql`not (${native})`;
  }

  async listPendingConfirmedUsers(input?: { scope?: QuestionFinalizationScope }): Promise<Array<{ tenantId: string; userId: string }>> {
    return this.db.client.selectDistinct({
      tenantId: surveyQuestionWorkingInsights.tenantId,
      userId: surveyQuestionWorkingInsights.userId,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.status, 'confirmed'),
      isNull(surveyQuestionWorkingInsights.purgedAt),
      isNotNull(surveyQuestionWorkingInsights.confirmedSemanticSummary),
      this.pendingFinalizationScope(input?.scope),
    )).orderBy(surveyQuestionWorkingInsights.tenantId, surveyQuestionWorkingInsights.userId);
  }

  async listPendingConfirmedQuestions(input: {
    tenantId: string; userId: string; scope?: QuestionFinalizationScope;
  }): Promise<Array<{ surveyWindowId: string; surveyQuestionId: string }>> {
    return this.db.client.select({
      surveyWindowId: surveyQuestionWorkingInsights.surveyWindowId,
      surveyQuestionId: surveyQuestionWorkingInsights.surveyQuestionId,
    }).from(surveyQuestionWorkingInsights).where(and(
      eq(surveyQuestionWorkingInsights.tenantId, input.tenantId),
      eq(surveyQuestionWorkingInsights.userId, input.userId),
      eq(surveyQuestionWorkingInsights.status, 'confirmed'),
      isNull(surveyQuestionWorkingInsights.purgedAt),
      this.pendingFinalizationScope(input.scope),
    )).orderBy(surveyQuestionWorkingInsights.confirmedAt);
  }

  async cacheAssessment(input: { context: QuestionFinalizationContext; assessment: QuestionScoreResult }): Promise<QuestionScoreResult | null> {
    const c = input.context;
    return this.db.client.transaction(async tx => {
      await lockPulseReportSubject(tx, c.tenantId, c.userId);
      const rows = await tx.execute(sql`update survey_question_working_insights set score_cache=coalesce(score_cache,${JSON.stringify(input.assessment)}::jsonb),score_cache_revision=updated_at where id=${c.workingInsightId}::uuid and tenant_id=${c.tenantId}::uuid and user_id=${c.userId}::uuid and updated_at=${c.workingRevision ?? c.workingUpdatedAt.toISOString()}::timestamptz and status='confirmed' and purged_at is null returning score_cache`) as unknown as { score_cache: QuestionScoreResult }[];
      return rows[0]?.score_cache ?? null;
    });
  }

  async loadConfirmedQuestion(input: {
    tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId: string;
  }): Promise<QuestionFinalizationContext | 'already_finalized' | null> {
    const [row] = await this.db.client.select({
      working: surveyQuestionWorkingInsights,
      workingRevision: sql<string>`${surveyQuestionWorkingInsights.updatedAt}::text`,
      scoreCacheCurrent: sql<boolean>`${surveyQuestionWorkingInsights.scoreCacheRevision} = ${surveyQuestionWorkingInsights.updatedAt}`,
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
    for (const sourceMessageId of [...row.working.sourceMessageIds, row.working.confirmationMessageId]) {
      const decision = await this.collectionAdmission({ ...input, ...(sourceMessageId ? { sourceMessageId } : {}) });
      if (decision !== 'allowed') return null;
    }
    // GC round 3 CAP-3: proof that the employee saw and confirmed this exact statement.
    const [receipt] = row.working.confirmationBundleId && row.working.confirmationMessageId
      ? await this.db.client.select({ inboundMessageId: surveyQuestionVerdictReceipts.inboundMessageId })
        .from(surveyQuestionVerdictReceipts).where(and(
          eq(surveyQuestionVerdictReceipts.tenantId, input.tenantId),
          eq(surveyQuestionVerdictReceipts.userId, input.userId),
          eq(surveyQuestionVerdictReceipts.bundleId, row.working.confirmationBundleId),
          eq(surveyQuestionVerdictReceipts.inboundMessageId, row.working.confirmationMessageId),
          inArray(surveyQuestionVerdictReceipts.verdictKind, ['agree', 'partial']),
        )).limit(1)
      : [];
    const [existing] = await this.db.client.select({ id: surveyQuestionInsights.id })
      .from(surveyQuestionInsights).where(and(
        eq(surveyQuestionInsights.workingInsightId, row.working.id),
        eq(surveyQuestionInsights.confirmedAt, row.working.confirmedAt),
      )).limit(1);
    if (existing) return 'already_finalized';
    if (!row.working.confirmedSemanticSummary
      || row.working.purgedAt || row.question.version !== row.working.questionVersion
      || row.question.surveyDefinitionId !== row.window.surveyDefinitionId
      || (!await this.orgNativeWindow(row.window.id) && (row.working.confirmedAt < row.window.periodStart
      || row.working.confirmedAt >= row.window.periodEnd))) return null;

    const rubric = rubricForQuestion(row.policy.rubrics, row.question.stableKey);
    const knownIdentifiers = await this.teamRepository.findCurrentHierarchyIdentifiers(input.userId, input.tenantId);
    const externalSources = row.working.sourceMessageIds.length
      ? await this.db.client.select({ id: messages.id, receivedAt: sql<string | null>`${messages.receivedAt}::text`, externalMessageId: messages.externalMessageId })
        .from(messages).where(and(
          inArray(messages.id, row.working.sourceMessageIds),
          eq(messages.tenantId, input.tenantId),
          eq(messages.userId, input.userId),
          eq(messages.direction, 'inbound'),
        ))
      : [];
    let reportAdmissionProof: PulseReportAdmissionInput[] | undefined;
    if (await this.orgNativeWindow(input.surveyWindowId)) {
      const states = await this.db.client.execute(sql`select opening.opened_at::text, participant.collection_stopped_at::text, cycle.period_start::text, cycle.period_end::text,
        coalesce(permission.full_reporting_denied, false) as full_denied,
        exists(select 1 from survey_report_question_lineages lineage join survey_reporting_lineage_exclusions exclusion on exclusion.lineage_id = lineage.id and exclusion.tenant_id = lineage.tenant_id and exclusion.user_id = lineage.user_id where lineage.tenant_id = ${input.tenantId}::uuid and lineage.user_id = ${input.userId}::uuid and lineage.cycle_scoring_policy_id = binding.cycle_scoring_policy_id and lineage.survey_question_id = ${input.surveyQuestionId}::uuid) as lineage_excluded
        from survey_report_window_bindings binding
        join survey_cycle_scoring_policies cycle on cycle.id=binding.cycle_scoring_policy_id and cycle.tenant_id=binding.tenant_id
        join survey_report_cycle_openings opening on opening.cycle_scoring_policy_id = binding.cycle_scoring_policy_id and opening.tenant_id = binding.tenant_id
        join survey_report_participants participant on participant.id = binding.participant_id and participant.tenant_id = binding.tenant_id
        left join survey_reporting_permissions permission on permission.tenant_id = participant.tenant_id and permission.user_id = participant.user_id
        where binding.survey_window_id = ${input.surveyWindowId}::uuid and binding.tenant_id = ${input.tenantId}::uuid and participant.user_id = ${input.userId}::uuid`) as unknown as { opened_at: string | Date; collection_stopped_at: string | Date | null; period_start:string;period_end:string; full_denied: boolean; lineage_excluded: boolean }[];
      const state = states[0];
      if (!state) return null;
      const [confirmation] = await this.db.client.select({ receivedAt: sql<string|null>`${messages.receivedAt}::text` }).from(messages).where(and(eq(messages.id, row.working.confirmationMessageId!), eq(messages.tenantId, input.tenantId), eq(messages.userId, input.userId), eq(messages.direction, 'inbound'))).limit(1);
      reportAdmissionProof = externalSources.map((source) => ({ periodStart: state.period_start, periodEnd: state.period_end, openedAt: state.opened_at, collectionStoppedAt: state.collection_stopped_at, fullReportingDenied: state.full_denied, lineageExcluded: state.lineage_excluded, receivedAt: source.receivedAt, confirmationReceivedAt: confirmation?.receivedAt ?? null }));
      if (!reportAdmissionProof.length) return null;
    }
    let languageCapture = row.working.languageCapture as { locale: string; configRevision: number } | null;
    if (!languageCapture) {
      const configSource=await readReportConfigSource(this.db.client,input.tenantId),configHead=await readReportConfigHead(this.db.client,input.tenantId);
      const companyLocale=canonicalCompanyLocale(configSource.locale);
      if(!companyLocale || (configHead && configHead.sourceFingerprint!==reportSourceFingerprint(configSource))) throw new Error('question_language_config_out_of_sync');
      const configRevision=configHead?.revision ?? 0;
      const capture = await this.db.client.execute(sql`update survey_question_working_insights w set language_capture=coalesce(w.language_capture,jsonb_build_object('locale',${companyLocale}::text,'configRevision',${configRevision}::integer)) from tenants t where w.id=${row.working.id}::uuid and w.tenant_id=t.id and coalesce(t.locale,'en')=${companyLocale} and coalesce((select max(revision) from tenant_report_config_revisions where tenant_id=t.id),0)=${configRevision} and w.updated_at=${row.workingRevision}::timestamptz and w.purged_at is null returning language_capture`) as unknown as { language_capture: { locale: string; configRevision: number } }[];
      languageCapture = capture[0]?.language_capture ?? null;
    }
    if (!languageCapture || canonicalCompanyLocale(languageCapture.locale) !== languageCapture.locale) throw new Error('question_language_capture_unavailable');
    return {
      languageCapture,
      cachedAssessment: row.scoreCacheCurrent ? row.working.scoreCache as QuestionScoreResult : undefined,
      workingInsightId: row.working.id,
      workingUpdatedAt: row.working.updatedAt,
      workingRevision: row.workingRevision,
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
      shownStatementReceipt: receipt !== undefined,
      reportAdmissionProof,
    };
  }

  async persistFinalAndPurge(input: {
    final: FinalQuestionInsight;
    workingInsightId: string;
    expectedWorkingUpdatedAt: Date;
    expectedWorkingRevision?: string;
  }): Promise<'finalized' | 'already_finalized' | 'stale'> {
    const { final } = input;
    return this.db.client.transaction(async (tx) => {
      await lockPulseReportSubject(tx, final.tenantId, final.userId);
      const [working] = await tx.select().from(surveyQuestionWorkingInsights)
        .where(and(
          eq(surveyQuestionWorkingInsights.id, input.workingInsightId),
          eq(surveyQuestionWorkingInsights.tenantId, final.tenantId),
          eq(surveyQuestionWorkingInsights.userId, final.userId),
          eq(surveyQuestionWorkingInsights.surveyWindowId, final.surveyWindowId),
          eq(surveyQuestionWorkingInsights.surveyQuestionId, final.surveyQuestionId),
        )).for('update').limit(1);
      if (!working) return 'stale';
      if (input.expectedWorkingRevision) {
        const exact = await tx.execute(sql`select updated_at=${input.expectedWorkingRevision}::timestamptz as matches from survey_question_working_insights where id=${working.id}::uuid`) as unknown as {matches:boolean}[];
        if (!exact[0]?.matches) return 'stale';
      }

      const [existing] = await tx.select({ id: surveyQuestionInsights.id })
        .from(surveyQuestionInsights)
        .where(and(
          eq(surveyQuestionInsights.workingInsightId, working.id),
          eq(surveyQuestionInsights.confirmedAt, final.confirmedAt),
        )).limit(1);
      if (existing && working.purgedAt) return 'already_finalized';
      for (const sourceMessageId of [...working.sourceMessageIds, working.confirmationMessageId]) {
        const decision = await pulseReportAdmission(tx, { tenantId: final.tenantId, userId: final.userId, surveyWindowId: final.surveyWindowId, surveyQuestionId: final.surveyQuestionId, ...(sourceMessageId ? { sourceMessageId } : {}) });
        if (decision !== 'allowed') return 'stale';
      }
      const capture = working.languageCapture as {locale?:string;configRevision?:number}|null;
      if (final.proseProvenance && (!capture || final.proseProvenance.locale !== capture.locale || final.proseProvenance.configRevision !== capture.configRevision)) return 'stale';
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
          proseProvenance: final.proseProvenance,
          deidentifiedSummary: final.deidentifiedSummary,
          summarySupport:final.summarySupport,
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

      // A bundle is purged once every row it confirmed is purged. A corrected statement moves its
      // row to a later one-statement bundle (GC round 3 CAP-3), so the earlier resolved bundle is
      // checked here as well, not only the one this row points at.
      const candidateBundles = await tx.select({
        id: surveyQuestionConfirmationBundles.id,
        components: surveyQuestionConfirmationBundles.components,
      }).from(surveyQuestionConfirmationBundles).where(and(
          eq(surveyQuestionConfirmationBundles.tenantId, final.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, final.userId),
          eq(surveyQuestionConfirmationBundles.surveyWindowId, final.surveyWindowId),
          eq(surveyQuestionConfirmationBundles.status, 'resolved'),
        ));
      for (const bundle of candidateBundles) {
        // Components stay on a resolved bundle only while a dispute is still being clarified.
        if (bundle.components !== null && bundle.components !== undefined) continue;
        const bundleQuestions = await tx.select({ purgedAt: surveyQuestionWorkingInsights.purgedAt })
          .from(surveyQuestionWorkingInsights)
          .where(eq(surveyQuestionWorkingInsights.confirmationBundleId, bundle.id));
        if (bundleQuestions.every((question) => question.purgedAt !== null)) {
          await tx.update(surveyQuestionConfirmationBundles).set({
            displayedText: null,
            components: null,
            status: 'purged',
            purgedAt,
          }).where(eq(surveyQuestionConfirmationBundles.id, bundle.id));
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

function parseBundleKind(value: string): QuestionBundleKind {
  if (value === 'confirmation' || value === 'corrected_statement') return value;
  throw new Error('v2_confirmation_bundle_kind_invalid');
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

function readinessColumns(readiness: { meaningSufficient: boolean; driverResolved: boolean; ready: boolean }) {
  return {
    readyForConfirmation: readiness.ready,
    meaningSufficient: readiness.meaningSufficient,
    driverResolved: readiness.driverResolved,
  };
}
