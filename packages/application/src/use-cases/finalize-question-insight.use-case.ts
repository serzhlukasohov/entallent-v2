import { evaluateQuestionDeidentification } from '../utils/question-deidentification-policy';
import { isApprovedQuestionRubric } from '../utils/question-scoring-policy';

export interface ApprovedQuestionRubric {
  version: string;
  instructions: string;
  anchors: ReadonlyArray<{ score: number; description: string }>;
}

export interface QuestionFinalizationContext {
  workingInsightId: string;
  workingUpdatedAt: Date;
  tenantId: string;
  userId: string;
  surveyWindowId: string;
  surveyDefinitionId: string;
  surveyQuestionId: string;
  questionVersion: string;
  questionGroup: string;
  confirmedSemanticSummary: string;
  confirmedAt: Date;
  scoringPolicyVersion: string;
  rubric: ApprovedQuestionRubric | null;
  knownIdentifiers: string[];
  sourceMessageIds: string[];
}

export type SafeSignalDirection = 'adverse' | 'mixed' | 'favorable';
export type SafeSignalSeverity = 'low' | 'moderate' | 'high';
export type SafeRootCauseCategory =
  | 'workload' | 'clarity' | 'autonomy' | 'growth' | 'purpose' | 'belonging' | 'support' | 'other';

export interface QuestionScoreResult {
  score: number;
  confidence: number;
  modelId: string;
  promptVersion: string;
  direction: SafeSignalDirection;
  severity: SafeSignalSeverity;
  rootCauseCategory: SafeRootCauseCategory;
}

export interface QuestionScorerPort {
  scoreConfirmedMeaning(input: {
    semanticSummary: string;
    rubric: ApprovedQuestionRubric;
    questionId: string;
    scoringPolicyVersion: string;
  }): Promise<QuestionScoreResult>;
}

export interface QuestionDeidentifierPort {
  deidentify(input: { semanticSummary: string; attempt: number }): Promise<string>;
}

export interface FinalQuestionInsight {
  tenantId: string;
  userId: string;
  surveyWindowId: string;
  surveyDefinitionId: string;
  surveyQuestionId: string;
  questionVersion: string;
  questionGroup: string;
  deidentifiedSummary: string;
  score: number;
  signalDirection: SafeSignalDirection;
  signalSeverity: SafeSignalSeverity;
  rootCauseCategory: SafeRootCauseCategory;
  confidence: number;
  scoringPolicyVersion: string;
  questionRubricVersion: string;
  modelId: string;
  promptVersion: string;
  privacyPolicyVersion: string;
  confirmedAt: Date;
  scoredAt: Date;
}

export interface QuestionFinalizationRepositoryPort {
  listPendingConfirmedUsers(): Promise<Array<{ tenantId: string; userId: string }>>;
  listPendingConfirmedQuestions(input: { tenantId: string; userId: string }): Promise<Array<{
    surveyWindowId: string; surveyQuestionId: string;
  }>>;
  loadConfirmedQuestion(input: { tenantId: string; userId: string; surveyWindowId: string; surveyQuestionId: string }):
    Promise<QuestionFinalizationContext | 'already_finalized' | null>;
  /** Must insert the final row and erase private derivatives in one transaction. */
  persistFinalAndPurge(input: {
    final: FinalQuestionInsight;
    workingInsightId: string;
    expectedWorkingUpdatedAt: Date;
  }): Promise<'finalized' | 'already_finalized' | 'stale'>;
}

export class FinalizeQuestionInsightUseCase {
  constructor(
    private readonly repository: QuestionFinalizationRepositoryPort,
    private readonly scorer: QuestionScorerPort,
    private readonly deidentifier: QuestionDeidentifierPort,
  ) {}

  async executePending(input: { tenantId: string; userId: string }): Promise<number> {
    const pending = await this.repository.listPendingConfirmedQuestions(input);
    let finalized = 0;
    let failed = false;
    for (const question of pending) {
      try {
        const result = await this.execute({ ...input, ...question });
        if (result === 'finalized') finalized += 1;
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('question_finalization_batch_failed');
    return finalized;
  }

  async execute(input: {
    tenantId: string;
    userId: string;
    surveyWindowId: string;
    surveyQuestionId: string;
    now?: Date;
  }): Promise<'finalized' | 'already_finalized' | 'stale'> {
    const context = await this.repository.loadConfirmedQuestion(input);
    if (context === 'already_finalized') return 'already_finalized';
    if (!context) return 'stale';
    if (!isApprovedQuestionRubric(context.rubric)) throw new Error('approved_question_rubric_missing');
    if (!context.confirmedSemanticSummary.trim()) throw new Error('confirmed_question_meaning_missing');
    if (!context.scoringPolicyVersion.trim()) throw new Error('bound_scoring_policy_missing');

    const assessment = await this.scorer.scoreConfirmedMeaning({
      semanticSummary: context.confirmedSemanticSummary,
      rubric: context.rubric,
      questionId: context.surveyQuestionId,
      scoringPolicyVersion: context.scoringPolicyVersion,
    });
    if (!isValidAssessment(assessment)) throw new Error('question_score_invalid');
    const privacyIdentifiers = [
      ...context.knownIdentifiers,
      ...extractPrivateIdentifiersFromSource(context.confirmedSemanticSummary),
    ];

    let acceptedSummary: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let candidate = '';
      try {
        candidate = await this.deidentifier.deidentify({
          semanticSummary: context.confirmedSemanticSummary,
          attempt,
        });
      } catch {
        continue;
      }
      if (candidate.trim() && evaluateQuestionDeidentification({
        text: candidate,
        knownIdentifiers: privacyIdentifiers,
        sourceMessageIds: context.sourceMessageIds,
      }).status === 'accepted') {
        acceptedSummary = candidate.trim();
        break;
      }
    }
    if (!acceptedSummary) {
      acceptedSummary = [
        safeFallback(assessment),
        'A generalized work experience signal was identified.',
        'A generalized signal was identified.',
      ].find((candidate) => evaluateQuestionDeidentification({
        text: candidate,
        knownIdentifiers: privacyIdentifiers,
        sourceMessageIds: context.sourceMessageIds,
      }).status === 'accepted') ?? null;
    }

    if (!acceptedSummary) throw new Error('question_privacy_fallback_failed');

    const privacyDecision = evaluateQuestionDeidentification({
      text: acceptedSummary,
      knownIdentifiers: privacyIdentifiers,
      sourceMessageIds: context.sourceMessageIds,
    });
    if (privacyDecision.status !== 'accepted') throw new Error('question_privacy_gate_failed');

    return this.repository.persistFinalAndPurge({
      workingInsightId: context.workingInsightId,
      expectedWorkingUpdatedAt: context.workingUpdatedAt,
      final: {
      tenantId: context.tenantId,
      userId: context.userId,
      surveyWindowId: context.surveyWindowId,
      surveyDefinitionId: context.surveyDefinitionId,
      surveyQuestionId: context.surveyQuestionId,
      questionVersion: context.questionVersion,
      questionGroup: context.questionGroup,
      deidentifiedSummary: acceptedSummary,
      score: assessment.score,
      signalDirection: assessment.direction,
      signalSeverity: assessment.severity,
      rootCauseCategory: assessment.rootCauseCategory,
      confidence: assessment.confidence,
      scoringPolicyVersion: context.scoringPolicyVersion,
      questionRubricVersion: context.rubric.version,
      modelId: assessment.modelId,
      promptVersion: assessment.promptVersion,
      privacyPolicyVersion: privacyDecision.policyVersion,
      confirmedAt: context.confirmedAt,
      scoredAt: input.now ?? new Date(),
      },
    });
  }
}

function isValidAssessment(value: QuestionScoreResult): boolean {
  return Number.isFinite(value.score) && value.score >= 0 && value.score <= 100
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
    && !!value.modelId.trim() && !!value.promptVersion.trim()
    && ['adverse', 'mixed', 'favorable'].includes(value.direction)
    && ['low', 'moderate', 'high'].includes(value.severity)
    && ['workload', 'clarity', 'autonomy', 'growth', 'purpose', 'belonging', 'support', 'other']
      .includes(value.rootCauseCategory);
}

function safeFallback(value: QuestionScoreResult): string {
  const category = value.rootCauseCategory === 'other' ? 'work experience' : value.rootCauseCategory;
  return `A ${value.severity} ${value.direction} signal related to ${category} was identified.`;
}

function extractPrivateIdentifiersFromSource(text: string): string[] {
  const identifiers = new Set<string>();
  const genericSentenceOpeners = new Set([
    'The', 'This', 'There', 'Employee', 'Growth', 'Autonomy',
    'Belonging', 'Purpose', 'Engagement', 'Work', 'Workload', 'Team',
  ]);
  for (const match of text.matchAll(/(?:^|[.!?]\s+)(\p{Lu}[\p{Ll}\p{M}]{2,})\s+(\p{Lu}[\p{Ll}\p{M}]{2,})(?=\s|[,.!?;:]|$)/gu)) {
    if (genericSentenceOpeners.has(match[1]!)) continue;
    identifiers.add(match[1]!);
    identifiers.add(match[2]!);
  }
  for (const match of text.matchAll(/(?:^|[.!?]\s+)(\p{Lu}[\p{Ll}\p{M}]{2,})\s+\p{Ll}/gu)) {
    if (!genericSentenceOpeners.has(match[1]!)) identifiers.add(match[1]!);
  }
  const labeledName = /(?:^|[^\p{L}\p{N}])(?:manager|teammate|colleague|team|project|customer|client|account|менеджер|коллега|команда|проект|клиент|menedżer|kolega|koleżanka|zespół|projekt|klient|konto|колега|проєкт|клієнт)\s+/giu;
  const properName = /^(\p{Lu}[\p{L}\p{N}_-]{2,}(?:\s+\p{Lu}[\p{L}\p{N}_-]{2,}){0,2})/u;
  for (const match of text.matchAll(labeledName)) {
    const name = properName.exec(text.slice(match.index + match[0].length));
    if (!name) continue;
    for (const part of name[1]!.split(/\s+/)) identifiers.add(part);
  }
  // Capitalized words inside a sentence can identify a person or named entity
  // even when the employee did not use a role, project, or team label.
  for (const match of text.matchAll(/\p{Lu}[\p{L}\p{N}_-]{2,}/gu)) {
    const preceding = text.slice(0, match.index).trimEnd();
    if (preceding && !/[.!?]\s*$/u.test(preceding)) identifiers.add(match[0]);
  }
  return [...identifiers];
}
