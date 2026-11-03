import type { TracedMessage, TracedStateBefore } from '../state-before';
import type { TracedTurnPayload } from '../turn';

/**
 * Turns one traced turn into a precondition v1 holding the state before that turn and a QA test
 * draft whose only reply is the employee message that triggered it (SPEC CAP-8). Pure: no I/O.
 *
 * The output types mirror the precondition and QA test schemas of `@entalent/conversation-sim`
 * (`src/preconditions/schema.ts`, `src/qa/schema.ts`), which validate it; that package's tests
 * fail when the two drift. Whatever the precondition format cannot hold is listed in `gaps`.
 */

/** History messages the orchestrator reads per turn (`findMessagesThrough` limit), inbound included. */
export const ORCHESTRATOR_HISTORY_WINDOW = 20;

/** Message metadata the orchestrator reads from history; everything else stays out of fixtures. */
const HISTORY_METADATA_KEYS = [
  'replyShape',
  'containsSurveyProbe',
  'surveyProbeQuestionId',
  'dialogueAct',
  'reportingDisclosureVersion',
  'conversationOutcome',
  'questionNotCollectedUndelivered',
  'topicCompletionUndelivered',
] as const;
/** Metadata that points at other message ids, which a precondition cannot carry over. */
const ID_METADATA_KEYS = ['sourceInboundMessageId', 'pulseCaptureSourceMessageId'] as const;

const QUESTION_STATUSES = ['collecting', 'pending_confirmation', 'pending_clarification', 'confirmed', 'declined', 'no_data', 'reset'] as const;
const GOAL_STATUSES = ['active', 'completed', 'cancelled'] as const;
const GOAL_PRIORITIES = ['low', 'medium', 'high'] as const;
const EVIDENCE_STATUSES = ['temporary', 'confirmed', 'withdrawn'] as const;
const INTRO_STATUSES = ['pending', 'delivered', 'completed'] as const;
const PARTICIPATIONS = ['undecided', 'deferred', 'active', 'declined', 'not_applicable'] as const;
const REMINDER_STATUSES = ['none', 'scheduled', 'sent', 'cancelled'] as const;
const RESPONSE_TYPES = ['open_ended', 'numeric_0_10'] as const;
const ROLE_FOR_TRACK = { employee: 'employee', team_lead: 'team_lead', management: 'manager' } as const;

type QuestionStatus = (typeof QUESTION_STATUSES)[number];

function oneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}
const STYLE_DIMENSIONS = ['register', 'humor', 'verbosity', 'emoji'] as const;
/** Smallest gap kept between history messages, so resolved times stay strictly ordered. */
const MIN_STEP_MINUTES = 0.001;
/** Queue delay beyond which the gap between message time and turn time is reported. */
const QUEUE_DELAY_GAP_MINUTES = 5;

export interface TraceExtractionMeta {
  tenantId: string;
  conversationId: string;
  traceRowId: string;
  /** When the traced turn started. */
  startedAt: Date | string;
  status: 'completed' | 'failed';
}

export interface TracedHistoryEntry {
  role: 'employee' | 'bot';
  text: string;
  minutesBeforeStart: number;
  metadata?: Record<string, unknown>;
}

/** A precondition v1 file (`@entalent/conversation-sim` `PreconditionInput`) with a `trace` origin. */
export interface TracePreconditionFile {
  schemaVersion: 1;
  name: string;
  description: string;
  origin: { kind: 'trace'; tenantId: string; turnId: string; conversationId: string; tracedAt: string };
  user?: { name: string; timezone: string };
  startTime: string;
  history: TracedHistoryEntry[];
  memory?: Array<{ category: string; content: string; importance: number }>;
  goals?: Array<{
    title: string;
    description?: string;
    category: string;
    status: (typeof GOAL_STATUSES)[number];
    priority: (typeof GOAL_PRIORITIES)[number];
  }>;
  styleProfile?: {
    dimensions: { register: number; humor: number; verbosity: number; emoji: number };
    phrases: Array<{ text: string; count: number }>;
    adaptationWeight: number;
    conversationsAnalyzed: number;
  };
  onboarding?: {
    role: (typeof ROLE_FOR_TRACK)[keyof typeof ROLE_FOR_TRACK];
    introStatus: (typeof INTRO_STATUSES)[number];
    participation: (typeof PARTICIPATIONS)[number];
    reminderStatus: (typeof REMINDER_STATUSES)[number];
    buttonsActive: boolean;
    completedAt: string | null;
    managementAckAt: string | null;
    reminderOriginAt: string | null;
  };
  pulseCycle?: {
    open: boolean;
    surveyWindowId?: string;
    topics: Array<{
      group: string;
      questions: Array<{
        id: string;
        status: QuestionStatus;
        title?: string;
        canonicalMeaning?: string;
        probeStrategies?: string[];
        responseType?: (typeof RESPONSE_TYPES)[number];
        version?: string;
      }>;
      evidence: Array<{ summary: string; status: (typeof EVIDENCE_STATUSES)[number]; sourceHistoryIndexes: number[] }>;
    }>;
    nextProbe?: { questionId: string; focus: 'open' | 'driver' } | null;
  };
}

/** A QA test v1 file (`@entalent/conversation-sim` `qaTestSchema`) that QA must finish: `expected` is empty, so it cannot run as is. */
export interface QaTestDraftFile {
  schemaVersion: 1;
  title: string;
  precondition: string;
  replies: string[];
  expected: string[];
  hardChecks: never[];
  tags: string[];
}

export interface TraceExtraction {
  /** File stem shared by the precondition and the draft. */
  name: string;
  /** Paths relative to `preconditions/` and `qa-tests/` of the sim package. */
  files: { precondition: string; testDraft: string };
  precondition: TracePreconditionFile;
  testDraft: QaTestDraftFile;
  /** Ways the precondition differs from what the original turn saw; empty when it is exact. */
  gaps: string[];
}

export type TraceExtractionErrorCode = 'trace_state_not_captured' | 'trace_user_message_missing';

export class TraceExtractionError extends Error {
  override name = 'TraceExtractionError';
  constructor(readonly code: TraceExtractionErrorCode, message: string) {
    super(message);
  }
}

/** File stem for a trace row: `trace-` and the row id's first block. */
export function traceExtractionName(traceRowId: string): string {
  const stem = traceRowId.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8);
  return `trace-${stem || 'turn'}`;
}

export function preconditionFromTrace(payload: TracedTurnPayload, meta: TraceExtractionMeta): TraceExtraction {
  const state = payload.stateBefore;
  if (!state || !wellFormed(state)) {
    throw new TraceExtractionError(
      'trace_state_not_captured',
      'this trace row holds no captured history (stored before state capture, or cut to fit); it cannot become a precondition',
    );
  }
  const gaps: string[] = [];
  const inbound = state.messages![state.inboundIndex!]!;
  const reply = inbound.text.length > 0 ? inbound.text : payload.userMessage ?? '';
  if (reply.trim().length === 0) {
    throw new TraceExtractionError('trace_user_message_missing', 'the triggering employee message has no text');
  }
  if (reply !== reply.trim()) gaps.push('The employee message had leading or trailing whitespace; QA tests send it trimmed.');
  if (payload.truncated) gaps.push('The stored trace was cut to fit its size bound; some sections may be shortened.');
  for (const area of state.readAfterWrite) {
    gaps.push(`The turn read ${area} only after writing to a store that can change it, so that state may already include this turn's change.`);
  }

  const startMs = Date.parse(inbound.occurredAt);
  const { history, positions } = buildHistory(state, startMs, gaps);
  const name = traceExtractionName(meta.traceRowId);
  const tracedAt = toIso(meta.startedAt);
  const queuedMinutes = (Date.parse(tracedAt) - startMs) / 60_000;
  if (queuedMinutes > QUEUE_DELAY_GAP_MINUTES) {
    gaps.push(`The turn ran ${Math.round(queuedMinutes)} min after the message arrived; the test starts at the message time, so clock-dependent behavior may differ.`);
  }

  const precondition: TracePreconditionFile = {
    schemaVersion: 1,
    name,
    description: '',
    origin: {
      kind: 'trace',
      tenantId: meta.tenantId,
      turnId: meta.traceRowId,
      conversationId: meta.conversationId,
      tracedAt,
    },
    ...userOf(state, gaps),
    startTime: new Date(startMs).toISOString(),
    history,
    ...memoryOf(state, gaps),
    ...goalsOf(state, gaps),
    ...styleOf(state, gaps),
    ...onboardingOf(state, gaps),
    ...pulseCycleOf(state, positions, gaps),
  };
  precondition.description = `State before traced turn ${meta.traceRowId} (${tracedAt}) of conversation ${meta.conversationId}.`
    + (gaps.length ? ` Fidelity gaps: ${gaps.join(' ')}` : ' No known fidelity gaps.');

  const files = { precondition: `traced/${name}.json`, testDraft: `drafts/${name}.json` };
  const testDraft: QaTestDraftFile = {
    schemaVersion: 1,
    title: `DRAFT - fill expected: traced turn ${name.slice('trace-'.length)} of ${tracedAt.slice(0, 10)}`
      + (meta.status === 'failed' ? ' (the original turn failed)' : ''),
    precondition: files.precondition,
    replies: [reply.trim()],
    expected: [],
    hardChecks: [],
    tags: ['from-trace'],
  };
  return { name, files, precondition, testDraft, gaps };
}

/**
 * History before the inbound message, oldest first, timed relative to the inbound. Returns the
 * history position of every kept message id, for evidence sources.
 */
function buildHistory(
  state: TracedStateBefore,
  startMs: number,
  gaps: string[],
): { history: TracedHistoryEntry[]; positions: Map<string, number> } {
  const prior = state.messages!.slice(0, state.inboundIndex);
  const after = state.messages!.length - 1 - state.inboundIndex!;
  if (after > 0) gaps.push(`${after} message(s) the history read returned after the employee message were left out.`);
  const kept: TracedMessage[] = [];
  for (const message of prior) {
    if (message.text.trim().length === 0) {
      gaps.push(`A ${message.direction === 'inbound' ? 'employee' : 'bot'} history message without text was left out.`);
      continue;
    }
    kept.push(message);
  }
  let droppedIdMetadata = false;
  const history: TracedHistoryEntry[] = kept.map((message) => {
    const metadata = message.metadata ?? {};
    if (ID_METADATA_KEYS.some((key) => key in metadata)) droppedIdMetadata = true;
    const picked = Object.fromEntries(HISTORY_METADATA_KEYS.filter((key) => key in metadata).map((key) => [key, metadata[key]]));
    return {
      role: message.direction === 'inbound' ? 'employee' : 'bot',
      text: message.text,
      minutesBeforeStart: (startMs - Date.parse(message.occurredAt)) / 60_000,
      ...(Object.keys(picked).length ? { metadata: picked } : {}),
    };
  });
  if (droppedIdMetadata) gaps.push('History metadata that points at other message ids (content-filter recovery, pulse-capture source) was left out.');

  // Resolved times must stay before the start and strictly oldest first.
  let nudged = false;
  if (history.some((entry) => entry.minutesBeforeStart < 0)) {
    gaps.push('Some history messages were timestamped after the employee message; they were moved before it.');
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const floor = index === history.length - 1 ? MIN_STEP_MINUTES : history[index + 1]!.minutesBeforeStart + MIN_STEP_MINUTES;
    if (!(history[index]!.minutesBeforeStart >= floor)) {
      history[index]!.minutesBeforeStart = floor;
      nudged = true;
    }
  }
  if (nudged) gaps.push('Some history messages shared a timestamp with the next one; they were moved apart by under a second.');

  const disclosure = state.reportingDisclosure;
  if (disclosure && !history.some((entry) => entry.role === 'bot' && entry.metadata?.['reportingDisclosureVersion'] === disclosure.version)) {
    const windowFull = state.messages!.length >= (state.messagesLimit ?? ORCHESTRATOR_HISTORY_WINDOW);
    if (windowFull) {
      // The disclosure was delivered before the history window: an older bot message outside the
      // window carries it, so the orchestrator finds the receipt but not the message.
      const oldest = history[0]?.minutesBeforeStart ?? 0;
      const shownBefore = (startMs - Date.parse(disclosure.shownAt)) / 60_000;
      history.unshift({
        role: 'bot',
        text: '[reporting disclosure delivered before the traced history window]',
        minutesBeforeStart: Number.isFinite(shownBefore) && shownBefore > oldest ? shownBefore : oldest + MIN_STEP_MINUTES,
        metadata: { reportingDisclosureVersion: disclosure.version },
      });
      gaps.push('The reporting disclosure was delivered before the history window; a placeholder bot message outside the window stands for it.');
    } else {
      gaps.push('The reporting disclosure receipt came from outside this conversation\'s history; the precondition has no disclosure.');
    }
  }

  const positions = new Map<string, number>();
  const offset = history.length - kept.length;
  kept.forEach((message, index) => positions.set(message.id, index + offset));
  return { history, positions };
}

function userOf(state: TracedStateBefore, gaps: string[]): Pick<TracePreconditionFile, 'user'> {
  const conversation = state.conversation;
  if (!conversation) {
    gaps.push('The conversation record was not read; user name and timezone are the harness defaults.');
    return {};
  }
  if (!conversation.userDisplayName) gaps.push('The employee had no display name (the coach said "there"); the harness uses "there" as the name.');
  if (!conversation.userTimezone) gaps.push('The employee had no timezone; the harness uses UTC.');
  if (conversation.hasActiveTopic) gaps.push('The conversation had an active topic (continuity summary for the classifier); preconditions cannot hold it.');
  return { user: { name: conversation.userDisplayName ?? 'there', timezone: conversation.userTimezone ?? 'UTC' } };
}

function memoryOf(state: TracedStateBefore, gaps: string[]): Pick<TracePreconditionFile, 'memory'> {
  if (!state.memory) {
    gaps.push('Memory was not read by the original turn; the precondition has none.');
    return {};
  }
  const memory = state.memory.filter((item) => item.category.trim() && item.content.trim());
  if (memory.length < state.memory.length) gaps.push('Memory items without category or content were left out.');
  return { memory: memory.map((item) => ({ ...item, importance: clamp01(item.importance) })) };
}

function goalsOf(state: TracedStateBefore, gaps: string[]): Pick<TracePreconditionFile, 'goals'> {
  if (!state.goals) {
    gaps.push('Goals were not read by the original turn; the precondition has none.');
    return {};
  }
  const goals: NonNullable<TracePreconditionFile['goals']> = [];
  for (const goal of state.goals) {
    const { status, priority } = goal;
    if (!goal.title.trim() || !oneOf(GOAL_STATUSES, status)) {
      gaps.push(`A goal with status "${status}" or no title was left out.`);
      continue;
    }
    const knownPriority = oneOf(GOAL_PRIORITIES, priority);
    if (!knownPriority) gaps.push(`A goal priority "${priority}" became "medium".`);
    goals.push({
      title: goal.title,
      ...(goal.description ? { description: goal.description } : {}),
      category: goal.category.trim() || 'work',
      status,
      priority: knownPriority ? priority : 'medium',
    });
  }
  return { goals };
}

function styleOf(state: TracedStateBefore, gaps: string[]): Pick<TracePreconditionFile, 'styleProfile'> {
  const style = state.styleProfile;
  if (style === undefined) gaps.push('The style profile was not read by the original turn; the precondition has none.');
  if (!style) return {};
  if (!STYLE_DIMENSIONS.every((key) => typeof style.dimensions[key] === 'number')) {
    gaps.push('The style profile lacked a dimension and was left out.');
    return {};
  }
  return {
    styleProfile: {
      dimensions: {
        register: clamp01(style.dimensions['register']!),
        humor: clamp01(style.dimensions['humor']!),
        verbosity: clamp01(style.dimensions['verbosity']!),
        emoji: clamp01(style.dimensions['emoji']!),
      },
      phrases: style.phrases
        .filter((phrase) => phrase.text.trim())
        .map((phrase) => ({ text: phrase.text, count: Number.isFinite(phrase.count) ? Math.max(1, Math.round(phrase.count)) : 1 })),
      adaptationWeight: clamp01(style.adaptationWeight),
      conversationsAnalyzed: Number.isFinite(style.conversationsAnalyzed) ? Math.max(0, Math.round(style.conversationsAnalyzed)) : 0,
    },
  };
}

function onboardingOf(state: TracedStateBefore, gaps: string[]): Pick<TracePreconditionFile, 'onboarding'> {
  const onboarding = state.onboarding;
  if (onboarding === undefined) gaps.push('Onboarding was not read by the original turn; the precondition has none.');
  if (!onboarding) return {};
  const { track, introStatus, participation, reminderStatus } = onboarding;
  if (!oneOf(Object.keys(ROLE_FOR_TRACK) as Array<keyof typeof ROLE_FOR_TRACK>, track) || !oneOf(INTRO_STATUSES, introStatus)
    || !oneOf(PARTICIPATIONS, participation) || !oneOf(REMINDER_STATUSES, reminderStatus)) {
    gaps.push('The onboarding state had values the precondition format does not know and was left out.');
    return {};
  }
  return {
    onboarding: {
      role: ROLE_FOR_TRACK[track],
      introStatus,
      participation,
      reminderStatus,
      buttonsActive: onboarding.buttonsActive,
      completedAt: onboarding.completedAt,
      managementAckAt: onboarding.managementAckAt,
      reminderOriginAt: onboarding.reminderOriginAt,
    },
  };
}

function pulseCycleOf(
  state: TracedStateBefore,
  positions: Map<string, number>,
  gaps: string[],
): Pick<TracePreconditionFile, 'pulseCycle'> {
  for (const [key, pending] of Object.entries(state.confirmation ?? {})) {
    if (pending) gaps.push(`A pending confirmation step (${key}) existed; preconditions cannot hold confirmation bundles or clarifications.`);
  }
  const progress = state.cycleProgress;
  const probe = state.nextProbe;
  const droppedEvidence = () => {
    if (state.pulseCapture?.items.length) gaps.push('Pulse evidence was read but no open cycle holds it; it was left out.');
  };
  if (progress === undefined && !probe) {
    gaps.push(probe === undefined
      ? 'The pulse cycle was not read by the original turn; the precondition has none.'
      : 'Cycle progress was not read and no probe was due; whether a cycle was open is unknown, so the precondition has none.');
    droppedEvidence();
    return {};
  }
  if (progress === null) {
    if (probe) gaps.push('The next probe question was read while no cycle was open; it was left out.');
    droppedEvidence();
    return { pulseCycle: { open: false, topics: [] } };
  }

  type Topic = NonNullable<TracePreconditionFile['pulseCycle']>['topics'][number];
  const topics: Topic[] = [];
  if (progress) {
    for (const group of progress.groups) {
      const questions = group.questions.filter((question) => question.surveyQuestionId);
      if (!group.questionGroup || questions.length === 0) continue;
      topics.push({
        group: group.questionGroup,
        questions: questions.map((question) => {
          const { status } = question;
          if (!oneOf(QUESTION_STATUSES, status)) {
            gaps.push(`Question status "${status}" became "collecting".`);
            return { id: question.surveyQuestionId, status: 'collecting' as const };
          }
          return { id: question.surveyQuestionId, status };
        }),
        evidence: [],
      });
    }
  } else {
    gaps.push('Cycle progress was not read by the original turn; the cycle holds only the next probe question.');
  }

  let nextProbe: { questionId: string; focus: 'open' | 'driver' } | null = null;
  if (probe && probe.question.id) {
    let topic = topics.find((entry) => entry.group === probe.question.questionGroup);
    let question = topic?.questions.find((entry) => entry.id === probe.question.id);
    if (!question) {
      if (!topic) {
        topic = { group: probe.question.questionGroup || 'unknown', questions: [], evidence: [] };
        topics.push(topic);
      }
      question = { id: probe.question.id, status: 'collecting' };
      topic.questions.push(question);
    }
    Object.assign(question, definedOnly({
      title: probe.question.title,
      canonicalMeaning: probe.question.canonicalMeaning,
      probeStrategies: probe.question.probeStrategies,
      responseType: oneOf(RESPONSE_TYPES, probe.question.responseType) ? probe.question.responseType : undefined,
      version: probe.question.version,
    }));
    if (probe.focus !== 'open' && probe.focus !== 'driver') gaps.push(`Probe focus "${probe.focus}" became "open".`);
    nextProbe = { questionId: probe.question.id, focus: probe.focus === 'driver' ? 'driver' : 'open' };
  }
  if (topics.length > 0 && topics.some((topic) => topic.questions.length > 1 || topic.questions[0]?.id !== nextProbe?.questionId)) {
    gaps.push('Survey questions other than the next probe keep the harness defaults for title and meaning.');
  }

  const capture = state.pulseCapture;
  if (capture) {
    if (capture.filteredBySource) gaps.push('Pulse evidence was read for one source message only; other evidence is unknown.');
    let outside = 0;
    for (const item of capture.items) {
      const topic = topics.find((entry) => entry.group === item.questionGroup);
      if (!topic || !item.evidenceSummary.trim()) {
        gaps.push(topic
          ? `Pulse evidence for "${item.questionGroup}" without a summary was left out.`
          : `Pulse evidence for "${item.questionGroup}" has no matching cycle topic and was left out.`);
        continue;
      }
      const indexes = item.sourceMessageIds.map((id) => positions.get(id)).filter((index): index is number => index !== undefined);
      if (indexes.length < item.sourceMessageIds.length) outside += 1;
      const { status } = item;
      topic.evidence.push({
        summary: item.evidenceSummary,
        status: oneOf(EVIDENCE_STATUSES, status) ? status : 'temporary',
        sourceHistoryIndexes: indexes,
      });
    }
    if (outside) gaps.push(`${outside} pulse evidence item(s) came from messages outside the history window; their sources are not linked.`);
  }

  return {
    pulseCycle: {
      open: true,
      ...(progress?.surveyWindowId || probe?.windowId ? { surveyWindowId: progress?.surveyWindowId || probe!.windowId } : {}),
      topics,
      nextProbe,
    },
  };
}

/** The shape the converter dereferences; anything else is a row it cannot use (schema drift, partial data). */
function wellFormed(state: TracedStateBefore): boolean {
  const { messages, inboundIndex } = state;
  if (!Array.isArray(messages) || !Number.isInteger(inboundIndex) || !messages[inboundIndex!]) return false;
  const messagesOk = messages.every((message) => isObject(message) && typeof message.id === 'string'
    && (message.direction === 'inbound' || message.direction === 'outbound') && typeof message.text === 'string'
    && typeof message.occurredAt === 'string' && Number.isFinite(Date.parse(message.occurredAt))
    && (message.metadata === undefined || isObject(message.metadata)));
  const listOk = <T>(list: T[] | undefined, check: (item: T) => boolean) => list === undefined || (Array.isArray(list) && list.every(check));
  const style = state.styleProfile;
  return messagesOk
    && listOk(state.memory, (item) => isObject(item) && typeof item.category === 'string' && typeof item.content === 'string' && typeof item.importance === 'number')
    && listOk(state.goals, (goal) => isObject(goal) && typeof goal.title === 'string' && typeof goal.category === 'string'
      && typeof goal.status === 'string' && typeof goal.priority === 'string')
    && (style === undefined || style === null || (isObject(style) && isObject(style.dimensions) && Array.isArray(style.phrases)
      && style.phrases.every((phrase) => isObject(phrase) && typeof phrase.text === 'string')))
    && (state.cycleProgress === undefined || state.cycleProgress === null
      || (isObject(state.cycleProgress) && Array.isArray(state.cycleProgress.groups)
        && state.cycleProgress.groups.every((group) => isObject(group) && Array.isArray(group.questions))))
    && (state.nextProbe === undefined || state.nextProbe === null || (isObject(state.nextProbe) && isObject(state.nextProbe.question)))
    && (state.pulseCapture === undefined || (isObject(state.pulseCapture) && Array.isArray(state.pulseCapture.items)
      && state.pulseCapture.items.every((item) => isObject(item) && typeof item.evidenceSummary === 'string'
        && Array.isArray(item.sourceMessageIds))))
    && Array.isArray(state.readAfterWrite);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
