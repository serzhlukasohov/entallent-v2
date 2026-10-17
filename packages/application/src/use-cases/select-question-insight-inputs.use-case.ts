/** The repository must read only finalized, de-identified analytical rows. */
export interface QuestionInsightInputRecord {
  questionId: string;
  questionVersion: string;
  deidentifiedSummary: string;
  outcome: 'scored' | 'insufficient_evidence';
  score: number | null;
  scoringPolicyVersion: string;
  confirmedAt: Date;
}

export interface PriorQuestionScoreRecord {
  questionId: string;
  questionVersion: string;
  score: number;
  scoringPolicyVersion: string;
  periodStart: Date;
  periodEnd: Date;
  confirmedAt: Date;
}

export interface QuestionInsightTrend {
  questionId: string;
  direction: 'baseline' | 'improving' | 'declining' | 'stable';
  /** No official delta is exposed across policy or question-version boundaries. */
  delta: number | null;
  baselineReason?: 'no_prior_score' | 'policy_version_changed' | 'question_version_changed' | 'ambiguous_prior_score';
}

export interface QuestionInsightInputRepositoryPort {
  findWindowPeriod(input: {
    tenantId: string;
    userId: string;
    surveyWindowId: string;
    surveyDefinitionId: string;
  }): Promise<{ periodStart: Date; periodEnd: Date } | null>;
  findFinalizedQuestions(input: {
    tenantId: string;
    userId: string;
    surveyWindowId: string;
    surveyDefinitionId: string;
    questionGroup: string;
  }): Promise<QuestionInsightInputRecord[]>;
  findPriorFinalizedQuestionScores(input: {
    tenantId: string;
    userId: string;
    surveyWindowId: string;
    surveyDefinitionId: string;
    questionGroup: string;
    questionIds: readonly string[];
  }): Promise<PriorQuestionScoreRecord[]>;
}

export interface QuestionInsightInputSelection {
  /** Complete question coverage is required before an intermediate report can use this index. */
  intermediateEligible: boolean;
  intermediateQuestions: QuestionInsightInputRecord[];
  /** Final-cycle analysis can use each confirmed question independently. */
  finalQuestions: QuestionInsightInputRecord[];
  questionTrends: QuestionInsightTrend[];
}

export class SelectQuestionInsightInputsUseCase {
  constructor(private readonly repository: QuestionInsightInputRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    userId: string;
    surveyWindowId: string;
    surveyDefinitionId: string;
    questionGroup: string;
    requiredQuestionIds: readonly string[];
    reportKind: 'intermediate' | 'final';
    now: Date;
  }): Promise<QuestionInsightInputSelection> {
    const required = new Set(input.requiredQuestionIds);
    if (!input.tenantId.trim() || !input.userId.trim() || !input.surveyWindowId.trim()
      || !input.surveyDefinitionId.trim() || !input.questionGroup.trim()
      || required.size !== 3 || input.requiredQuestionIds.some((id) => !id.trim())
      || !['intermediate', 'final'].includes(input.reportKind)
      || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
      throw new Error('question_insight_input_invalid_scope');
    }

    const period = await this.repository.findWindowPeriod(input);
    if (!period || !Number.isFinite(period.periodStart.getTime())
      || !Number.isFinite(period.periodEnd.getTime()) || period.periodEnd <= period.periodStart) {
      throw new Error('question_insight_window_missing');
    }
    if (input.reportKind === 'final' && input.now < period.periodEnd) {
      throw new Error('question_insight_final_before_cutoff');
    }

    const rows = await this.repository.findFinalizedQuestions(input);
    const selected = rows.filter((row) => required.has(row.questionId));
    if (selected.length !== new Set(selected.map((row) => row.questionId)).size
      || selected.some((row) => !row.questionVersion.trim()
        || !row.deidentifiedSummary.trim() || !row.scoringPolicyVersion.trim()
        || (row.outcome === 'scored'
          ? !Number.isFinite(row.score) || row.score === null || row.score < 0 || row.score > 100
          : row.outcome !== 'insufficient_evidence' || row.score !== null)
        || !Number.isFinite(row.confirmedAt.getTime())
        || row.confirmedAt < period.periodStart || row.confirmedAt >= period.periodEnd)) {
      throw new Error('question_insight_input_invalid_record');
    }
    if (new Set(selected.map((row) => row.scoringPolicyVersion)).size > 1) {
      throw new Error('question_insight_input_mixed_scoring_policy');
    }

    const byQuestion = new Map(selected.map((row) => [row.questionId, row]));
    const availableQuestions = input.requiredQuestionIds.flatMap((id) => {
      const row = byQuestion.get(id);
      return row ? [row] : [];
    });
    const intermediateEligible = availableQuestions.length === 3
      && availableQuestions.every((row) => row.outcome === 'scored');
    const selectedQuestions = input.reportKind === 'final' || intermediateEligible
      ? availableQuestions : [];
    const scoredQuestions = selectedQuestions.filter((row) => row.outcome === 'scored');
    const prior = scoredQuestions.length > 0
      ? await this.repository.findPriorFinalizedQuestionScores({ ...input,
        questionIds: scoredQuestions.map((row) => row.questionId) })
      : [];
    const questionTrends = scoredQuestions.map((current) => compareQuestionTrend(current,
      prior.filter((row) => row.questionId === current.questionId)));
    return {
      intermediateEligible,
      intermediateQuestions: input.reportKind === 'intermediate' ? selectedQuestions : [],
      finalQuestions: input.reportKind === 'final' ? selectedQuestions : [],
      questionTrends,
    };
  }
}

function compareQuestionTrend(
  current: QuestionInsightInputRecord,
  prior: PriorQuestionScoreRecord[],
): QuestionInsightTrend {
  const baseline = (reason: NonNullable<QuestionInsightTrend['baselineReason']>): QuestionInsightTrend => ({
    questionId: current.questionId, direction: 'baseline', delta: null, baselineReason: reason,
  });
  if (prior.length === 0) return baseline('no_prior_score');
  if (prior.some((row) => !row.questionVersion.trim() || !row.scoringPolicyVersion.trim()
    || !Number.isFinite(row.score) || row.score < 0 || row.score > 100
    || !Number.isFinite(row.periodStart.getTime()) || !Number.isFinite(row.periodEnd.getTime())
    || !Number.isFinite(row.confirmedAt.getTime()) || row.periodEnd <= row.periodStart
    || row.confirmedAt < row.periodStart || row.confirmedAt >= row.periodEnd)) {
    throw new Error('question_insight_prior_invalid_record');
  }
  const latestEnd = Math.max(...prior.map((row) => row.periodEnd.getTime()));
  const latest = prior.filter((row) => row.periodEnd.getTime() === latestEnd);
  if (latest.length !== 1) return baseline('ambiguous_prior_score');
  const previous = latest[0]!;
  if (previous.questionVersion !== current.questionVersion) return baseline('question_version_changed');
  if (previous.scoringPolicyVersion !== current.scoringPolicyVersion) {
    return baseline('policy_version_changed');
  }
  const delta = current.score! - previous.score;
  return {
    questionId: current.questionId,
    direction: delta > 0 ? 'improving' : delta < 0 ? 'declining' : 'stable',
    delta,
  };
}
