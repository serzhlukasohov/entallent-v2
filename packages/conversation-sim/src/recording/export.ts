import type { OnboardingState } from '@entalent/application';
import { InMemoryScheduledActionRepository } from '../fakes/repositories';
import { realNow } from '../harness/clock';
import { SIM_SCOPE } from '../harness/coach-harness';
import type { SeededHarness } from '../preconditions/load';
import { DEFAULT_ELAPSED_MINUTES, MINUTE_MS, parsePrecondition } from '../preconditions/parse';
import { PRECONDITION_SCHEMA_VERSION, QUESTION_STATUSES, type PreconditionInput } from '../preconditions/schema';

type Body = Omit<PreconditionInput, 'schemaVersion' | 'name' | 'description' | 'origin' | 'presets'>;
type QuestionStatus = (typeof QUESTION_STATUSES)[number];
type OnboardingRole = NonNullable<NonNullable<Body['onboarding']>['role']>;

export interface ExportMeta {
  name: string;
  description?: string;
  /** Recording file, as shown in the candidate's origin. */
  recordedFrom: string;
  provider: 'live' | 'scripted';
}

/** Smallest gap kept between exported history messages, so turns in the same millisecond stay ordered. */
const MIN_GAP_MINUTES = 0.01;

/**
 * The state a harness holds after a run, as a candidate precondition (`origin.kind: recorded`,
 * not approved). Presets of the base are already expanded into explicit state; the base name is
 * kept in `origin.base`. The result is validated before it is returned, so it always loads.
 */
export async function exportPrecondition(seeded: SeededHarness, meta: ExportMeta): Promise<PreconditionInput> {
  const { harness, precondition: base } = seeded;
  // The harness clock (shifted when the base has a start time) at the end of the run is the candidate's start time.
  const endMs = Date.now();
  const messages = harness.transcript.filter((message) => message.conversationId === SIM_SCOPE.conversationId);
  const offsets = historyMinutes(messages.map((message) => message.occurredAt.getTime()), endMs);
  const historyIds = messages.map((message) => message.id);

  const body: Body = {
    user: base.state.user ?? { name: 'Alex', timezone: 'Europe/Berlin' },
    // Always pinned: onboarding and other exported dates are absolute, so the test clock starts where the recording ended.
    startTime: new Date(endMs).toISOString(),
    history: messages.map((message, index) => ({
      role: message.direction === 'inbound' ? 'employee' as const : 'bot' as const,
      text: message.text,
      minutesBeforeStart: offsets[index]!,
      ...(message.metadata && Object.keys(message.metadata).length > 0 ? { metadata: jsonSafe(message.metadata) } : {}),
    })),
    memory: harness.memoryItems.map((item) => ({
      category: item.category,
      content: item.content,
      importance: Math.min(1, Math.max(0, item.importance)),
    })),
    goals: harness.goalRepo.goals
      .filter((goal) => goal.tenantId === SIM_SCOPE.tenantId && goal.userId === SIM_SCOPE.userId)
      .map((goal) => ({
        title: goal.title,
        ...(goal.description ? { description: goal.description } : {}),
        category: goal.category,
        status: goal.status as 'active' | 'completed' | 'cancelled',
        priority: goal.priority as 'low' | 'medium' | 'high',
      })),
    ...(await styleProfile(seeded)),
    ...(seeded.onboarding ? { onboarding: onboarding(seeded.onboarding.state, base.state.onboarding?.role) } : {}),
    ...(seeded.cycle ? { pulseCycle: pulseCycle(seeded.cycle.state, historyIds) } : {}),
    scheduledActions: pendingActions(seeded, endMs),
  };

  const candidate: PreconditionInput = {
    schemaVersion: PRECONDITION_SCHEMA_VERSION,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    origin: {
      kind: 'recorded',
      approved: false,
      recordedAt: new Date(realNow()).toISOString(),
      recordedFrom: meta.recordedFrom,
      base: base.name,
      provider: meta.provider,
    },
    ...dropEmpty(body),
  };
  parsePrecondition(candidate, `exported candidate ${meta.name}`, { allowCandidate: true });
  return candidate;
}

/**
 * Minutes before `endMs` per message, oldest first: real message times, the last at least the
 * default gap before the start, each strictly older than the next.
 */
export function historyMinutes(times: number[], endMs: number): number[] {
  const round = (value: number) => Math.round(value * 100) / 100;
  const result = new Array<number>(times.length);
  for (let index = times.length - 1; index >= 0; index -= 1) {
    const actual = round((endMs - times[index]!) / MINUTE_MS);
    const floor = index === times.length - 1 ? DEFAULT_ELAPSED_MINUTES : round(result[index + 1]! + MIN_GAP_MINUTES);
    result[index] = Math.max(actual, floor);
  }
  return result;
}

async function styleProfile(seeded: SeededHarness): Promise<Pick<Body, 'styleProfile'>> {
  const profile = await seeded.harness.styleProfile();
  if (!profile) return {};
  return {
    styleProfile: {
      dimensions: {
        register: profile.dimensions.register,
        humor: profile.dimensions.humor,
        verbosity: profile.dimensions.verbosity,
        emoji: profile.dimensions.emoji,
      },
      phrases: profile.phrases.map((phrase) => ({ text: phrase.text, count: phrase.count })),
      adaptationWeight: profile.adaptationWeight,
      conversationsAnalyzed: profile.conversationsAnalyzed,
    },
  };
}

function onboarding(state: OnboardingState, baseRole: OnboardingRole | undefined): NonNullable<Body['onboarding']> {
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  return {
    role: baseRole ?? (state.track === 'management' ? 'manager' : state.track),
    introStatus: state.introStatus,
    participation: state.participation,
    reminderStatus: state.reminderStatus,
    buttonsActive: state.buttonsActive,
    completedAt: iso(state.completedAt),
    managementAckAt: iso(state.managementAckAt),
    reminderOriginAt: iso(state.reminderOriginAt),
  };
}

function pulseCycle(state: NonNullable<SeededHarness['cycle']>['state'], historyIds: string[]): NonNullable<Body['pulseCycle']> {
  return {
    open: state.open,
    surveyWindowId: state.surveyWindowId,
    topics: state.topics.map((topic) => ({
      group: topic.questionGroup,
      questions: topic.questions.map(({ question, status }) => ({
        id: question.id,
        status: status as QuestionStatus,
        title: question.title,
        canonicalMeaning: question.canonicalMeaning,
        probeStrategies: [...question.probeStrategies],
        responseType: question.responseType === 'numeric_0_10' ? 'numeric_0_10' : 'open_ended',
        version: question.version,
      })),
      evidence: state.evidence
        .filter((item) => item.questionGroup === topic.questionGroup)
        .map((item) => ({
          summary: item.evidenceSummary,
          status: item.status as 'temporary' | 'confirmed' | 'withdrawn',
          sourceHistoryIndexes: item.sourceMessageIds.map((id) => historyIds.indexOf(id)).filter((index) => index >= 0),
        })),
    })),
    nextProbe: state.nextProbe ? { questionId: state.nextProbe.questionId, focus: state.nextProbe.focus } : null,
  };
}

function pendingActions(seeded: SeededHarness, endMs: number): NonNullable<Body['scheduledActions']> {
  const repo = seeded.harness.scheduledActions;
  if (!(repo instanceof InMemoryScheduledActionRepository)) {
    throw new Error('exportPrecondition: scheduled actions live in a scenario repository the exporter cannot read');
  }
  return repo.actions
    .filter((action) => action.status === 'pending' && action.userId === SIM_SCOPE.userId && action.tenantId === SIM_SCOPE.tenantId)
    .map((action) => ({
      type: action.type,
      intent: action.intent,
      dueInMinutes: Math.round(((action.dueAt.getTime() - endMs) / MINUTE_MS) * 100) / 100,
      ...(action.reason ? { reason: action.reason } : {}),
      context: jsonSafe(action.context),
    }));
}

/** JSON round trip: dates become ISO strings, `undefined` disappears, so the file holds what a reload sees. */
function jsonSafe(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

/** Empty lists say nothing a missing area does not; leaving them out keeps the candidate readable. */
function dropEmpty(body: Body): Body {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => !(Array.isArray(value) && value.length === 0))) as Body;
}
