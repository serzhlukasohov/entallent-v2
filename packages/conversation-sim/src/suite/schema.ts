import { z } from 'zod';

/**
 * Single type source for the conversation evaluation suite (architecture AD-1, AD-3).
 * Every suite type is inferred from a schema here; this module imports only `zod`.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const LevelSchema = z.enum(['L0', 'L1', 'L2']);
export type Level = z.infer<typeof LevelSchema>;

export const LayerSchema = z.enum(['P', 'D', 'C', 'S']);
export type Layer = z.infer<typeof LayerSchema>;

export const CriterionStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_TESTABLE', 'INVALID', 'ERROR', 'NOT_RUN']);
export type CriterionStatus = z.infer<typeof CriterionStatusSchema>;

export const TestKindSchema = z.enum(['atomic', 'journey', 'observation']);
export type TestKind = z.infer<typeof TestKindSchema>;

export const SourceKindSchema = z.enum(['conversation', 'observation']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const FixtureNameSchema = z.enum([
  'clock',
  'seededHistory',
  'confirmationState',
  'pulseCycle',
  'pendingBotQuestion',
  'freshPersona',
  'disclosureDelivered',
  'proactiveUsers',
]);
export type FixtureName = z.infer<typeof FixtureNameSchema>;

export const StateQueryNameSchema = z.enum([
  'questionProgress',
  'stagedBundleCount',
  'surveyEvidenceCount',
  'outboundCount',
]);
export type StateQueryName = z.infer<typeof StateQueryNameSchema>;

// ---------------------------------------------------------------------------
// State query values (one schema per query, shared by every level)
// ---------------------------------------------------------------------------

const nonNegativeInt = z.number().int().nonnegative();

export const QuestionProgressValueSchema = z
  .object({ answered: nonNegativeInt, total: nonNegativeInt })
  .strict()
  .refine((value) => value.answered <= value.total, {
    message: 'answered must not exceed total',
    path: ['answered'],
  });
export type QuestionProgressValue = z.infer<typeof QuestionProgressValueSchema>;

export const CountValueSchema = nonNegativeInt;

export const STATE_QUERY_VALUE_SCHEMAS = {
  questionProgress: QuestionProgressValueSchema,
  stagedBundleCount: CountValueSchema,
  surveyEvidenceCount: CountValueSchema,
  outboundCount: CountValueSchema,
} as const satisfies Record<StateQueryName, z.ZodTypeAny>;

/** A snapshot holds only the queries the run needed; absent keys were not read. */
export const StateSnapshotSchema = z
  .object({
    questionProgress: QuestionProgressValueSchema.optional(),
    stagedBundleCount: CountValueSchema.optional(),
    surveyEvidenceCount: CountValueSchema.optional(),
    outboundCount: CountValueSchema.optional(),
  })
  .strict();
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

// ---------------------------------------------------------------------------
// Observation fields (AD-17)
// ---------------------------------------------------------------------------

export const OBSERVATION_FIELD_LITERALS = [
  'reply.text',
  'reply.messages',
  'turn.mode',
  'turn.intent',
  'turn.outcome',
  'turn.bundleReply',
  'turn.replyPlan',
  'state.questionProgress',
  'state.stagedBundleCount',
  'state.surveyEvidenceCount',
  'state.outboundCount',
  'window.outbound',
  'steps.gapMs',
  'events',
] as const;

const METADATA_FIELD_PATTERN = /^reply\.messages\[\]\.metadata\.[A-Za-z_][A-Za-z0-9_]*$/;
type MetadataField = `reply.messages[].metadata.${string}`;

export const ObservationFieldSchema = z.union([
  z.enum(OBSERVATION_FIELD_LITERALS),
  z.custom<MetadataField>((value) => typeof value === 'string' && METADATA_FIELD_PATTERN.test(value), {
    message: 'expected an observation field',
  }),
]);
export type ObservationField = z.infer<typeof ObservationFieldSchema>;

/**
 * True when `observed` declares `field`, either exactly or through a declared parent
 * path: `reply.messages` covers `reply.messages[].metadata.bundleKind`.
 */
export function fieldObserved(field: ObservationField, observed: readonly ObservationField[]): boolean {
  return observed.some((declared) => {
    if (declared === field) return true;
    if (!field.startsWith(declared)) return false;
    const next = field.charAt(declared.length);
    return next === '.' || next === '[';
  });
}

// ---------------------------------------------------------------------------
// Ids and evaluation points
// ---------------------------------------------------------------------------

const SOURCE_CASE_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const CRITERION_ID = /^[A-Z][A-Z0-9]*-\d+\.C[1-9]\d*$/;
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EVALUATED_AT = /^(?:reply:[1-9]\d*|after-step:[1-9]\d*|conversation|observation-window|state)$/;
const STATE_AT = /^(?:before|after|after-step:[1-9]\d*)$/;

/** A state snapshot name: `before`, `after` or `after-step:<n>`. */
export const StateAtSchema = z.string().regex(STATE_AT, 'expected before, after or after-step:<n>');

export type EvaluatedAt =
  | { kind: 'reply'; step: number }
  | { kind: 'after-step'; step: number }
  | { kind: 'conversation' }
  | { kind: 'observation-window' }
  | { kind: 'state' };

/** Parses a criterion's `evaluatedAt`; throws on anything the schema would reject. */
export function parseEvaluatedAt(value: string): EvaluatedAt {
  if (!EVALUATED_AT.test(value)) throw new Error(`invalid evaluatedAt: ${value}`);
  if (value === 'conversation' || value === 'observation-window' || value === 'state') {
    return { kind: value };
  }
  const [kind, step] = value.split(':') as ['reply' | 'after-step', string];
  return { kind, step: Number(step) };
}

/** Step named by a `stateQuery.at` value, or null for `before` / `after`. */
export function stateAtStep(value: string): number | null {
  const match = /^after-step:([1-9]\d*)$/.exec(value);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Checks, fixtures, seed and scripted outputs
// ---------------------------------------------------------------------------

const ParamsSchema = z.record(z.unknown());

export const FixtureRefSchema = z
  .object({
    name: FixtureNameSchema,
    // Each fixture validates its own params in the story that implements it.
    params: ParamsSchema.optional(),
  })
  .strict();
export type FixtureRef = z.infer<typeof FixtureRefSchema>;

export const RuleCheckSchema = z
  .object({
    type: z.literal('rule'),
    rule: z.string().regex(KEBAB, 'rule names are kebab-case'),
    params: ParamsSchema.optional(),
  })
  .strict();
export type RuleCheck = z.infer<typeof RuleCheckSchema>;

export const MeaningCheckSchema = z.object({ type: z.literal('meaning') }).strict();
export type MeaningCheck = z.infer<typeof MeaningCheckSchema>;

export const CheckSchema = z.discriminatedUnion('type', [RuleCheckSchema, MeaningCheckSchema]);
export type Check = z.infer<typeof CheckSchema>;

export const SeedTurnSchema = z
  .object({
    role: z.enum(['user', 'coach']),
    text: z.string().min(1),
    /** Offset before the evaluated turn. */
    atOffsetMs: nonNegativeInt,
    metadata: ParamsSchema.optional(),
  })
  .strict();
export type SeedTurn = z.infer<typeof SeedTurnSchema>;

export const SeedSchema = z
  .object({ history: z.array(SeedTurnSchema) })
  .strict()
  .superRefine((seed, ctx) => {
    seed.history.forEach((turn, index) => {
      const previous = seed.history[index - 1];
      if (previous && turn.atOffsetMs > previous.atOffsetMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['history', index, 'atOffsetMs'],
          message: 'seed offsets must be non-increasing (oldest turn first)',
        });
      }
    });
  });
export type Seed = z.infer<typeof SeedSchema>;

/** Plain-data model outputs for one turn; the L0 executor (12.7) turns them into `ScriptedAiOptions`. */
export const ScriptedStepSchema = z
  .object({
    step: z.number().int().min(1),
    classification: ParamsSchema.optional(),
    risk: ParamsSchema.optional(),
    memoryProposal: ParamsSchema.optional(),
    response: z
      .object({ text: z.string().min(1), bundleText: z.string().min(1).optional() })
      .strict()
      .optional(),
  })
  .strict();
export type ScriptedStep = z.infer<typeof ScriptedStepSchema>;

// ---------------------------------------------------------------------------
// Source manifest
// ---------------------------------------------------------------------------

export const StateEffectSchema = z
  .object({ port: z.string().min(1), method: z.string().min(1), expected: nonNegativeInt })
  .strict();
export type StateEffect = z.infer<typeof StateEffectSchema>;

export const SourceCriterionSchema = z
  .object({
    id: z.string().regex(CRITERION_ID, 'criterion ids are <sourceCase>.C<n>'),
    layer: LayerSchema,
    /** Suite text, verbatim. */
    passCondition: z.string().min(1),
    /** NOT TESTABLE and retirement (`retired: ...`) live only here. */
    notTestableReason: z.string().min(1).optional(),
    stateEffect: StateEffectSchema.optional(),
  })
  .strict();
export type SourceCriterion = z.infer<typeof SourceCriterionSchema>;

export const SourceCaseSchema = z
  .object({
    id: z.string().regex(SOURCE_CASE_ID, 'source case ids look like P-07'),
    requirement: z.array(z.string().min(1)),
    kind: SourceKindSchema,
    expectedBehavior: z.string().min(1),
    criteria: z.array(SourceCriterionSchema).min(1),
  })
  .strict()
  .superRefine((source, ctx) => {
    const seen = new Set<string>();
    source.criteria.forEach((criterion, index) => {
      if (!criterion.id.startsWith(`${source.id}.C`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['criteria', index, 'id'],
          message: `criterion id must start with ${source.id}.C`,
        });
      }
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['criteria', index, 'id'],
          message: `duplicate criterion id ${criterion.id}`,
        });
      }
      seen.add(criterion.id);
    });
  });
export type SourceCase = z.infer<typeof SourceCaseSchema>;

// ---------------------------------------------------------------------------
// Suite tests
// ---------------------------------------------------------------------------

export const StateQuerySchema = z
  .object({
    name: StateQueryNameSchema,
    at: StateAtSchema,
    kind: z.enum(['change', 'invariant']),
  })
  .strict();
export type StateQuery = z.infer<typeof StateQuerySchema>;

export const CriterionSchema = z
  .object({
    /** A manifest criterion id; `layer` and `passCondition` are joined from the manifest at load. */
    id: z.string().regex(CRITERION_ID, 'criterion ids are <sourceCase>.C<n>'),
    evaluatedAt: z.string().regex(EVALUATED_AT, 'expected reply:<n>, after-step:<n>, conversation, observation-window or state'),
    checks: z.array(CheckSchema).min(1),
    levels: z.array(LevelSchema).min(1).optional(),
    stateQuery: StateQuerySchema.optional(),
    independentOfCheckpoints: z.boolean().optional(),
    judgeGuidance: z.string().min(1).optional(),
  })
  .strict();
export type Criterion = z.infer<typeof CriterionSchema>;

export const CheckpointSchema = z
  .object({
    checks: z.array(RuleCheckSchema).min(1),
    onFail: z.enum(['continue', 'stop']),
  })
  .strict();
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const StepSchema = z
  .object({
    text: z.string().min(1),
    advanceClock: z.number().int().positive().optional(),
    checkpoint: CheckpointSchema.optional(),
  })
  .strict();
export type Step = z.infer<typeof StepSchema>;

export const ObservationWindowSchema = z
  .object({ durationMs: z.number().int().positive(), scanEveryMs: z.number().int().positive() })
  .strict();
export type ObservationWindow = z.infer<typeof ObservationWindowSchema>;

const SuiteTestObjectSchema = z
  .object({
    id: z.string().min(1),
    sourceCase: z.string().regex(SOURCE_CASE_ID, 'source case ids look like P-07'),
    requirement: z.array(z.string().min(1)),
    kind: TestKindSchema,
    levels: z.array(LevelSchema).min(1),
    runProfile: z.literal('isolated'),
    setup: z.array(FixtureRefSchema),
    seed: SeedSchema.optional(),
    scripted: z.array(ScriptedStepSchema).optional(),
    preconditions: z.array(RuleCheckSchema),
    steps: z.array(StepSchema),
    observationWindow: ObservationWindowSchema.optional(),
    criteria: z.array(CriterionSchema).min(1),
  })
  .strict();

type SuiteTestShape = z.infer<typeof SuiteTestObjectSchema>;

function refineSuiteTest(test: SuiteTestShape, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };

  if (new Set(test.levels).size !== test.levels.length) issue(['levels'], 'duplicate level');

  if (test.kind === 'atomic') {
    if (test.steps.length !== 1) issue(['steps'], 'atomic tests have exactly one step');
    if (!test.seed) issue(['seed'], 'atomic tests carry a seed (history may be empty)');
    if (test.levels.includes('L2')) issue(['levels'], 'atomic tests never declare L2');
  } else if (test.kind === 'journey') {
    if (test.steps.length < 1) issue(['steps'], 'journey tests have at least one step');
    if (test.seed) issue(['seed'], 'journey tests replay the sequence verbatim and carry no seed');
  } else {
    if (test.steps.length > 0) issue(['steps'], 'observation tests have no steps');
    if (test.seed) issue(['seed'], 'observation tests carry no seed');
    if (!test.observationWindow) issue(['observationWindow'], 'observation tests declare an observationWindow');
    if (test.levels.includes('L2')) issue(['levels'], 'observation tests never declare L2 (deferred at L2)');
  }
  if (test.kind !== 'observation' && test.observationWindow) {
    issue(['observationWindow'], 'only observation tests declare an observationWindow');
  }

  test.steps.forEach((step, index) => {
    if (step.checkpoint && test.kind !== 'journey') {
      issue(['steps', index, 'checkpoint'], 'checkpoints exist only in journey tests');
    }
  });

  if (test.kind !== 'observation' && test.scripted) {
    const seen = new Set<number>();
    test.scripted.forEach((scripted, index) => {
      if (scripted.step > test.steps.length) {
        issue(['scripted', index, 'step'], `step ${scripted.step} is outside 1..${test.steps.length}`);
      }
      if (seen.has(scripted.step)) issue(['scripted', index, 'step'], `duplicate scripted step ${scripted.step}`);
      seen.add(scripted.step);
    });
  }

  test.criteria.forEach((criterion, index) => {
    // Refinements also run on a dirty parse, so a malformed value is skipped, not thrown.
    if (!EVALUATED_AT.test(criterion.evaluatedAt)) return;
    const at = parseEvaluatedAt(criterion.evaluatedAt);
    const path = ['criteria', index];

    if (at.kind === 'reply' && test.kind === 'observation') {
      issue([...path, 'evaluatedAt'], 'observation tests have no reply:<n> criterion');
    } else if ((at.kind === 'reply' || at.kind === 'after-step') && at.step > test.steps.length) {
      issue([...path, 'evaluatedAt'], `step ${at.step} is outside 1..${test.steps.length}`);
    }
    if (at.kind === 'observation-window' && test.kind !== 'observation') {
      issue([...path, 'evaluatedAt'], 'observation-window criteria belong to observation tests');
    }

    if (at.kind === 'state' && !criterion.stateQuery) {
      issue([...path, 'stateQuery'], 'state criteria require a stateQuery');
    }
    if (at.kind !== 'state' && criterion.stateQuery) {
      issue([...path, 'stateQuery'], 'stateQuery is allowed only on state criteria');
    }
    if (criterion.stateQuery) {
      const step = stateAtStep(criterion.stateQuery.at);
      if (step !== null && step > test.steps.length) {
        issue([...path, 'stateQuery', 'at'], `step ${step} is outside 1..${test.steps.length}`);
      }
    }

    criterion.levels?.forEach((level, levelIndex) => {
      if (!test.levels.includes(level)) {
        issue([...path, 'levels', levelIndex], `level ${level} is not declared by the test`);
      }
    });
  });
}

export const SuiteTestSchema = SuiteTestObjectSchema.superRefine(refineSuiteTest);
export type SuiteTest = z.infer<typeof SuiteTestSchema>;

/** A test criterion after the loader joined `layer` and `passCondition` from the manifest. */
export type LoadedCriterion = Criterion & Pick<SourceCriterion, 'layer' | 'passCondition' | 'stateEffect'>;
/** `expectedBehavior` is joined from the source case at load (13.1); `evaluate` with a judge requires it. */
export type LoadedTest = Omit<SuiteTest, 'criteria'> & { criteria: LoadedCriterion[]; expectedBehavior?: string };
export interface LoadedSuite {
  id: string;
  sources: SourceCase[];
  tests: LoadedTest[];
}

// ---------------------------------------------------------------------------
// Observations (AD-3)
// ---------------------------------------------------------------------------

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const ReplyMessageSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    occurredAt: IsoTimestampSchema,
    metadata: ParamsSchema,
  })
  .strict();
export type ReplyMessage = z.infer<typeof ReplyMessageSchema>;

/** Orchestrator decisions; values stay plain strings as `OrchestrateResult` produces them. */
export const TurnTraceSchema = z
  .object({
    mode: z.string().optional(),
    intent: z.string().optional(),
    outcome: z.string().optional(),
    bundleReply: z.string().optional(),
    replyPlan: ParamsSchema.optional(),
  })
  .strict();
export type TurnTrace = z.infer<typeof TurnTraceSchema>;

export const REPLY_MESSAGE_SEPARATOR = '\n\n';

export const StepReplySchema = z
  .object({ messages: z.array(ReplyMessageSchema).min(1), text: z.string() })
  .strict()
  .refine((reply) => reply.text === reply.messages.map((message) => message.text).join(REPLY_MESSAGE_SEPARATOR), {
    message: 'reply.text must equal the message texts joined by a blank line',
    path: ['text'],
  });
export type StepReply = z.infer<typeof StepReplySchema>;

export const StepObservationSchema = z
  .object({
    /** 1-based, equal to the position in the test's steps. */
    index: z.number().int().min(1),
    userText: z.string(),
    traceId: z.string().min(1),
    gapMs: nonNegativeInt,
    /** `null` is observed product silence, evaluated rather than treated as ERROR. */
    reply: StepReplySchema.nullable(),
    unsolicited: z.array(ReplyMessageSchema),
    turn: TurnTraceSchema.optional(),
  })
  .strict();
export type StepObservation = z.infer<typeof StepObservationSchema>;

export const RunEventSchema = z
  .object({
    /** 0 covers fixtures and seed. */
    stepIndex: nonNegativeInt,
    seq: nonNegativeInt,
    port: z.string().min(1),
    method: z.string().min(1),
    argsSummary: z.string(),
    outcome: z.enum(['ok', 'error']),
    resultSummary: z.string(),
    durationMs: z.number().nonnegative(),
    model: z
      .object({ name: z.string().min(1), settings: ParamsSchema, request: z.unknown(), response: z.unknown() })
      .strict()
      .optional(),
  })
  .strict();
export type RunEvent = z.infer<typeof RunEventSchema>;

export const PreconditionResultSchema = z
  .object({
    source: z.enum(['fixture', 'rule']),
    name: z.string().min(1),
    satisfied: z.boolean(),
    detail: z.string().optional(),
  })
  .strict();
export type PreconditionResult = z.infer<typeof PreconditionResultSchema>;

export const ExecutionErrorSchema = z
  .object({
    kind: z.enum(['product', 'infrastructure']),
    /** 0 covers fixtures and seed. */
    step: nonNegativeInt,
    reason: z.string().min(1),
    message: z.string(),
  })
  .strict();
export type ExecutionError = z.infer<typeof ExecutionErrorSchema>;

export const CaseRunSchema = z
  .object({
    testId: z.string().min(1),
    level: LevelSchema,
    attempt: z.number().int().min(1),
    subject: z
      .object({
        externalUserId: z.string().min(1),
        userId: z.string().optional(),
        conversationId: z.string().optional(),
        tenantId: z.string().optional(),
      })
      .strict(),
    observed: z.array(ObservationFieldSchema),
    preconditions: z.array(PreconditionResultSchema),
    steps: z.array(StepObservationSchema),
    window: z
      .object({ from: IsoTimestampSchema, to: IsoTimestampSchema, outbound: z.array(ReplyMessageSchema) })
      .strict()
      .optional(),
    state: z
      .object({
        before: StateSnapshotSchema,
        after: StateSnapshotSchema,
        afterStep: z.record(z.string().regex(/^[1-9]\d*$/), StateSnapshotSchema),
      })
      .strict(),
    stoppedAtStep: z.number().int().min(1).optional(),
    errors: z.array(ExecutionErrorSchema),
    events: z.array(RunEventSchema),
    /** The executor clock's range (12.7); `clock-leak` checks every message timestamp against it. */
    clock: z.object({ from: IsoTimestampSchema, to: IsoTimestampSchema }).strict().optional(),
  })
  .strict()
  .superRefine((run, ctx) => {
    if (run.clock && Date.parse(run.clock.from) > Date.parse(run.clock.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clock', 'to'], message: 'clock.to must not precede clock.from' });
    }
    run.steps.forEach((step, position) => {
      if (step.index !== position + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', position, 'index'],
          message: `step index must be ${position + 1}`,
        });
      }
    });
  });
export type CaseRun = z.infer<typeof CaseRunSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const MethodSchema = z.enum(['observed', 'substituted', 'n/a']);
export type Method = z.infer<typeof MethodSchema>;

/** Judge usage summed over every judge call one result made (AD-7); missing token counts are 0. */
export const JudgeUsageSchema = z
  .object({ calls: nonNegativeInt, inputTokens: nonNegativeInt, outputTokens: nonNegativeInt, totalTokens: nonNegativeInt })
  .strict();
export type JudgeUsage = z.infer<typeof JudgeUsageSchema>;

export const CriterionResultSchema = z
  .object({
    testId: z.string().min(1),
    criterionId: z.string().regex(CRITERION_ID),
    sourceCase: z.string().regex(SOURCE_CASE_ID),
    level: LevelSchema,
    layer: LayerSchema,
    testKind: TestKindSchema,
    /** False for `level-not-declared` and `no-judge-at-level`; out-of-scope results never count (AD-9). */
    inScope: z.boolean(),
    /** The step the criterion is evaluated at (0 for observation tests). */
    step: nonNegativeInt.optional(),
    status: CriterionStatusSchema,
    advisory: z.boolean(),
    method: MethodSchema,
    reason: z.string().optional(),
    evidence: z.string().optional(),
    meaningSkipped: z.boolean().optional(),
    /** Present on every meaning-decided result (judge PASS/FAIL/ERROR and `no-reply`). */
    judgeUsage: JudgeUsageSchema.optional(),
  })
  .strict();
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

// ---------------------------------------------------------------------------
// Judge trust (AD-8)
// ---------------------------------------------------------------------------

/** Computed once per run by the runner; `evaluate`, `score` and `report` copy it verbatim. */
export const JudgeTrustSchema = z
  .object({
    trusted: z.boolean(),
    reason: z.string().min(1),
    /** The configured judge fingerprint (AD-8); `null` at L0. Kept the pin even for an unpinned run. */
    pin: z.lazy(() => JudgeFingerprintSchema).nullable(),
    /** The agreement file the decision was made against; `null` when absent (or at L0). */
    agreement: z.lazy(() => AgreementFileSchema).nullable(),
  })
  .strict();
export type JudgeTrust = z.infer<typeof JudgeTrustSchema>;

// ---------------------------------------------------------------------------
// Scoring and reports (AD-9, AD-11)
// ---------------------------------------------------------------------------

/** `<testId>/<criterionId>`, or `<sourceCase>/<criterionId>` for manifest NOT TESTABLE rows. */
export type TestCriterionKey = string;

export const VerdictSchema = z.enum(['ADEQUATE', 'ACCEPTABLE WITH ISSUES', 'NOT ADEQUATE', 'n/a (journeys only)']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const CriterionSampleSchema = z
  .object({
    status: CriterionStatusSchema,
    advisory: z.boolean(),
    reason: z.string().optional(),
    evidence: z.string().optional(),
    meaningSkipped: z.boolean().optional(),
  })
  .strict();
export type CriterionSample = z.infer<typeof CriterionSampleSchema>;

export const CheckKindSchema = z.enum(['rule', 'meaning']);
export type CheckKind = z.infer<typeof CheckKindSchema>;

export const ScoredCriterionSchema = z
  .object({
    testId: z.string().min(1),
    criterionId: z.string().regex(CRITERION_ID),
    sourceCase: z.string().regex(SOURCE_CASE_ID),
    /** `null` for manifest NOT TESTABLE rows, which belong to no test. */
    testKind: TestKindSchema.nullable(),
    layer: LayerSchema,
    inScope: z.boolean(),
    status: CriterionStatusSchema,
    passCount: nonNegativeInt,
    n: z.number().int().min(1),
    /** Passes needed for PASS: n/n for rule-decided, ceil(0.8n) for meaning-decided criteria. */
    minPasses: nonNegativeInt,
    /** `meaning` when a meaning check decided it (as for `minPasses`), else `rule`; `null` for manifest NOT TESTABLE rows. */
    checkKind: CheckKindSchema.nullable(),
    advisory: z.boolean(),
    method: MethodSchema,
    reason: z.string().optional(),
    evidence: z.string().optional(),
    samples: z.array(CriterionSampleSchema),
  })
  .strict();
export type ScoredCriterion = z.infer<typeof ScoredCriterionSchema>;

export const LayerRowSchema = z
  .object({
    layer: LayerSchema,
    pass: nonNegativeInt,
    fail: nonNegativeInt,
    /** PASS / (PASS + FAIL) over non-advisory atomic and observation results; null when both are 0. */
    passRate: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type LayerRow = z.infer<typeof LayerRowSchema>;

export const LayerTableSchema = z
  .object({
    rows: z.array(LayerRowSchema),
    /** Combined P+D+C pass rate the verdict is decided on. */
    combinedPdc: LayerRowSchema.omit({ layer: true }),
  })
  .strict();
export type LayerTable = z.infer<typeof LayerTableSchema>;

export const JourneySectionSchema = z
  .object({
    keys: z.array(z.string()),
    counts: z.record(CriterionStatusSchema, nonNegativeInt),
  })
  .strict();
export type JourneySection = z.infer<typeof JourneySectionSchema>;

export const CoverageRowSchema = z
  .object({
    requirement: z.array(z.string()),
    sourceCase: z.string().regex(SOURCE_CASE_ID),
    /** `null` when no test covers the criterion (manifest NOT TESTABLE). */
    testId: z.string().nullable(),
    criterionId: z.string().regex(CRITERION_ID),
    layer: LayerSchema,
    status: CriterionStatusSchema.nullable(),
    reason: z.string().optional(),
  })
  .strict();
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

export const CoverageSchema = z
  .object({
    rows: z.array(CoverageRowSchema),
    notTestable: z.array(z.object({ key: z.string(), reason: z.string() }).strict()),
    /** Criteria every check of which is a meaning check (decided only by a judge). */
    judgeOnly: z.array(z.string()),
    unobservable: z.array(z.object({ key: z.string(), field: z.string() }).strict()),
  })
  .strict();
export type Coverage = z.infer<typeof CoverageSchema>;

export const JudgeErrorSchema = z
  .object({ key: z.string().min(1), reason: z.string().min(1), message: z.string().optional() })
  .strict();
export type JudgeError = z.infer<typeof JudgeErrorSchema>;

export const UsageSchema = z.record(z.number().nonnegative());

export const BudgetKindSchema = z.enum(['coach', 'judge']);
export type BudgetKind = z.infer<typeof BudgetKindSchema>;

/** The run's call budgets and what was spent (AD-15); `exceeded` names every budget a call or case was refused for. */
export const RunBudgetReportSchema = z
  .object({
    maxCoachCalls: z.number().int().min(1),
    maxJudgeCalls: z.number().int().min(1),
    coachCalls: z.number().int().min(0),
    judgeCalls: z.number().int().min(0),
    exceeded: z.array(BudgetKindSchema),
  })
  .strict();
export type RunBudgetReport = z.infer<typeof RunBudgetReportSchema>;

const nullableTokens = z.number().int().min(0).nullable();

/** Calls and tokens per model; coach tokens are `null` (not observable through `AiProviderPort`). */
export const ModelUsageRowSchema = z
  .object({
    role: BudgetKindSchema,
    model: z.string().min(1),
    calls: z.number().int().min(0),
    inputTokens: nullableTokens,
    outputTokens: nullableTokens,
    totalTokens: nullableTokens,
  })
  .strict();
export type ModelUsageRow = z.infer<typeof ModelUsageRowSchema>;

/**
 * One meaning-based FAIL sample for QA review (AD-8): an in-scope FAIL decided by the judge
 * (or `no-reply`), with the evaluated reply texts and the judge reason. Rule FAILs are
 * never listed. `replies` is empty for `no-reply`.
 */
export const QaReviewEntrySchema = z
  .object({
    key: z.string().min(1),
    testId: z.string().min(1),
    sourceCase: z.string().regex(SOURCE_CASE_ID),
    criterionId: z.string().regex(CRITERION_ID),
    layer: LayerSchema,
    sample: z.number().int().min(1),
    advisory: z.boolean(),
    replies: z.array(z.string()),
    reason: z.string().min(1),
  })
  .strict();
export type QaReviewEntry = z.infer<typeof QaReviewEntrySchema>;
export type Usage = z.infer<typeof UsageSchema>;

/** Provenance of an accepted baseline (AD-11); shared by `Baseline` and `SuiteDiff`. */
export const AcceptedFromSchema = z
  .object({ runId: z.string().min(1), gitSha: z.string().min(1), ciRunUrl: z.string().url().optional() })
  .strict();
export type AcceptedFrom = z.infer<typeof AcceptedFromSchema>;

// ---------------------------------------------------------------------------
// Baseline diff (AD-13)
// ---------------------------------------------------------------------------

/** In print order: `lost-coverage` first, `unchanged` last. */
export const DiffCategorySchema = z.enum([
  'lost-coverage',
  'regressed',
  'fixed',
  'gained-coverage',
  'new',
  'retired',
  'inconclusive',
  'unchanged',
]);
export type DiffCategory = z.infer<typeof DiffCategorySchema>;

export const DiffEntrySchema = z
  .object({
    key: z.string().min(1),
    testId: z.string().min(1),
    criterionId: z.string().regex(CRITERION_ID),
    layer: LayerSchema,
    testKind: TestKindSchema.nullable(),
    checkKind: CheckKindSchema.nullable(),
    category: DiffCategorySchema,
    gating: z.boolean(),
    /** `null` for `new`. */
    baseline: z.object({ status: CriterionStatusSchema, passCount: nonNegativeInt, n: z.number().int().min(1) }).strict().nullable(),
    /** `null` when the key is missing from the run's in-scope results. */
    current: z
      .object({ status: CriterionStatusSchema, passCount: nonNegativeInt, n: z.number().int().min(1), minPasses: nonNegativeInt })
      .strict()
      .nullable(),
  })
  .strict();
export type DiffEntry = z.infer<typeof DiffEntrySchema>;

export const DiffSectionSchema = z
  .object({
    entries: z.array(DiffEntrySchema),
    counts: z.record(DiffCategorySchema, nonNegativeInt),
  })
  .strict();
export type DiffSection = z.infer<typeof DiffSectionSchema>;

export const DiffOutcomeSchema = z.enum([
  'clean',
  'no-baseline',
  'failed',
  'baseline-invalid',
  'judge-infrastructure',
  'budget-exceeded',
]);
export type DiffOutcome = z.infer<typeof DiffOutcomeSchema>;

export const DiffBaselineSourceSchema = z
  .object({
    /** `path`: `--baseline`; `merge-base`: `git show <merge-base>:<path>`; `default`: working-tree `baselines/<suite>/<level>.json`. */
    kind: z.enum(['path', 'merge-base', 'default']),
    /** The merge-base commit for `merge-base`, else `null`. */
    ref: z.string().nullable(),
    path: z.string().min(1),
    missing: z.boolean(),
  })
  .strict();
export type DiffBaselineSource = z.infer<typeof DiffBaselineSourceSchema>;

/** `suite:diff` result, stored as `SuiteRunReport.diff` (a later diff replaces it). */
export const SuiteDiffSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseline: DiffBaselineSourceSchema,
    acceptedFrom: AcceptedFromSchema.nullable(),
    /** The baseline's `provisional` flag; `false` without a baseline. */
    provisional: z.boolean(),
    outcome: DiffOutcomeSchema,
    exitCode: z.number().int().min(0).max(4),
    reasons: z.array(z.string()),
    /** Atomic, observation and manifest NOT TESTABLE pairs. */
    tests: DiffSectionSchema,
    journeys: DiffSectionSchema,
  })
  .strict();
export type SuiteDiff = z.infer<typeof SuiteDiffSchema>;

export const SuiteRunReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** `<ISO timestamp with - for : and .>-<short sha>`, as in `run-gate.ts`. */
    runId: z.string().min(1),
    suiteId: z.string().min(1),
    level: LevelSchema,
    n: z.number().int().min(1),
    git: z.object({ sha: z.string().nullable(), dirty: z.boolean() }).strict(),
    models: z.object({ coach: z.string().nullable(), judge: z.string().nullable() }).strict(),
    judgeTrust: JudgeTrustSchema,
    results: z.record(ScoredCriterionSchema),
    /** `null` when only journeys are in scope. */
    layers: LayerTableSchema.nullable(),
    verdict: VerdictSchema,
    complete: z.boolean(),
    provisional: z.boolean(),
    provisionalReason: z.string().optional(),
    coverage: CoverageSchema,
    journeys: JourneySectionSchema,
    judgeErrors: z.array(JudgeErrorSchema),
    /** Every meaning FAIL for QA review; optional only so pre-13.3 reports parse (always written since). */
    qaReview: z.array(QaReviewEntrySchema).optional(),
    usage: UsageSchema,
    /** Call budgets of the invocation; optional only so pre-13.5 reports parse. */
    budget: RunBudgetReportSchema.optional(),
    /** Calls and tokens per model; optional only so pre-13.5 reports parse. */
    modelUsage: z.array(ModelUsageRowSchema).optional(),
    /** Present when `--case` narrowed the run; such runs are never accepted as baselines. */
    selection: z.object({ case: z.string().min(1) }).strict().optional(),
    /** Written by `suite:diff` (AD-13); absent until a diff ran. */
    diff: SuiteDiffSchema.optional(),
  })
  .strict();
export type SuiteRunReport = z.infer<typeof SuiteRunReportSchema>;

// ---------------------------------------------------------------------------
// Suite config (suite.config.json) and baselines (AD-8, AD-11, AD-15)
// ---------------------------------------------------------------------------

const positiveInt = z.number().int().min(1);

export const SuiteConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    suites: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'suite ids are lowercase kebab-case'))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'suite ids must be unique' }),
    levels: z.array(LevelSchema).min(1),
    /** Realized before every journey step after the first (AD-18). */
    interMessageGapMs: nonNegativeInt,
    baseline: z
      .object({ minSamples: z.object({ L0: positiveInt, L1: positiveInt, L2: positiveInt }).strict() })
      .strict(),
    diff: z.object({ minSamples: z.object({ L1: positiveInt, L2: positiveInt }).strict() }).strict(),
    /** Re-runs of a case whose errors are all infrastructure (AD-18). */
    retries: z.object({ infrastructure: z.number().int().min(0).max(3) }).strict(),
    /**
     * Absolute per invocation (all `--runs` samples, retries included; AD-15). The judge
     * timeout lives here, not under `judge`, so the fingerprint (AD-8) is unaffected.
     */
    budgets: z
      .object({
        maxCoachCallsPerRun: positiveInt,
        maxJudgeCallsPerRun: positiveInt,
        coachCallTimeoutMs: positiveInt,
        judgeCallTimeoutMs: positiveInt,
      })
      .strict(),
    judge: z
      .object({
        provider: z.enum(['openai', 'azure_openai']),
        model: z.string().min(1),
        decoding: z
          .object({
            temperature: z.number().min(0).max(2),
            reasoningEffort: z.string().min(1).nullable(),
            maxOutputTokens: positiveInt,
          })
          .strict(),
        agreementThreshold: z.object({ overall: z.number().min(0).max(1), kappa: z.number().min(-1).max(1) }).strict(),
        minLabels: positiveInt,
      })
      .strict(),
  })
  .strict();
export type SuiteConfig = z.infer<typeof SuiteConfigSchema>;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** The pinned judge plus run-time hashes of its prompt, schema and guidance (AD-8). */
export const JudgeFingerprintSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    decoding: z
      .object({
        temperature: z.number(),
        reasoningEffort: z.string().nullable(),
        maxOutputTokens: positiveInt,
      })
      .strict(),
    promptSha256: Sha256Schema,
    schemaSha256: Sha256Schema,
    guidanceSha256: Sha256Schema,
  })
  .strict();
export type JudgeFingerprint = z.infer<typeof JudgeFingerprintSchema>;

// ---------------------------------------------------------------------------
// Calibration labels, QA exports and the agreement file (AD-8, Story 13.2)
// ---------------------------------------------------------------------------

export const LabelStatusSchema = z.enum(['PASS', 'FAIL']);
export type LabelStatus = z.infer<typeof LabelStatusSchema>;

export const LabelTurnSchema = z.object({ role: z.enum(['user', 'coach']), text: z.string() }).strict();
export type LabelTurn = z.infer<typeof LabelTurnSchema>;

/**
 * A non-null `evaluatedReplyIndex` is the last turn and that turn is `coach`; a null one
 * (a `conversation` criterion) needs at least one `coach` turn.
 */
export const LabelTranscriptSchema = z
  .object({
    turns: z.array(LabelTurnSchema).min(1),
    evaluatedReplyIndex: nonNegativeInt.nullable(),
  })
  .strict()
  .superRefine((transcript, ctx) => {
    const index = transcript.evaluatedReplyIndex;
    if (index === null) {
      if (!transcript.turns.some((turn) => turn.role === 'coach')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['turns'], message: 'a conversation label needs at least one coach turn' });
      }
      return;
    }
    if (index !== transcript.turns.length - 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluatedReplyIndex'], message: 'evaluatedReplyIndex must be the last turn' });
    } else if (transcript.turns[index]?.role !== 'coach') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluatedReplyIndex'], message: 'the evaluated turn must be a coach turn' });
    }
  });
export type LabelTranscript = z.infer<typeof LabelTranscriptSchema>;

export const LabelSchema = z
  .object({
    criterionId: z.string().regex(CRITERION_ID, 'criterion ids are <sourceCase>.C<n>'),
    status: LabelStatusSchema,
    transcript: LabelTranscriptSchema,
    /** Provenance only; never read for judging. */
    source: z.object({ kind: z.enum(['qa-session', 'suite-run']), ref: z.string().min(1) }).strict(),
    labeler: z.string().min(1),
    labeledAt: IsoTimestampSchema,
  })
  .strict();
export type Label = z.infer<typeof LabelSchema>;

/** `calibration/<suiteId>/labels.json`; an absent file means zero labels. */
export const LabelsFileSchema = z.object({ schemaVersion: z.literal(1), labels: z.array(LabelSchema) }).strict();
export type LabelsFile = z.infer<typeof LabelsFileSchema>;

/**
 * QA session export (assumed format until QA confirms theirs). `replyIndex` indexes
 * `dialogue` and must name a `coach` turn; `null` means the whole conversation.
 */
export const QaSessionExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessions: z.array(
      z
        .object({
          ref: z.string().min(1),
          labeler: z.string().min(1),
          labeledAt: IsoTimestampSchema,
          dialogue: z.array(LabelTurnSchema).min(1),
          statuses: z
            .array(
              z
                .object({
                  criterionId: z.string().regex(CRITERION_ID, 'criterion ids are <sourceCase>.C<n>'),
                  status: LabelStatusSchema,
                  replyIndex: nonNegativeInt.nullable(),
                })
                .strict(),
            )
            .min(1),
        })
        .strict()
        .superRefine((session, ctx) => {
          session.statuses.forEach((status, index) => {
            if (status.replyIndex === null) return;
            const turn = session.dialogue[status.replyIndex];
            if (turn === undefined) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statuses', index, 'replyIndex'], message: 'replyIndex is outside the dialogue' });
            } else if (turn.role !== 'coach') {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statuses', index, 'replyIndex'], message: 'replyIndex must name a coach turn' });
            }
          });
        }),
    ),
  })
  .strict();
export type QaSessionExport = z.infer<typeof QaSessionExportSchema>;

const AgreementRateSchema = z.number().min(0).max(1).nullable();
const KappaSchema = z.number().nullable();

export const AgreementStatsSchema = z
  .object({ n: nonNegativeInt, overall: AgreementRateSchema, kappa: KappaSchema })
  .strict();
export type AgreementStats = z.infer<typeof AgreementStatsSchema>;

/** The calibration agreement file, written only by `suite:calibrate` through `judge/calibrate.ts` (AD-8). */
export const AgreementFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    fingerprint: JudgeFingerprintSchema,
    labelsSha256: Sha256Schema,
    n: nonNegativeInt,
    overall: AgreementRateSchema,
    kappa: KappaSchema,
    perLayer: z.object({ P: AgreementStatsSchema, D: AgreementStatsSchema, C: AgreementStatsSchema, S: AgreementStatsSchema }).strict(),
    computedAt: IsoTimestampSchema,
  })
  .strict();
export type AgreementFile = z.infer<typeof AgreementFileSchema>;

export const BaselineResultSchema = z
  .object({
    status: CriterionStatusSchema,
    passCount: nonNegativeInt,
    n: positiveInt,
    /** Layer and kinds let the diff judge a criterion that vanished from the run (AD-13). */
    layer: LayerSchema,
    testKind: TestKindSchema.nullable(),
    checkKind: CheckKindSchema.nullable(),
    /**
     * The run result was advisory (an untrusted judge decided it); such meaning entries diff
     * as `inconclusive` (AD-13). Absent in pre-13.5 baselines, read as `false`.
     */
    advisory: z.boolean().optional(),
  })
  .strict();
export type BaselineResult = z.infer<typeof BaselineResultSchema>;

/** Committed at `baselines/<suiteId>/<level>.json`, written only by `suite:baseline:accept` (AD-11). */
export const BaselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    suiteId: z.string().min(1),
    level: LevelSchema,
    /** Both `null` at L0 (no judge). */
    judge: z.object({ fingerprint: JudgeFingerprintSchema.nullable(), agreement: AgreementFileSchema.nullable() }).strict(),
    coach: z.object({ model: z.string().nullable() }).strict(),
    acceptedFrom: AcceptedFromSchema,
    acceptedAt: IsoTimestampSchema,
    /** True when the run was INCOMPLETE or its verdict provisional (`--allow-incomplete`). */
    provisional: z.boolean(),
    /** Every in-scope criterion of the run, keyed `<testId>/<criterionId>`. */
    results: z.record(BaselineResultSchema),
  })
  .strict();
export type Baseline = z.infer<typeof BaselineSchema>;

/** Output of `score`; a plain in-memory value, not a persisted artifact. */
export interface SuiteScore {
  suite: LoadedSuite;
  level: Level;
  n: number;
  results: ScoredCriterion[];
  layers: LayerTable | null;
  verdict: Verdict;
  complete: boolean;
  provisional: boolean;
  provisionalReason?: string;
  journeys: JourneySection;
}
