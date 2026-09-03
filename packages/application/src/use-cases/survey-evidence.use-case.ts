import type { AiProviderPort, ConversationTurn, SurveyQuestionForEvaluation } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { SurveyQuestionRecord, SurveyWindowRecord, MessageRecord } from '../types/records';
import { computeAssessmentStatus } from '../utils/survey-scoring';
import { contentSimilarity } from '../utils/text-similarity';
import type { PulseBacklogService } from '../services/pulse-backlog.service';

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
    if (!questions.length) return;

    const messages = await this.conversationRepo.findRecentMessages(input.conversationId, 15);
    if (!messages.some((m) => m.direction === 'inbound')) return;

    await this.processMessageWindow(input, window, questions, messages, input.inboundMessageId);
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
      await this.processMessageWindow(input, window, questions, slice, lastInbound.id);
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

    const questionsForEval: SurveyQuestionForEvaluation[] = questions.map((q) => ({
      id: q.id,
      stableKey: q.stableKey,
      canonicalMeaning: q.canonicalMeaning,
      positiveIndicators: q.positiveIndicators,
      negativeIndicators: q.negativeIndicators,
      contraindications: q.contraindications,
    }));

    const evaluation = await this.ai.evaluateSurveyEvidence(turns, questionsForEval);

    for (const ev of evaluation.evidence) {
      if (ev.assessmentShouldRemainUnknown) continue;
      if (ev.strength < MIN_EVIDENCE_STRENGTH) continue;

      const question = questions.find((q) => q.id === ev.questionId);
      if (!question) continue;

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

      const status = computeAssessmentStatus(ev, question);

      await this.surveyRepo.upsertAssessment({
        surveyWindowId: window.id,
        surveyQuestionId: ev.questionId,
        confidence: ev.confidence,
        status,
        evidenceId: evidenceRecord.id,
        evaluatorVersion: 'v1',
      });

      // Any saved evidence means the question has a root cause — mark it done
      // for this pulse cycle so the agent stops probing it.
      // Evidence can still be updated if the employee voluntarily revisits the topic.
      if (this.pulseBacklogService) {
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
    const assessmentMap = new Map(assessments.map((a) => [a.surveyQuestionId, a.status]));

    const COMPLETE_STATUSES = new Set(['partially_covered', 'scored']);
    const allComplete = groupQuestions.every((q) => COMPLETE_STATUSES.has(assessmentMap.get(q.id) ?? ''));

    if (!allComplete) return;

    await this.surveyRepo.upsertGroupState({
      surveyWindowId: windowId,
      userId: input.userId,
      tenantId: input.tenantId,
      questionGroup,
      status: 'pending_confirmation',
    });

  }
}
