import type { AiProviderPort, ConversationTurn, SurveyQuestionForEvaluation } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord, MessageRecord } from '../types/records';
import { computeAssessmentStatus } from '../utils/survey-scoring';
import { contentSimilarity } from '../utils/text-similarity';
import type { PulseBacklogService } from '../services/pulse-backlog.service';
import { isEngagementWindowEligible } from '../services/pulse-backlog.service';

/** Evidence weaker than this is noise ("said hi, fine") — not worth persisting */
const MIN_EVIDENCE_STRENGTH = 0.35;
/** Same-polarity summaries this similar describe the same underlying statement */
const EVIDENCE_SIMILARITY_THRESHOLD = 0.5;
/**
 * When new evidence clearly contradicts prior evidence (opposite polarity) with
 * this confidence or higher, the prior evidence is treated as outdated — the
 * person's view has genuinely changed. Below this threshold we keep both and
 * let accumulation decide.
 */
const OPINION_REVERSAL_CONFIDENCE_THRESHOLD = 0.75;

export interface SurveyEvidenceExtractionInput {
  conversationId: string;
  userId: string;
  tenantId: string;
  inboundMessageId: string;
}

export class SurveyEvidenceExtractionUseCase {
  constructor(
    private readonly ai: AiProviderPort,
    private readonly conversationRepo: ConversationRepositoryPort,
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly pulseBacklogService?: PulseBacklogService,
  ) {}

  async execute(input: SurveyEvidenceExtractionInput): Promise<void> {
    const window = await this.surveyRepo.findOrCreateActiveWindow(input.userId, input.tenantId);
    if (!window) return;

    const questions = await this.surveyRepo.findQuestionsForWindow(window.id);
    const messages = await this.conversationRepo.findRecentMessages(input.conversationId, 15);
    if (!messages.some((m) => m.direction === 'inbound')) return;
    const evaluatedAt = messages.find(
      (message) => message.id === input.inboundMessageId && message.direction === 'inbound',
    )?.occurredAt;
    const eligibleQuestions = this.eligibleQuestions(window, questions, evaluatedAt);
    if (!eligibleQuestions.length) return;

    await this.processMessageWindow(input, window, eligibleQuestions, messages, input.inboundMessageId);
  }

  /**
   * Re-extracts evidence across a conversation's full recent history — used to
   * recover findings when live extraction was previously failing. The evaluator
   * only ever reads a short transcript window, so we slide fixed-size windows over
   * the history (oldest → newest) and process each. Overlap between windows is
   * absorbed by the existing supersede logic: a later (more recent) window replaces
   * same-statement evidence produced by an earlier one, so recent phrasing wins.
   */
  async backfill(
    input: Omit<SurveyEvidenceExtractionInput, 'inboundMessageId'>,
  ): Promise<{ windowsProcessed: number }> {
    const window = await this.surveyRepo.findOrCreateActiveWindow(input.userId, input.tenantId);
    if (!window) return { windowsProcessed: 0 };

    const questions = await this.surveyRepo.findQuestionsForWindow(window.id);
    if (!questions.length) return { windowsProcessed: 0 };

    // Chronological (oldest → newest); large limit covers the whole recent history.
    const history = await this.conversationRepo.findRecentMessages(input.conversationId, 500);
    if (!history.length) return { windowsProcessed: 0 };

    const WINDOW_SIZE = 15;
    const STEP = 10; // overlap of 5 messages so signals spanning a boundary aren't lost

    const starts: number[] = [];
    for (let s = 0; s < history.length; s += STEP) starts.push(s);
    // Ensure the final messages are covered if the last stride left a tail uncovered
    // (only possible when STEP >= WINDOW_SIZE; harmless guard otherwise).
    const lastStart = Math.max(0, history.length - WINDOW_SIZE);
    if (lastStart > starts[starts.length - 1]) starts.push(lastStart);

    let windowsProcessed = 0;
    for (const start of starts) {
      const slice = history.slice(start, start + WINDOW_SIZE);
      if (!slice.some((m) => m.direction === 'inbound')) continue;
      const lastInbound = [...slice].reverse().find((m) => m.direction === 'inbound')!;
      const eligibleQuestions = this.eligibleQuestions(window, questions, lastInbound.occurredAt);
      if (!eligibleQuestions.length) continue;
      await this.processMessageWindow(input, window, eligibleQuestions, slice, lastInbound.id);
      windowsProcessed++;
    }

    return { windowsProcessed };
  }

  /** Evaluates one transcript window and persists any evidence it yields. */
  private async processMessageWindow(
    input: Omit<SurveyEvidenceExtractionInput, 'inboundMessageId'>,
    window: SurveyWindowRecord,
    questions: SurveyQuestionRecord[],
    messages: MessageRecord[],
    sourceMessageId: string,
  ): Promise<void> {
    const turns: ConversationTurn[] = messages.map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.text,
      timestamp: m.occurredAt,
    }));

    if (!turns.some((t) => t.role === 'user')) return;

    const sourceProbeQuestionId = surveyProbeQuestionIdForSource(messages, sourceMessageId);
    const evaluationQuestions = questions.filter(
      (question) => question.responseType !== 'numeric_0_10' || question.id === sourceProbeQuestionId,
    );
    if (!evaluationQuestions.length) return;

    const questionsForEval: SurveyQuestionForEvaluation[] = evaluationQuestions.map((q) => ({
      id: q.id,
      stableKey: q.stableKey,
      canonicalMeaning: q.canonicalMeaning,
      responseType: q.responseType,
      positiveIndicators: q.positiveIndicators,
      negativeIndicators: q.negativeIndicators,
      contraindications: q.contraindications,
    }));

    const evaluation = await this.ai.evaluateSurveyEvidence(turns, questionsForEval);
    const assessmentByQuestion = new Map(
      (await this.surveyRepo.findAssessmentsForWindow(window.id)).map((assessment) => [
        assessment.surveyQuestionId,
        assessment,
      ]),
    );

    for (const ev of evaluation.evidence) {
      if (ev.assessmentShouldRemainUnknown) continue;

      const question = evaluationQuestions.find((q) => q.id === ev.questionId);
      if (!question) continue;
      const isNumeric = question.responseType === 'numeric_0_10';
      const numericValue = isNumeric
        ? validatedExplicitRating(messages, sourceMessageId, question.id, ev.numericValue)
        : undefined;
      if (ev.strength < MIN_EVIDENCE_STRENGTH && numericValue === undefined) continue;

      // The evaluator re-reads the same transcript every message, so consecutive
      // runs restate the same finding. The new record replaces prior records that
      // describe the same statement; genuinely new findings are kept alongside.
      //
      // Opinion reversal: if the person's view clearly flipped (opposite polarity,
      // high confidence), all prior evidence for this question is outdated — supersede
      // everything. If the new signal is weak/uncertain, keep both and let accumulation
      // surface the truth over time.
      const existing = await this.surveyRepo.findEvidenceForQuestion(
        input.userId,
        ev.questionId,
        window.id,
      );

      const isReversal =
        ev.confidence >= OPINION_REVERSAL_CONFIDENCE_THRESHOLD &&
        existing.some((e) => e.polarity !== ev.polarity && e.polarity !== 'neutral' && ev.polarity !== 'neutral');

      const supersededIds = existing
        .filter((e) => {
          if (isReversal) return true; // wipe all prior — person changed their mind
          return (
            e.polarity === ev.polarity &&
            contentSimilarity(e.evidenceSummary, ev.evidenceSummary) >= EVIDENCE_SIMILARITY_THRESHOLD
          );
        })
        .map((e) => e.id);

      const evidenceRecord = await this.surveyRepo.saveEvidence({
        surveyWindowId: window.id,
        surveyQuestionId: ev.questionId,
        userId: input.userId,
        sourceMessageIds: [sourceMessageId],
        evidenceSummary: ev.evidenceSummary,
        polarity: ev.polarity,
        strength: ev.strength,
        completeness: ev.completeness,
        confidence: ev.confidence,
        evaluatorVersion: 'v1',
        promptVersion: 'v1',
      });

      if (supersededIds.length > 0) {
        await this.surveyRepo.markEvidenceSuperseded(supersededIds);
      }

      const existingAssessment = assessmentByQuestion.get(ev.questionId);
      const hasNumericScore = numericValue !== undefined || existingAssessment?.score != null;
      const status = isNumeric
        ? hasNumericScore ? 'scored' : 'partially_covered'
        : computeAssessmentStatus(ev, question);

      await this.surveyRepo.upsertAssessment({
        surveyWindowId: window.id,
        surveyQuestionId: ev.questionId,
        ...(numericValue !== undefined ? { score: numericValue } : {}),
        confidence: ev.confidence,
        status,
        evidenceId: evidenceRecord.id,
        evaluatorVersion: 'v1',
      });
      assessmentByQuestion.set(ev.questionId, {
        surveyQuestionId: ev.questionId,
        status,
        score: numericValue ?? existingAssessment?.score ?? null,
      });

      // Qualitative questions close on usable evidence. Numeric questions stay
      // pending until an explicit rating has been validated and stored.
      // Evidence can still be updated if the employee voluntarily revisits the topic.
      if (this.pulseBacklogService && (!isNumeric || status === 'scored')) {
        const allEvidence = await this.surveyRepo.findEvidenceForQuestion(
          input.userId,
          ev.questionId,
          window.id,
        );
        await this.pulseBacklogService.markQuestionCovered(
          input.userId,
          window.id,
          ev.questionId,
          allEvidence.length,
        );
      }

      await this.checkGroupCompletion(input, window.id, ev.questionId, questions);
    }
  }

  private async checkGroupCompletion(
    input: Omit<SurveyEvidenceExtractionInput, 'inboundMessageId'>,
    windowId: string,
    assessedQuestionId: string,
    allQuestions: SurveyQuestionRecord[],
  ): Promise<void> {
    const assessedQuestion = allQuestions.find((q) => q.id === assessedQuestionId);
    if (!assessedQuestion) return;

    const questionGroup = assessedQuestion.questionGroup;
    if (!questionGroup) return;

    // Idempotency: skip if a group state already exists UNLESS it was reopened
    // (in_progress) after a correction — that must be allowed to re-complete.
    const existingState = await this.surveyRepo.findGroupState(input.userId, windowId, questionGroup);
    if (existingState && existingState.status !== 'in_progress') return;

    const groupQuestions = allQuestions.filter((q) => q.questionGroup === questionGroup);
    if (groupQuestions.length === 0) return;

    const assessments = await this.surveyRepo.findAssessmentsForWindow(windowId);

    const COMPLETE_STATUSES = new Set(['partially_covered', 'covered', 'scored']);
    const allComplete = groupQuestions.every((q) => {
      const assessment = assessments.find((candidate) => candidate.surveyQuestionId === q.id);
      return q.responseType === 'numeric_0_10'
        ? assessment?.status === 'scored' && assessment.score !== null
        : COMPLETE_STATUSES.has(assessment?.status ?? '');
    });

    if (!allComplete) return;

    // Generate AI summary before saving group state so the processor finds it populated
    const evidenceSummaries: Array<{
      questionId: string;
      stableKey: string;
      evidenceSummary: string;
      polarity: string;
    }> = [];
    for (const q of groupQuestions) {
      const evidence = await this.surveyRepo.findEvidenceForQuestion(input.userId, q.id, windowId);
      const latest = [...evidence].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latest) {
        evidenceSummaries.push({
          questionId: q.id,
          stableKey: q.stableKey,
          evidenceSummary: latest.evidenceSummary,
          polarity: latest.polarity,
        });
      }
    }

    let aiSummary: string | undefined;
    if (evidenceSummaries.length > 0) {
      const groupSummaryResult = await this.ai.generateGroupSummary(evidenceSummaries, questionGroup);
      aiSummary = groupSummaryResult.summary;
    }

    await this.surveyRepo.upsertGroupState({
      surveyWindowId: windowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup,
      status: 'pending_confirmation',
      aiSummary,
    });

  }

  private eligibleQuestions(
    window: SurveyWindowRecord,
    questions: SurveyQuestionRecord[],
    evaluatedAt: Date | undefined,
  ): SurveyQuestionRecord[] {
    if (evaluatedAt && isEngagementWindowEligible(window, evaluatedAt)) {
      return questions;
    }
    return questions.filter((question) => question.questionGroup !== 'engagement');
  }
}

function validatedExplicitRating(
  messages: MessageRecord[],
  sourceMessageId: string,
  questionId: string,
  evaluatedValue: number | null | undefined,
): number | undefined {
  const sourceIndex = messages.findIndex(
    (message) => message.id === sourceMessageId && message.direction === 'inbound',
  );
  if (sourceIndex < 0) return undefined;

  if (surveyProbeQuestionIdForSource(messages, sourceMessageId) !== questionId) return undefined;

  const explicitValue = parseExplicitZeroToTen(messages[sourceIndex]!.text);
  if (explicitValue === undefined) return undefined;
  if (typeof evaluatedValue === 'number' && evaluatedValue !== explicitValue) return undefined;
  return explicitValue;
}

function parseExplicitZeroToTen(text: string): number | undefined {
  const labeled = text.match(
    /(?:^|[^\d.,])((?:10|[0-9])(?:[.,]\d+)?)\s*(?:\/\s*10\b|out\s+of\s+10\b)/iu,
  );
  if (labeled?.[1]) return Number(labeled[1].replace(',', '.'));

  const values = [...text.matchAll(/(?:^|[^\d.,])((?:10|[0-9])(?:[.,]\d+)?)(?=$|[^\d.,])/gu)]
    .map((match) => Number(match[1]!.replace(',', '.')))
    .filter((value) => value >= 0 && value <= 10);
  const uniqueValues = [...new Set(values)];
  return uniqueValues.length === 1 ? uniqueValues[0] : undefined;
}

function surveyProbeQuestionIdForSource(
  messages: MessageRecord[],
  sourceMessageId: string,
): string | undefined {
  const sourceIndex = messages.findIndex(
    (message) => message.id === sourceMessageId && message.direction === 'inbound',
  );
  if (sourceIndex < 0) return undefined;

  const previousOutbound = messages
    .slice(0, sourceIndex)
    .reverse()
    .find((message) => message.direction === 'outbound');
  return previousOutbound?.metadata?.['containsSurveyProbe'] === true &&
    typeof previousOutbound.metadata['surveyProbeQuestionId'] === 'string'
    ? previousOutbound.metadata['surveyProbeQuestionId']
    : undefined;
}
