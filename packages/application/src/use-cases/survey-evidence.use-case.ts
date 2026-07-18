import type { AiProviderPort, ConversationTurn, SurveyQuestionForEvaluation } from '../ports/ai-provider.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';
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
    }
  }
}

