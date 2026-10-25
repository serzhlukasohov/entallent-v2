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
export type LoadedTest = Omit<SuiteTest, 'criteria'> & { criteria: LoadedCriterion[] };
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
    pin: z.unknown().nullable(),
    agreement: z.unknown().nullable(),
  })
  .strict();
export type JudgeTrust = z.infer<typeof JudgeTrustSchema> & { pin: unknown; agreement: unknown };

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
export type Usage = z.infer<typeof UsageSchema>;

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
    usage: UsageSchema,
  })
  .strict();
export type SuiteRunReport = z.infer<typeof SuiteRunReportSchema>;

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
