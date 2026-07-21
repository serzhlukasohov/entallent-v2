import type { AiProviderPort, ConversationTurn, SurveyQuestionForEvaluation } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { SurveyQuestionRecord } from '../types/records';
import { computeAssessmentStatus } from '../utils/survey-scoring';
import { contentSimilarity } from '../utils/text-similarity';

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
    private readonly outbox?: OutboxPort,
  ) {}

  async execute(input: SurveyEvidenceExtractionInput): Promise<void> {
    const window = await this.surveyRepo.findOrCreateActiveWindow(input.userId, input.tenantId);
    if (!window) return;

    const questions = await this.surveyRepo.findQuestionsForWindow(window.id);
    if (!questions.length) return;

    const messages = await this.conversationRepo.findRecentMessages(input.conversationId, 15);
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
        sourceMessageIds: [input.inboundMessageId],
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

      await this.checkGroupCompletion(input, window.id, ev.questionId, questions);
    }
  }

  private async checkGroupCompletion(
    input: SurveyEvidenceExtractionInput,
    windowId: string,
    assessedQuestionId: string,
    allQuestions: SurveyQuestionRecord[],
  ): Promise<void> {
    const assessedQuestion = allQuestions.find((q) => q.id === assessedQuestionId);
    if (!assessedQuestion) return;

    const questionGroup = assessedQuestion.questionGroup;
    if (!questionGroup) return;

    // Check idempotency: if group state already exists (any status), skip
    const existingState = await this.surveyRepo.findGroupState(input.userId, windowId, questionGroup);
    if (existingState) return;

    const groupQuestions = allQuestions.filter((q) => q.questionGroup === questionGroup);
    if (groupQuestions.length === 0) return;

    const assessments = await this.surveyRepo.findAssessmentsForWindow(windowId);
    const assessmentMap = new Map(assessments.map((a) => [a.surveyQuestionId, a.status]));

    const COMPLETE_STATUSES = new Set(['partially_covered', 'scored']);
    const allComplete = groupQuestions.every((q) => COMPLETE_STATUSES.has(assessmentMap.get(q.id) ?? ''));

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

    if (this.outbox) {
      await this.outbox.enqueueGroupConfirmation({
        surveyWindowId: windowId,
        userId: input.userId,
        tenantId: input.tenantId,
        questionGroup,
        traceId: `group-completion-${windowId}-${questionGroup}`,
      });
    }
  }
}

