import type {
  ConfirmationResponse,
  GeneratedResponse,
  GroupReport,
  GroupSummary,
  MemoryProposal,
  ObservedStyle,
  ReplyStrategy,
  RiskDetection,
  SituationClassification,
  SurveyEvidenceEvaluation,
} from '@entalent/contracts';
import type {
  AiProviderPort,
  ClassifyContext,
  ConversationTurn,
  MemoryContext,
  ResponseContext,
  RiskContext,
  SurveyQuestionForEvaluation,
} from '@entalent/application';

type Script<TInput, TOutput> =
  | TOutput
  | ((input: TInput, callIndex: number) => TOutput);

export interface ScriptedAiOptions {
  classifications?: Array<Script<{ turns: ConversationTurn[]; context: ClassifyContext }, SituationClassification>>;
  risks?: Array<Script<{ turns: ConversationTurn[]; context: RiskContext }, RiskDetection>>;
  memoryProposals?: Array<Script<{ turns: ConversationTurn[]; existing: MemoryContext }, MemoryProposal>>;
  responses?: Array<Script<{ turns: ConversationTurn[]; strategy: ReplyStrategy; context: ResponseContext }, GeneratedResponse>>;
}

export class ScriptedAiProvider implements AiProviderPort {
  private classifyCalls = 0;
  private riskCalls = 0;
  private memoryCalls = 0;
  private responseCalls = 0;

  constructor(private readonly options: ScriptedAiOptions = {}) {}

  async classifySituation(
    turns: ConversationTurn[],
    context: ClassifyContext,
  ): Promise<SituationClassification> {
    const callIndex = this.classifyCalls++;
    return readScript(
      this.options.classifications,
      { turns, context },
      callIndex,
      makeClassification(),
    );
  }

  async detectRisk(turns: ConversationTurn[], context: RiskContext): Promise<RiskDetection> {
    const callIndex = this.riskCalls++;
    return readScript(this.options.risks, { turns, context }, callIndex, makeRisk());
  }

  async extractMemory(turns: ConversationTurn[], existing: MemoryContext): Promise<MemoryProposal> {
    const callIndex = this.memoryCalls++;
    return readScript(
      this.options.memoryProposals,
      { turns, existing },
      callIndex,
      makeMemoryProposal(),
    );
  }

  async evaluateSurveyEvidence(
    _turns: ConversationTurn[],
    _questions: SurveyQuestionForEvaluation[],
  ): Promise<SurveyEvidenceEvaluation> {
    return { candidateQuestionIds: [], evidence: [] };
  }

  async generateResponse(
    turns: ConversationTurn[],
    strategy: ReplyStrategy,
    context: ResponseContext,
  ): Promise<GeneratedResponse> {
    const callIndex = this.responseCalls++;
    return readScript(
      this.options.responses,
      { turns, strategy, context },
      callIndex,
      {
        text: `${strategy.mode}: ${context.reminderConfirmation ? `reminder set for ${context.reminderConfirmation.intent}` : 'noted'}`,
        confidence: 0.9,
        containsSurveyProbe: false,
      },
    );
  }

  async generateGroupSummary(): Promise<GroupSummary> {
    return { summary: 'Synthetic summary.', sentimentScores: {} };
  }

  async generateGroupReport(): Promise<GroupReport> {
    return { explanation: 'Synthetic report.', actionItems: ['One', 'Two', 'Three'] };
  }

  async scoreSentiment(): Promise<number> {
    return 0.5;
  }

  async interpretConfirmationResponse(): Promise<ConfirmationResponse> {
    return { verdict: 'unclear' };
  }

  async analyzeStyle(): Promise<ObservedStyle> {
    return {
      dimensions: { register: 0.5, humor: 0.1, verbosity: 0.5, emoji: 0 },
      phrases: [],
    };
  }
}

export function makeClassification(
  overrides: Partial<SituationClassification> = {},
): SituationClassification {
  return {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.9,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'Synthetic baseline classification.',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'synthetic substance',
    topicAnchor: null,
    ...overrides,
  };
}

export function makeRisk(overrides: Partial<RiskDetection> = {}): RiskDetection {
  return {
    riskType: null,
    severity: 'none',
    confidence: 0,
    evidence: [],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
    reasoningSummary: 'No risk in synthetic baseline.',
    ...overrides,
  };
}

export function makeMemoryProposal(
  overrides: Partial<MemoryProposal> = {},
): MemoryProposal {
  return {
    memoryItems: [],
    goalProposals: [],
    commitmentProposals: [],
    followUpCandidates: [],
    ...overrides,
  };
}

function readScript<TInput, TOutput>(
  scripts: Array<Script<TInput, TOutput>> | undefined,
  input: TInput,
  callIndex: number,
  fallback: TOutput,
): TOutput {
  if (!scripts || scripts.length === 0) return fallback;
  const script = scripts[Math.min(callIndex, scripts.length - 1)];
  if (!script) return fallback;
  return typeof script === 'function'
    ? (script as (input: TInput, callIndex: number) => TOutput)(input, callIndex)
    : script;
}
