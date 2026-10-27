import {
  ProactiveCheckInUseCase,
  ProactiveSchedulerUseCase,
  type AiProviderPort,
  type CheckInCadenceFacts,
  type CheckInCandidate,
  type CheckInEnqueuePayload,
  type CheckInEnqueuePort,
  type FindCheckInCandidatesParams,
  type MemoryRepositoryPort,
  type MessageRecord,
  type OutboxPort,
  type ProactiveSchedulerRepositoryPort,
  type QuietHours,
} from '@entalent/application';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import type { InMemoryConversationRepository } from '../../fakes/repositories';
import type { ObservationWindow } from '../schema';
import type { ControlledClock } from './clock';
import { record, type EventSink } from './recording-proxy';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Outbound message types that count as proactive contact (worker scheduler SQL). */
const PROACTIVE_OUTBOUND_TYPES = new Set(['proactive_check_in', 'proactive_follow_up', 'reminder']);
const PROACTIVE_REQUEST_TYPE = 'proactive_check_in_request';
const INIT_TEXT = '__init__';

/** Every outcome-affecting input of one proactive user; the executor invents none of them. */
export interface ProactiveUserSpec {
  timezone: string;
  quietHours: QuietHours;
  scan: { minSilenceDays: number; minCheckInGapDays: number; quietHoursEnabled: boolean };
}

/** Users the `proactiveUsers` fixture registered for the observation window. */
export interface ProactiveWorld {
  users: ProactiveUserSpec[];
}

export function createProactiveWorld(): ProactiveWorld {
  return { users: [] };
}

/**
 * In-memory `ProactiveSchedulerRepositoryPort` over the harness conversation. It returns
 * every registered user with cadence facts computed from the recorded messages with the
 * same filters as the worker SQL (Story 12.6); it applies no prefilter, because the
 * scheduler use case re-decides cadence with `checkInCadencePolicy`. The QA three-per-day
 * cohort is not modeled (`inQaCadenceCohort: false`). An inbound message saved with
 * `messageType: 'proactive_check_in_request'` stands for the system sender of the SQL.
 */
export class InMemoryProactiveSchedulerRepository implements ProactiveSchedulerRepositoryPort {
  constructor(
    private readonly world: ProactiveWorld,
    private readonly conversations: InMemoryConversationRepository,
    private readonly clock: ControlledClock,
  ) {}

  async findCheckInCandidates(params: FindCheckInCandidatesParams): Promise<CheckInCandidate[]> {
    if (params.tenantId !== undefined && params.tenantId !== SIM_TENANT_ID) return [];
    return this.world.users.slice(0, params.limit).map((user) => ({
      userId: SIM_USER_ID,
      tenantId: SIM_TENANT_ID,
      conversationId: SIM_CONVERSATION_ID,
      channelType: 'sim',
      externalConversationId: 'sim-channel',
      externalWorkspaceId: 'sim-workspace',
      timezone: user.timezone,
      quietHours: { ...user.quietHours },
      cadence: this.facts(),
    }));
  }

  /** Cadence facts of the harness user at the clock's current instant. */
  facts(): CheckInCadenceFacts {
    const now = this.clock.peek().getTime();
    const messages = this.conversations.messages.filter(
      (message) => message.tenantId === SIM_TENANT_ID && message.userId === SIM_USER_ID,
    );
    const typeOf = (message: MessageRecord): string | undefined => this.conversations.sideFieldsOf(message.id).messageType;
    const inbound = messages.filter((message) => message.direction === 'inbound' && message.text !== INIT_TEXT);
    const proactiveOutbound = messages.filter(
      (message) => message.direction === 'outbound' && PROACTIVE_OUTBOUND_TYPES.has(typeOf(message) ?? ''),
    );
    const proactiveContact = [
      ...proactiveOutbound,
      ...messages.filter((message) => message.direction === 'inbound' && typeOf(message) === PROACTIVE_REQUEST_TYPE),
    ];
    const latest = (list: MessageRecord[]): Date | null =>
      list.length === 0 ? null : new Date(Math.max(...list.map((message) => message.occurredAt.getTime())));

    return {
      lastInboundAt: latest(inbound),
      lastProactiveContactAt: latest(proactiveContact),
      recentProactiveCount: proactiveOutbound.filter((message) => message.occurredAt.getTime() > now - DAY_MS).length,
      hasUnansweredProactive: proactiveOutbound.some(
        (sent) => !inbound.some((reply) => reply.occurredAt.getTime() > sent.occurredAt.getTime()),
      ),
      inQaCadenceCohort: false,
    };
  }
}

/** Runs each enqueued check-in synchronously with the real `ProactiveCheckInUseCase`. */
export class InlineCheckInQueue implements CheckInEnqueuePort {
  readonly enqueued: CheckInEnqueuePayload[] = [];

  constructor(private readonly checkIn: ProactiveCheckInUseCase) {}

  async enqueueCheckIn(payload: CheckInEnqueuePayload): Promise<void> {
    this.enqueued.push(payload);
    await this.checkIn.execute(payload);
  }
}

export interface ObservationPorts {
  /** Recorded proxies of the harness ports. */
  conversationRepo: InMemoryConversationRepository;
  memoryRepo: MemoryRepositoryPort;
  outbox: OutboxPort;
  aiProvider: AiProviderPort;
  /** The raw conversation fake, for cadence facts and the window read. */
  conversationState: InMemoryConversationRepository;
}

export interface ObservationResult {
  from: Date;
  to: Date;
  /** Bot-initiated (proactive-type) outbound messages written while the window was driven, oldest first. */
  outbound: MessageRecord[];
}

/**
 * Drives an observation test (P-06) over the controlled clock: scans at `from`,
 * `from + scanEveryMs`, ... while before `to`, then moves the clock to `to`. Each scan
 * runs `ProactiveSchedulerUseCase` with the registered user's scan config over the
 * in-memory scheduler repository; each enqueued check-in runs `ProactiveCheckInUseCase`
 * with the scripted model. The scheduler-facing ports are recorded as
 * `proactiveSchedulerRepo` and `checkInQueue`; events keep `stepIndex` 0 (no steps).
 */
export async function driveObservationWindow(input: {
  window: ObservationWindow;
  clock: ControlledClock;
  sink: EventSink & { readonly peek: () => Date };
  world: ProactiveWorld;
  ports: ObservationPorts;
}): Promise<ObservationResult> {
  const { window, clock, sink, world, ports } = input;
  const from = clock.peek();
  const to = new Date(from.getTime() + window.durationMs);
  const firstNew = ports.conversationState.messages.length;

  const user = world.users[0];
  let scheduler: ProactiveSchedulerUseCase | null = null;
  if (user) {
    const checkIn = new ProactiveCheckInUseCase(
      ports.conversationRepo,
      ports.aiProvider,
      ports.outbox,
      ports.memoryRepo,
      undefined,
      undefined,
      clock,
    );
    const repo = record(new InMemoryProactiveSchedulerRepository(world, ports.conversationState, clock), 'proactiveSchedulerRepo', sink);
    const queue = record(new InlineCheckInQueue(checkIn), 'checkInQueue', sink);
    scheduler = new ProactiveSchedulerUseCase(
      repo,
      queue,
      {
        minSilenceDays: user.scan.minSilenceDays,
        minCheckInGapDays: user.scan.minCheckInGapDays,
        quietHoursEnabled: user.scan.quietHoursEnabled,
      },
      clock,
    );
  }

  for (let at = from.getTime(); at < to.getTime(); at += window.scanEveryMs) {
    const lag = at - clock.peek().getTime();
    if (lag > 0) clock.advance(lag);
    if (scheduler) await scheduler.scan();
  }
  const rest = to.getTime() - clock.peek().getTime();
  if (rest > 0) clock.advance(rest);

  const outbound = ports.conversationState.messages
    .slice(firstNew)
    .filter((message) => message.direction === 'outbound')
    .filter((message) => PROACTIVE_OUTBOUND_TYPES.has(ports.conversationState.sideFieldsOf(message.id).messageType ?? ''))
    .filter((message) => message.occurredAt.getTime() >= from.getTime() && message.occurredAt.getTime() <= to.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { from, to, outbound };
}
