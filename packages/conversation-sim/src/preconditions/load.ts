import { initialOnboardingState, predictCycleProgress, type OnboardingState, type UserGoalRecord } from '@entalent/application';
import { onTestFinished } from 'vitest';
import { restoreClock, shiftClockTo } from '../harness/clock';
import { CoachHarness, SIM_SCOPE, type CoachHarnessOptions, type PreconditionSummary } from '../harness/coach-harness';
import { InMemoryOnboardingTurn } from '../fakes/onboarding-turn';
import { InMemoryPulseCycle, surveyQuestion, type PulseCycleState } from '../fakes/pulse-cycle';
import { historyOffsets, MINUTE_MS, type ResolvedPrecondition } from './parse';
import { describePreset } from './presets';
import type { PreconditionState } from './schema';

export { restoreClock } from '../harness/clock';
export {
  loadPrecondition,
  parsePrecondition,
  PreconditionError,
  type ParseOptions,
  type ResolvedPrecondition,
} from './parse';

const DAY_MS = 86_400_000;

/** A harness built from a precondition plus the fakes that hold its onboarding and pulse-cycle state. */
export interface SeededHarness {
  harness: CoachHarness;
  precondition: ResolvedPrecondition;
  /** Absent when the precondition has no onboarding state (or `overrides` replaced the port). */
  onboarding: InMemoryOnboardingTurn | null;
  /** Absent when the precondition has no pulse cycle (or `overrides` replaced the ports). */
  cycle: InMemoryPulseCycle | null;
}

/**
 * Builds a ready `CoachHarness` whose stores, onboarding and pulse cycle hold the precondition's
 * state. With `startTime` set, the test process clock is shifted there (it keeps running) until
 * `restoreClock` or the next call; production code gets no clock parameter.
 * `overrides` win over everything derived from the precondition.
 */
export async function harnessFromPrecondition(
  precondition: ResolvedPrecondition,
  overrides: CoachHarnessOptions = {},
): Promise<CoachHarness> {
  return (await seedHarness(precondition, overrides)).harness;
}

/** `harnessFromPrecondition` that also returns the onboarding and cycle fakes, for exporting state after a run. */
export async function seedHarness(
  precondition: ResolvedPrecondition,
  overrides: CoachHarnessOptions = {},
): Promise<SeededHarness> {
  const { state } = precondition;
  restoreClock();
  if (state.startTime) {
    shiftClockTo(new Date(state.startTime));
    try {
      onTestFinished(restoreClock);
    } catch {
      // Not inside a running Vitest test: the caller restores the clock.
    }
  }
  const startMs = Date.now();

  const onboardingTurn = state.onboarding ? new InMemoryOnboardingTurn(onboardingState(state.onboarding, startMs)) : undefined;
  const cycle = state.pulseCycle ? new InMemoryPulseCycle(cycleState(state.pulseCycle)) : undefined;
  const user = state.user ?? { name: 'Alex', timezone: 'Europe/Berlin' };

  const harness = new CoachHarness({
    userName: user.name,
    timezone: user.timezone,
    ...(state.memory ? { seedMemory: state.memory } : {}),
    ...(state.styleProfile
      ? {
          seedStyleProfile: {
            ...state.styleProfile,
            tenantId: SIM_SCOPE.tenantId,
            userId: SIM_SCOPE.userId,
            updatedAt: new Date(startMs - DAY_MS),
          },
        }
      : {}),
    ...(onboardingTurn ? { onboardingTurn } : {}),
    ...(cycle
      ? { questionConfirmationRepo: cycle.questionConfirmation, surveyRepo: cycle.surveyRepo, pulseBacklogService: cycle.backlog }
      : {}),
    precondition: summarize(precondition, startMs),
    ...overrides,
  });

  const historyIds = await seedHistory(harness, state, startMs);
  if (cycle && state.pulseCycle) {
    cycle.state.evidence = state.pulseCycle.topics.flatMap((topic) => topic.evidence.map((item) => ({
      evidenceSummary: item.summary,
      questionGroup: topic.group,
      sourceMessageIds: item.sourceHistoryIndexes.map((index) => historyIds[index]!),
      status: item.status,
    })));
  }
  for (const [index, goal] of (state.goals ?? []).entries()) {
    const createdAt = new Date(startMs - DAY_MS);
    const record: UserGoalRecord = {
      id: `goal-seed-${index + 1}`,
      tenantId: SIM_SCOPE.tenantId,
      userId: SIM_SCOPE.userId,
      title: goal.title,
      ...(goal.description ? { description: goal.description } : {}),
      category: goal.category,
      status: goal.status,
      priority: goal.priority,
      sourceMessageIds: [],
      confidence: 0.9,
      ...(goal.status === 'completed' ? { completedAt: createdAt } : {}),
      ...(goal.status === 'cancelled' ? { cancelledAt: createdAt } : {}),
      createdAt,
      updatedAt: createdAt,
    };
    // `save` forces `active`, so seeded goals go straight into the store.
    harness.goalRepo.goals.push(record);
  }
  for (const action of state.scheduledActions ?? []) {
    await harness.scheduledActions.save({
      tenantId: SIM_SCOPE.tenantId,
      userId: SIM_SCOPE.userId,
      conversationId: SIM_SCOPE.conversationId,
      type: action.type,
      intent: action.intent,
      context: action.context,
      ...(action.reason ? { reason: action.reason } : {}),
      dueAt: new Date(startMs + action.dueInMinutes * MINUTE_MS),
      timezone: user.timezone,
      cancellationConditions: [],
      sourceMessageIds: [],
    });
  }
  return {
    harness,
    precondition,
    onboarding: onboardingTurn && !overrides.onboardingTurn ? onboardingTurn : null,
    cycle: cycle && !overrides.questionConfirmationRepo && !overrides.pulseBacklogService ? cycle : null,
  };
}

/** Saves the history oldest first and returns the message ids in the same order. */
async function seedHistory(harness: CoachHarness, state: PreconditionState, startMs: number): Promise<string[]> {
  const history = state.history ?? [];
  const offsets = historyOffsets(state);
  const ids: string[] = [];
  for (const [index, entry] of history.entries()) {
    const occurredAt = new Date(startMs - offsets[index]!);
    const direction = entry.role === 'employee' ? 'inbound' : 'outbound';
    const saved = await harness.conversationRepo.saveMessage({
      conversationId: SIM_SCOPE.conversationId,
      tenantId: SIM_SCOPE.tenantId,
      userId: SIM_SCOPE.userId,
      direction,
      text: entry.text,
      occurredAt,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    });
    if (direction === 'outbound') {
      await harness.conversationRepo.updateMessageDelivery(saved.id, {
        tenantId: SIM_SCOPE.tenantId,
        conversationId: SIM_SCOPE.conversationId,
        externalMessageId: `sim-seed-${index}`,
        sentAt: occurredAt,
      });
    }
    ids.push(saved.id);
  }
  return ids;
}

function onboardingState(input: NonNullable<PreconditionState['onboarding']>, startMs: number): OnboardingState {
  const base = initialOnboardingState(input.role);
  const date = (value: string | null | undefined, fallback: Date | null): Date | null =>
    value === undefined ? fallback : value === null ? null : new Date(value);
  const introStatus = input.introStatus ?? base.introStatus;
  return {
    ...base,
    introStatus,
    participation: input.participation ?? base.participation,
    reminderStatus: input.reminderStatus ?? base.reminderStatus,
    buttonsActive: input.buttonsActive ?? base.buttonsActive,
    completedAt: date(input.completedAt, introStatus === 'completed' ? new Date(startMs - DAY_MS) : base.completedAt),
    managementAckAt: date(input.managementAckAt, base.managementAckAt),
    reminderOriginAt: date(input.reminderOriginAt, base.reminderOriginAt),
  };
}

function cycleState(input: NonNullable<PreconditionState['pulseCycle']>): PulseCycleState {
  return {
    open: input.open,
    surveyWindowId: input.surveyWindowId,
    topics: input.topics.map((topic) => ({
      questionGroup: topic.group,
      questions: topic.questions.map((question, index) => ({
        status: question.status,
        question: surveyQuestion({
          id: question.id,
          questionGroup: topic.group,
          displayOrder: index + 1,
          ...definedOnly({
            title: question.title,
            canonicalMeaning: question.canonicalMeaning,
            probeStrategies: question.probeStrategies,
            responseType: question.responseType,
            version: question.version,
          }),
        }),
      })),
    })),
    evidence: [],
    nextProbe: input.nextProbe ?? null,
  };
}

function summarize(precondition: ResolvedPrecondition, startMs: number): PreconditionSummary {
  const { state, origin } = precondition;
  const user = state.user ?? { name: 'Alex', timezone: 'Europe/Berlin' };
  const cycle = state.pulseCycle;
  const progress = cycle?.open
    ? predictCycleProgress({
        surveyWindowId: cycle.surveyWindowId,
        groups: cycle.topics.map((topic) => ({
          questionGroup: topic.group,
          questions: topic.questions.map((question) => ({ surveyQuestionId: question.id, status: question.status })),
        })),
      })
    : null;
  const onboarding = state.onboarding ? onboardingState(state.onboarding, startMs) : null;
  return {
    name: precondition.name,
    source: precondition.source,
    origin: origin.kind === 'recorded'
      ? `recorded (${origin.approved
        ? `approved by ${origin.approvedBy ?? '?'} on ${origin.approvedAt?.slice(0, 10) ?? '?'}`
        : 'candidate, not approved'}${origin.recordedFrom ? `, from ${origin.recordedFrom}` : ''})`
      : origin.kind === 'trace'
        ? `trace (tenant ${origin.tenantId}, turn ${origin.turnId}${origin.tracedAt ? ` at ${origin.tracedAt}` : ''})`
        : 'authored',
    presets: precondition.presets.map(describePreset),
    user: `${user.name}, timezone ${user.timezone}, local time at start ${localTime(startMs, user.timezone)}`,
    startTime: state.startTime ?? null,
    elapsedMinutes: state.elapsedMinutes ?? null,
    goals: (state.goals ?? []).map((goal) => `${goal.title} (${goal.status})`),
    styleProfile: state.styleProfile
      ? `${JSON.stringify(state.styleProfile.dimensions)}, weight ${state.styleProfile.adaptationWeight}`
      : null,
    onboarding: onboarding
      ? `${onboarding.track}: intro ${onboarding.introStatus}, participation ${onboarding.participation}`
      : null,
    cycle: cycle
      ? {
          open: cycle.open,
          topicsTotal: progress?.topicsTotal ?? 0,
          topicsClosed: progress?.topicsClosed ?? 0,
          openTopics: progress?.openTopics ?? [],
          topics: cycle.topics.map((topic) => `${topic.group}: ${topic.questions.map((question) => question.status).join(', ')}`),
          nextProbe: cycle.nextProbe ? `${cycle.nextProbe.questionId} (${cycle.nextProbe.focus})` : null,
        }
      : null,
    evidence: (cycle?.topics ?? []).flatMap((topic) =>
      topic.evidence.map((item) => `${topic.group} [${item.status}]: ${item.summary}`)),
    scheduledActions: (state.scheduledActions ?? []).map((action) =>
      `${action.type} "${action.intent}" due ${action.dueInMinutes >= 0 ? `in ${action.dueInMinutes} min` : `${-action.dueInMinutes} min ago`}`),
  };
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function localTime(ms: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
