/**
 * The state a traced turn started from, as the orchestrator itself read it (SPEC CAP-8). Only read
 * results the turn already asked for are kept; nothing is re-read from storage. The first read of
 * each area wins, and an area whose first read came after the turn wrote to a store that can change
 * it is flagged, because that read may already show the turn's own change.
 */

export type StateArea =
  | 'conversation'
  | 'messages'
  | 'reportingDisclosure'
  | 'memory'
  | 'goals'
  | 'styleProfile'
  | 'onboarding'
  | 'cycleProgress'
  | 'nextProbe'
  | 'pulseCapture'
  | 'awaitingBundle'
  | 'pendingClarification'
  | 'readyBundle';

export interface TracedMessage {
  /** Internal message id; used only to map evidence sources to history positions, never exported. */
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface TracedSurveyQuestion {
  id: string;
  questionGroup: string;
  title?: string;
  canonicalMeaning?: string;
  probeStrategies?: string[];
  responseType?: string;
  version?: string;
}

export interface TracedStateBefore {
  conversation?: { userDisplayName: string | null; userTimezone: string | null; hasActiveTopic: boolean };
  /** The history read through the inbound message, oldest first, inbound included. */
  messages?: TracedMessage[];
  /** Position of the turn's inbound message in `messages`. */
  inboundIndex?: number;
  /** How many messages the history read asked for (the orchestrator's window). */
  messagesLimit?: number;
  reportingDisclosure?: { version: string; shownAt: string } | null;
  memory?: Array<{ category: string; content: string; importance: number }>;
  goals?: Array<{ title: string; description?: string; category: string; status: string; priority: string }>;
  styleProfile?: {
    dimensions: Record<string, number>;
    phrases: Array<{ text: string; count: number }>;
    adaptationWeight: number;
    conversationsAnalyzed: number;
  } | null;
  onboarding?: {
    track: string;
    introStatus: string;
    participation: string;
    reminderStatus: string;
    buttonsActive: boolean;
    completedAt: string | null;
    managementAckAt: string | null;
    reminderOriginAt: string | null;
  } | null;
  cycleProgress?: {
    surveyWindowId: string;
    groups: Array<{ questionGroup: string; questions: Array<{ surveyQuestionId: string; status: string }> }>;
  } | null;
  nextProbe?: { windowId: string; focus: string; question: TracedSurveyQuestion } | null;
  pulseCapture?: {
    /** The read asked for one source message's evidence only, so other evidence is unknown. */
    filteredBySource: boolean;
    items: Array<{ evidenceSummary: string; questionGroup: string; status: string; sourceMessageIds: string[] }>;
  };
  /** Pending confirmation state the orchestrator found; true means something was pending. */
  confirmation?: Partial<Record<'awaitingBundle' | 'pendingClarification' | 'readyBundle', boolean>>;
  /** Areas whose first read followed a write by this turn to a store that can change them. */
  readAfterWrite: StateArea[];
}

/** Stores (as the worker names its port decorators) whose writes can change each area. */
const AREA_WRITERS: Record<StateArea, readonly string[]> = {
  conversation: ['conversation'],
  messages: ['conversation'],
  reportingDisclosure: ['conversation'],
  memory: ['memory'],
  goals: ['goals'],
  styleProfile: ['style'],
  onboarding: ['onboarding'],
  cycleProgress: ['questionConfirmation', 'survey', 'pulseBacklog'],
  nextProbe: ['questionConfirmation', 'survey', 'pulseBacklog'],
  pulseCapture: ['questionConfirmation', 'survey', 'pulseBacklog'],
  awaitingBundle: ['questionConfirmation', 'survey'],
  pendingClarification: ['questionConfirmation', 'survey'],
  readyBundle: ['questionConfirmation', 'survey'],
};

type Apply = (state: TracedStateBefore, result: unknown, args: readonly unknown[], context: { inboundMessageId: string | null }) => boolean;

interface ReadSpec {
  area: StateArea;
  /** Stores the area's value; false when this read does not describe the turn (it stays unseen). */
  apply: Apply;
}

const messagesRead = (limitOf: (args: readonly unknown[]) => number | undefined): ReadSpec => ({
  area: 'messages',
  apply: (state, result, args, { inboundMessageId }) => {
    if (!Array.isArray(result)) return false;
    const messages = result.filter(isRecord).map(toTracedMessage).filter((message): message is TracedMessage => message !== null);
    const inboundIndex = messages.findIndex((message) => message.id === inboundMessageId && message.direction === 'inbound');
    if (inboundIndex < 0) return false;
    state.messages = messages;
    state.inboundIndex = inboundIndex;
    const limit = limitOf(args);
    if (limit !== undefined) state.messagesLimit = limit;
    return true;
  },
});

const confirmationRead = (key: 'awaitingBundle' | 'pendingClarification' | 'readyBundle'): ReadSpec => ({
  area: key,
  apply: (state, result) => {
    state.confirmation = { ...state.confirmation, [key]: result !== null && result !== undefined && result !== false };
    return true;
  },
});

/** The orchestrator's state reads, by store and method; every other call passes through unobserved. */
const STATE_READS: Record<string, Record<string, ReadSpec>> = {
  conversation: {
    findById: {
      area: 'conversation',
      apply: (state, result) => {
        if (!isRecord(result)) return false;
        state.conversation = {
          userDisplayName: optionalString(result['userDisplayName']),
          userTimezone: optionalString(result['userTimezone']),
          hasActiveTopic: result['activeTopic'] !== null && result['activeTopic'] !== undefined,
        };
        return true;
      },
    },
    findMessagesThrough: messagesRead((args) => numberField(args[0], 'limit')),
    findRecentMessages: messagesRead((args) => (typeof args[1] === 'number' ? args[1] : undefined)),
    findLatestDeliveredReportingDisclosure: {
      area: 'reportingDisclosure',
      apply: (state, result) => {
        state.reportingDisclosure = isRecord(result) && typeof result['version'] === 'string'
          ? { version: result['version'], shownAt: isoOf(result['shownAt']) ?? '' }
          : null;
        return true;
      },
    },
  },
  memory: {
    findActiveByUser: {
      area: 'memory',
      apply: (state, result) => {
        if (!Array.isArray(result)) return false;
        state.memory = result.filter(isRecord).map((item) => ({
          category: String(item['category'] ?? ''),
          content: String(item['content'] ?? ''),
          importance: typeof item['importance'] === 'number' ? item['importance'] : 0,
        }));
        return true;
      },
    },
  },
  goals: {
    findActiveByUser: {
      area: 'goals',
      apply: (state, result) => {
        if (!Array.isArray(result)) return false;
        state.goals = result.filter(isRecord).map((goal) => ({
          title: String(goal['title'] ?? ''),
          ...(typeof goal['description'] === 'string' ? { description: goal['description'] } : {}),
          category: String(goal['category'] ?? ''),
          status: String(goal['status'] ?? ''),
          priority: String(goal['priority'] ?? ''),
        }));
        return true;
      },
    },
  },
  style: {
    findByUser: {
      area: 'styleProfile',
      apply: (state, result) => {
        state.styleProfile = isRecord(result) && isRecord(result['dimensions'])
          ? {
              dimensions: Object.fromEntries(Object.entries(result['dimensions'])
                .filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
              phrases: (Array.isArray(result['phrases']) ? result['phrases'] : []).filter(isRecord).map((phrase) => ({
                text: String(phrase['text'] ?? ''),
                count: typeof phrase['count'] === 'number' ? phrase['count'] : 1,
              })),
              adaptationWeight: typeof result['adaptationWeight'] === 'number' ? result['adaptationWeight'] : 0,
              conversationsAnalyzed: typeof result['conversationsAnalyzed'] === 'number' ? result['conversationsAnalyzed'] : 0,
            }
          : null;
        return true;
      },
    },
  },
  onboarding: {
    contextFor: {
      area: 'onboarding',
      apply: (state, result) => {
        const onboarding = isRecord(result) && isRecord(result['state']) ? result['state'] : null;
        state.onboarding = onboarding
          ? {
              track: String(onboarding['track'] ?? ''),
              introStatus: String(onboarding['introStatus'] ?? ''),
              participation: String(onboarding['participation'] ?? ''),
              reminderStatus: String(onboarding['reminderStatus'] ?? ''),
              buttonsActive: onboarding['buttonsActive'] === true,
              completedAt: isoOf(onboarding['completedAt']),
              managementAckAt: isoOf(onboarding['managementAckAt']),
              reminderOriginAt: isoOf(onboarding['reminderOriginAt']),
            }
          : null;
        return true;
      },
    },
  },
  questionConfirmation: {
    findCycleProgress: {
      area: 'cycleProgress',
      apply: (state, result) => {
        state.cycleProgress = isRecord(result) && Array.isArray(result['groups'])
          ? {
              surveyWindowId: String(result['surveyWindowId'] ?? ''),
              groups: result['groups'].filter(isRecord).map((group) => ({
                questionGroup: String(group['questionGroup'] ?? ''),
                questions: (Array.isArray(group['questions']) ? group['questions'] : []).filter(isRecord).map((question) => ({
                  surveyQuestionId: String(question['surveyQuestionId'] ?? ''),
                  status: String(question['status'] ?? ''),
                })),
              })),
            }
          : null;
        return true;
      },
    },
    findAwaitingQuestionBundle: confirmationRead('awaitingBundle'),
    findPendingQuestionClarification: confirmationRead('pendingClarification'),
    findReadyQuestionBundle: confirmationRead('readyBundle'),
    hasReadyQuestionBundle: confirmationRead('readyBundle'),
  },
  pulseBacklog: {
    getNextProbeQuestion: {
      area: 'nextProbe',
      apply: (state, result) => {
        const question = isRecord(result) && isRecord(result['question']) ? result['question'] : null;
        state.nextProbe = question && isRecord(result)
          ? {
              windowId: String(result['windowId'] ?? ''),
              focus: typeof result['focus'] === 'string' ? result['focus'] : 'open',
              question: {
                id: String(question['id'] ?? ''),
                questionGroup: String(question['questionGroup'] ?? ''),
                ...stringFields(question, ['title', 'canonicalMeaning', 'responseType', 'version']),
                ...(Array.isArray(question['probeStrategies'])
                  ? { probeStrategies: question['probeStrategies'].filter((entry): entry is string => typeof entry === 'string') }
                  : {}),
              },
            }
          : null;
        return true;
      },
    },
  },
  survey: {
    findPulseCaptureForConversation: {
      area: 'pulseCapture',
      apply: (state, result, args) => {
        if (!Array.isArray(result)) return false;
        state.pulseCapture = {
          filteredBySource: isRecord(args[0]) && typeof args[0]['sourceMessageId'] === 'string',
          items: result.filter(isRecord).map((item) => ({
            evidenceSummary: String(item['evidenceSummary'] ?? ''),
            questionGroup: String(item['questionGroup'] ?? ''),
            status: String(item['status'] ?? ''),
            sourceMessageIds: (Array.isArray(item['sourceMessageIds']) ? item['sourceMessageIds'] : [])
              .filter((id): id is string => typeof id === 'string'),
          })),
        };
        return true;
      },
    },
  },
};

/** Whether `store` has reads worth observing; ports of other stores need no read proxy. */
export function hasStateReads(store: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATE_READS, store);
}

/** Collects the state areas of one turn. Not thread-safe across turns: one collector per turn. */
export class StateBeforeCollector {
  readonly state: TracedStateBefore = { readAfterWrite: [] };
  private readonly written = new Set<string>();
  private readonly seen = new Set<StateArea>();

  constructor(private readonly inboundMessageId: string | null) {}

  /** A store this turn wrote to; later first reads of areas it can change are flagged. */
  noteWrite(store: string): void {
    this.written.add(store);
  }

  observeRead(store: string, method: string, args: readonly unknown[], result: unknown): void {
    const spec = STATE_READS[store]?.[method];
    if (!spec || this.seen.has(spec.area)) return;
    if (!spec.apply(this.state, result, args, { inboundMessageId: this.inboundMessageId })) return;
    this.seen.add(spec.area);
    if (AREA_WRITERS[spec.area].some((writer) => this.written.has(writer))) this.state.readAfterWrite.push(spec.area);
  }
}

export interface StateReadObserver {
  readonly recording: boolean;
  observeRead(store: string, method: string, args: readonly unknown[], result: unknown): void;
}

/**
 * Wraps a port so the results of its state reads reach the observer of the current turn. Calls are
 * forwarded unchanged and the caller gets the same value or rejection; with no recording observer
 * (untraced tenant, no turn) the read is returned as is. Observer failures are swallowed.
 */
export function observeStateReads<T extends object>(
  port: T,
  store: string,
  current: () => StateReadObserver | undefined,
): T {
  const reads = STATE_READS[store];
  if (!reads) return port;
  return new Proxy(port, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (typeof property !== 'string' || !Object.prototype.hasOwnProperty.call(reads, property)) {
        return property === 'constructor' ? value : value.bind(target);
      }
      return (...args: unknown[]) => {
        const read: unknown = value.apply(target, args);
        let observer: StateReadObserver | undefined;
        try {
          observer = current();
          if (!observer?.recording) observer = undefined;
        } catch {
          observer = undefined;
        }
        if (!observer || !(read instanceof Promise)) return read;
        return read.then((result: unknown) => {
          try {
            observer.observeRead(store, property, args, result);
          } catch {
            // Diagnostic only: the caller gets the read unchanged.
          }
          return result;
        });
      };
    },
  });
}

function toTracedMessage(record: Record<string, unknown>): TracedMessage | null {
  const direction = record['direction'];
  const occurredAt = isoOf(record['occurredAt']);
  if ((direction !== 'inbound' && direction !== 'outbound') || typeof record['id'] !== 'string' || !occurredAt) return null;
  return {
    id: record['id'],
    direction,
    text: typeof record['text'] === 'string' ? record['text'] : '',
    occurredAt,
    ...(isRecord(record['metadata']) ? { metadata: JSON.parse(JSON.stringify(record['metadata'])) as Record<string, unknown> } : {}),
  };
}

function stringFields(record: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((key) => typeof record[key] === 'string').map((key) => [key, record[key] as string]));
}

function numberField(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === 'number' ? value[key] : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isoOf(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
