import type { OnboardingState, QuestionInsightStatus } from '@entalent/application';
import { z } from 'zod';

/** The only precondition format this harness understands; anything else is rejected, never guessed. */
export const PRECONDITION_SCHEMA_VERSION = 1;

export const PRESET_NAMES = ['onboarding-done', 'cycle-open', 'elapsed'] as const;

const isoDateTime = z.string().datetime({ offset: true });

/** Statuses of a V2 working insight (`QUESTION_INSIGHT_STATUSES` in the application package). */
export const QUESTION_STATUSES = [
  'collecting',
  'pending_confirmation',
  'pending_clarification',
  'confirmed',
  'declined',
  'no_data',
  'reset',
] as const;

const originSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authored'), author: z.string().optional() }).strict(),
  z.object({
    kind: z.literal('recorded'),
    /** False: a candidate, which tests refuse until `pnpm sim:approve` (or a PR reviewer) approves it. */
    approved: z.boolean(),
    approvedAt: isoDateTime.optional(),
    approvedBy: z.string().min(1).optional(),
    /** Real time the recording ran. */
    recordedAt: isoDateTime.optional(),
    /** Recording file the replies came from. */
    recordedFrom: z.string().min(1).optional(),
    /** Name of the precondition the recording started from. */
    base: z.string().min(1).optional(),
    /** `scripted`: the bot replies came from a scripted provider, not the real model. */
    provider: z.enum(['live', 'scripted']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('trace'),
    tenantId: z.string().min(1),
    /** Trace row id (`conversation_turn_traces.id`) of the turn this precondition stands before. */
    turnId: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    /** When the traced turn started. */
    tracedAt: isoDateTime.optional(),
  }).strict(),
]);

const presetSchema = z.preprocess(
  (value) => (typeof value === 'string' ? { name: value } : value),
  z.discriminatedUnion('name', [
    z.object({ name: z.literal('onboarding-done') }).strict(),
    z.object({
      name: z.literal('cycle-open'),
      /** At most the four real pulse groups (autonomy, belonging, growth, purpose). */
      topicsTotal: z.number().int().min(1).max(4),
      topicsClosed: z.number().int().min(0),
    }).strict(),
    z.object({ name: z.literal('elapsed'), minutes: z.number().min(0) }).strict(),
  ]).superRefine((preset, context) => {
    if (preset.name === 'cycle-open' && preset.topicsClosed > preset.topicsTotal) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'topicsClosed cannot exceed topicsTotal', path: ['topicsClosed'] });
    }
  }),
);

const historyEntrySchema = z.object({
  role: z.enum(['employee', 'bot']),
  text: z.string().min(1),
  /** Absent: spaced 60 s apart, the last one `elapsedMinutes` before the start time. */
  minutesBeforeStart: z.number().min(0).optional(),
  /** Stored as message metadata, for example `reportingDisclosureVersion` on a bot message. */
  metadata: z.record(z.unknown()).optional(),
}).strict();

const memorySchema = z.object({
  category: z.string().min(1),
  content: z.string().min(1),
  importance: z.number().min(0).max(1).default(0.7),
}).strict();

const goalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default('work'),
  status: z.enum(['active', 'completed', 'cancelled']).default('active'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
}).strict();

const styleProfileSchema = z.object({
  dimensions: z.object({
    register: z.number().min(0).max(1),
    humor: z.number().min(0).max(1),
    verbosity: z.number().min(0).max(1),
    emoji: z.number().min(0).max(1),
  }).strict(),
  phrases: z.array(z.object({ text: z.string().min(1), count: z.number().int().min(1) }).strict()).default([]),
  adaptationWeight: z.number().min(0).max(1),
  conversationsAnalyzed: z.number().int().min(0).default(1),
}).strict();

const INTRO_STATUSES = ['pending', 'delivered', 'completed'] as const;
const PARTICIPATIONS = ['undecided', 'deferred', 'active', 'declined', 'not_applicable'] as const;
const REMINDER_STATUSES = ['none', 'scheduled', 'sent', 'cancelled'] as const;

/** Fails typecheck when a hand-copied enum drifts from the application type, in either direction. */
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const enumsMatchApplication: [
  SameMembers<(typeof QUESTION_STATUSES)[number], QuestionInsightStatus>,
  SameMembers<(typeof INTRO_STATUSES)[number], OnboardingState['introStatus']>,
  SameMembers<(typeof PARTICIPATIONS)[number], OnboardingState['participation']>,
  SameMembers<(typeof REMINDER_STATUSES)[number], OnboardingState['reminderStatus']>,
] = [true, true, true, true];
void enumsMatchApplication;

const onboardingSchema = z.object({
  /** Base state comes from `initialOnboardingState(role)`; the fields below override it. */
  role: z.enum(['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership']).default('employee'),
  introStatus: z.enum(INTRO_STATUSES).optional(),
  participation: z.enum(PARTICIPATIONS).optional(),
  reminderStatus: z.enum(REMINDER_STATUSES).optional(),
  buttonsActive: z.boolean().optional(),
  /** Absent with a completed intro: one day before the start time. */
  completedAt: isoDateTime.nullable().optional(),
  managementAckAt: isoDateTime.nullable().optional(),
  reminderOriginAt: isoDateTime.nullable().optional(),
}).strict();

const evidenceSchema = z.object({
  summary: z.string().min(1),
  status: z.enum(['temporary', 'confirmed', 'withdrawn']).default('temporary'),
  /** 0-based indexes into `history` of the messages the evidence came from. */
  sourceHistoryIndexes: z.array(z.number().int().min(0)).default([]),
}).strict();

const questionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(QUESTION_STATUSES),
  title: z.string().optional(),
  canonicalMeaning: z.string().optional(),
  probeStrategies: z.array(z.string()).optional(),
  responseType: z.enum(['open_ended', 'numeric_0_10']).optional(),
  version: z.string().optional(),
}).strict();

const topicSchema = z.object({
  group: z.string().min(1),
  questions: z.array(questionSchema).min(1),
  evidence: z.array(evidenceSchema).default([]),
}).strict();

const pulseCycleSchema = z.object({
  /** False: no active V2 window, so the orchestrator sees no cycle at all. */
  open: z.boolean().default(true),
  surveyWindowId: z.string().min(1).default('sim-window'),
  topics: z.array(topicSchema).default([]),
  /** What `getNextProbeQuestion` returns; the question must be one of `topics`. Absent: nothing to probe. */
  nextProbe: z.object({
    questionId: z.string().min(1),
    focus: z.enum(['open', 'driver']).default('open'),
  }).strict().nullable().optional(),
}).strict();

const scheduledActionSchema = z.object({
  type: z.string().min(1),
  intent: z.string().min(1),
  /** Minutes after the start time the action is due. */
  dueInMinutes: z.number(),
  reason: z.string().optional(),
  context: z.record(z.unknown()).default({}),
}).strict();

/** Every state area; presets produce partial bodies of this shape. */
const bodySchema = z.object({
  user: z.object({
    name: z.string().min(1).default('Alex'),
    timezone: z.string().min(1).default('Europe/Berlin'),
  }).strict().optional(),
  /** ISO instant the test starts at; the test process clock is shifted there and keeps running. */
  startTime: isoDateTime.optional(),
  /** Time between the last history message and the start time. */
  elapsedMinutes: z.number().min(0).optional(),
  history: z.array(historyEntrySchema).optional(),
  memory: z.array(memorySchema).optional(),
  goals: z.array(goalSchema).optional(),
  styleProfile: styleProfileSchema.optional(),
  onboarding: onboardingSchema.optional(),
  pulseCycle: pulseCycleSchema.optional(),
  scheduledActions: z.array(scheduledActionSchema).optional(),
}).strict();

export const preconditionSchema = bodySchema.extend({
  schemaVersion: z.literal(PRECONDITION_SCHEMA_VERSION),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  origin: originSchema.default({ kind: 'authored' }),
  presets: z.array(presetSchema).default([]),
}).strict();

export const preconditionBodySchema = bodySchema;

/** A precondition as written in a file (before defaults). */
export type PreconditionInput = z.input<typeof preconditionSchema>;
/** A validated precondition; presets are not applied yet. */
export type Precondition = z.output<typeof preconditionSchema>;
export type PreconditionBody = z.input<typeof bodySchema>;
/** Presets applied and explicit fields over them, with defaults filled in. */
export type PreconditionState = z.output<typeof bodySchema>;
export type Preset = z.output<typeof presetSchema>;
export type PresetName = (typeof PRESET_NAMES)[number];
