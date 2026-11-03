import type {
  CycleProgressSnapshot,
  PulseBacklogService,
  QuestionConfirmationPort,
  SurveyQuestionRecord,
  SurveyRepositoryPort,
} from '@entalent/application';

type PulseCaptureRecord = Awaited<ReturnType<SurveyRepositoryPort['findPulseCaptureForConversation']>>[number];
type NextProbe = NonNullable<Awaited<ReturnType<PulseBacklogService['getNextProbeQuestion']>>>;

export interface PulseCycleState {
  /** False: the employee has no active V2 window. */
  open: boolean;
  surveyWindowId: string;
  topics: Array<{
    questionGroup: string;
    questions: Array<{ question: SurveyQuestionRecord; status: string }>;
  }>;
  /** Pulse-capture evidence as the survey repository would return it for this conversation. */
  evidence: PulseCaptureRecord[];
  nextProbe: { questionId: string; focus: NextProbe['focus'] } | null;
}

/**
 * One in-memory pulse cycle behind the three ports the orchestrator reads cycle state from:
 * `QuestionConfirmationPort.findCycleProgress`, the survey repository's pulse-capture evidence and
 * `PulseBacklogService.getNextProbeQuestion`. It holds no ready bundle or pending clarification,
 * so the other confirmation methods are inert.
 */
export class InMemoryPulseCycle {
  readonly questionConfirmation: QuestionConfirmationPort;
  readonly surveyRepo: SurveyRepositoryPort;
  readonly backlog: Pick<PulseBacklogService, 'getNextProbeQuestion'>;

  constructor(public state: PulseCycleState) {
    this.questionConfirmation = {
      findCycleProgress: async () => this.snapshot(),
      findAppliedQuestionVerdictForInbound: async () => null,
      findPendingQuestionClarification: async () => null,
      stageQuestionClarificationPrompt: async () => true,
      applyQuestionClarificationVerdict: async () => true,
      findAwaitingQuestionBundle: async () => null,
      applyQuestionBundleVerdict: async () => true,
      findReadyQuestionBundle: async () => null,
      hasReadyQuestionBundle: async () => false,
      stageQuestionConfirmationBundle: async () => 'sim-unused-bundle',
    };
    // Only the reads the orchestrator makes outside the legacy confirmation flow are answered.
    this.surveyRepo = {
      findPulseCaptureForConversation: async (params: { sourceMessageId?: string }) =>
        !this.state.open ? [] : this.state.evidence.filter((item) =>
          !params.sourceMessageId || item.sourceMessageIds.includes(params.sourceMessageId)),
      findAwaitingConfirmationGroups: async () => [],
      findPendingConfirmationGroups: async () => [],
    } as unknown as SurveyRepositoryPort;
    this.backlog = {
      getNextProbeQuestion: async () => {
        const probe = this.state.open ? this.state.nextProbe : null;
        if (!probe) return null;
        const question = this.findQuestion(probe.questionId);
        return question ? { question, windowId: this.state.surveyWindowId, focus: probe.focus } : null;
      },
    };
  }

  snapshot(): CycleProgressSnapshot | null {
    if (!this.state.open) return null;
    return {
      surveyWindowId: this.state.surveyWindowId,
      groups: this.state.topics.map((topic) => ({
        questionGroup: topic.questionGroup,
        questions: topic.questions.map((entry) => ({ surveyQuestionId: entry.question.id, status: entry.status })),
      })),
    };
  }

  private findQuestion(id: string): SurveyQuestionRecord | null {
    for (const topic of this.state.topics) {
      const match = topic.questions.find((entry) => entry.question.id === id);
      if (match) return match.question;
    }
    return null;
  }
}

/** A complete survey question with neutral defaults for everything a precondition leaves out. */
export function surveyQuestion(
  fields: Pick<SurveyQuestionRecord, 'id' | 'questionGroup'> & Partial<SurveyQuestionRecord>,
): SurveyQuestionRecord {
  return {
    surveyDefinitionId: 'sim-definition',
    stableKey: fields.id.replace(/^q-/, '').replace(/-/g, '_'),
    title: fields.questionGroup,
    canonicalMeaning: `How the employee experiences ${fields.questionGroup} at work`,
    dimension: fields.questionGroup,
    positiveIndicators: [],
    negativeIndicators: [],
    contraindications: [],
    probeStrategies: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 1,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    displayOrder: 1,
    responseType: 'open_ended',
    version: 'v2',
    ...fields,
  };
}
