import { DevApiClient, type DevApiRequest, type DevApiResponse, type DevJobStatus } from '../dev-api-client';
import { L2ApplicationExecutor, type L2ExecutorOptions } from '../l2-application-executor';
import { validateSuite } from '../../loader';
import type { LoadedSuite } from '../../schema';

/**
 * A scripted fake of the local stack's `/api/v1/dev` endpoints behind the injected transport:
 * no network, no stack, no model. Each `simulate-message` starts the next scripted step; its
 * `polls[k]` outbounds appear on the k-th `messages?after=` read, `late` ones on the first
 * after-read that follows an unfiltered read (the executor's timeout branch).
 */

export const TENANT = '00000000-0000-4000-8000-000000000001';
export const KEY = 'admin-key-test-fake';
export const RUN_ID = '2026-10-26T10-00-00-000Z-abc1234';
/** `suite.config.json` `l2.workerEnv`. */
export const WORKER_ENV = { PROACTIVE_SCAN_ENABLED: 'false' } as const;
export const T0 = Date.parse('2026-10-26T10:00:00.000Z');

export interface Out {
  text: string;
  /** Own outbounds carry the step's traceId; foreign ones another trace (a check-in, an intro). */
  own?: boolean;
  metadata?: Record<string, unknown> | null;
  sentAt?: string | null;
}

export interface StepScript {
  polls?: Out[][];
  late?: Out[];
  jobStatus?: DevJobStatus | null;
  /** Return the inbound itself on after reads. */
  includeInbound?: boolean;
  /** simulate-message answers another conversation. */
  otherConversation?: boolean;
}

interface Row {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  occurredAt: string;
  traceId: string | null;
  messageType: string;
  sentAt: string | null;
  metadata: unknown;
  jobStatus: DevJobStatus | null;
}

export interface StackOptions {
  steps?: StepScript[];
  /** The script of every step past `steps` (default: none, i.e. silence). */
  defaultStep?: StepScript;
  /** Rows the deep reset leaves behind (a broken reset). */
  leftover?: number;
  afterStatus?: number;
  status?: Partial<Record<string, number>>;
  /** With a forced `reset-user` status: reset first, then answer that status (the 404 path). */
  resetCommits?: boolean;
  memory?: number;
  survey?: number;
  confirmation?: Record<string, unknown>;
}

export class FakeStack {
  readonly requests: DevApiRequest[] = [];
  readonly sleeps: number[] = [];
  now = T0;
  private seq = 0;
  private conversation = 'conv-0';
  private readonly users = new Map<string, string>();
  private readonly rows = new Map<string, Row[]>();
  private stepIndex = -1;
  private pollIndex = 0;
  private inbound: Row | null = null;
  private timeoutRead = false;

  constructor(private readonly options: StackOptions = {}) {}

  readonly transport = async (request: DevApiRequest): Promise<DevApiResponse> => {
    this.requests.push(request);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1\/dev\//, '');
    const route = path.replace(/^conversation\/[^/]+\//, 'conversation/:id/').replace(/^user\/[^/]+\//, 'user/:id/');
    const forced = this.options.status?.[route];
    // The real reset-user deep-resets before onboarding restart answers 404; others fail untouched.
    if (forced !== undefined && !(route === 'reset-user' && this.options.resetCommits)) return { status: forced, body: { message: 'forced' } };
    const body = request.body !== undefined ? (JSON.parse(request.body) as Record<string, unknown>) : {};

    if (route === 'find-conversation') {
      const external = url.searchParams.get('userId')!;
      if (!this.users.has(external)) this.users.set(external, `user-${this.users.size + 1}`);
      if (!this.rows.has(this.conversation)) this.rows.set(this.conversation, []);
      return { status: 200, body: { conversationId: this.conversation, userId: this.users.get(external) } };
    }
    if (route === 'reset-user') {
      const leftover = this.rows.get(this.conversation) ?? [];
      this.conversation = `conv-${Number(this.conversation.slice(5)) + 1}`;
      this.rows.set(this.conversation, Array.from({ length: this.options.leftover ?? 0 }, () => this.row('outbound', 'old', null)));
      if (forced !== undefined) return { status: forced, body: { message: 'user not found' } };
      return { status: 200, body: { userId: body.userId, deleted: leftover.length, onboarding: { introQueued: false } } };
    }
    if (route === 'simulate-message') {
      this.stepIndex += 1;
      this.pollIndex = 0;
      this.timeoutRead = false;
      const traceId = `trace-${this.stepIndex + 1}`;
      this.inbound = this.row('inbound', String(body.text), traceId);
      this.inbound.jobStatus = this.script().jobStatus === undefined ? 'completed' : this.script().jobStatus!;
      this.rows.get(this.conversation)!.push(this.inbound);
      const conversationId = this.script().otherConversation ? 'conv-other' : this.conversation;
      return { status: 202, body: { traceId, messageId: this.inbound.id, conversationId, userId: 'user-1' } };
    }
    if (route === 'conversation/:id/messages') {
      const all = this.rows.get(path.split('/')[1]!) ?? [];
      const after = url.searchParams.get('after');
      if (after === null) {
        if (this.inbound) this.timeoutRead = true;
        return { status: 200, body: all.map((row) => ({ ...row })) };
      }
      if (this.options.afterStatus !== undefined) return { status: this.options.afterStatus, body: { message: 'after message not found' } };
      const script = this.script();
      const arriving = this.timeoutRead ? (script.late ?? []) : (script.polls?.[this.pollIndex] ?? []);
      if (this.timeoutRead) this.timeoutRead = false;
      this.pollIndex += 1;
      for (const out of arriving) {
        const row = this.row('outbound', out.text, out.own === false ? `foreign-${this.seq}` : this.inbound!.traceId);
        if (out.metadata !== undefined) row.metadata = out.metadata;
        if (out.sentAt !== undefined) row.sentAt = out.sentAt;
        all.push(row);
      }
      const index = all.findIndex((row) => row.id === after);
      const rows = all.slice(script.includeInbound ? index : index + 1);
      return { status: 200, body: rows.map((row) => ({ ...row })) };
    }
    if (route === 'user/:id/question-confirmation') {
      return {
        status: 200,
        body: {
          surveyWindowId: null,
          group: url.searchParams.get('group'),
          questions: [],
          progress: { answered: 0, total: 0 },
          appliedVerdicts: [],
          stagedBundleCount: 0,
          pendingClarification: null,
          ...this.options.confirmation,
        },
      };
    }
    if (route === 'user/:id/survey-state') return { status: 200, body: { count: this.options.survey ?? 0, evidence: [] } };
    if (route === 'user/:id/memory') return { status: 200, body: { count: this.options.memory ?? 0, items: [] } };
    return { status: 404, body: { message: `no route ${route}` } };
  };

  executor(overrides: Partial<L2ExecutorOptions> = {}): L2ApplicationExecutor {
    return new L2ApplicationExecutor({
      client: new DevApiClient({ origin: 'http://localhost:3000', tenantId: TENANT, apiKey: KEY }, this.transport),
      sleep: async (ms) => {
        this.sleeps.push(ms);
        this.now += ms;
      },
      now: () => this.now,
      workerEnv: WORKER_ENV,
      ...overrides,
    });
  }

  /** Method and route of every request, without ids. */
  routes(): string[] {
    return this.requests.map((request) => `${request.method} ${new URL(request.url).pathname.replace(/^\/api\/v1\/dev\//, '').replace(/^(conversation|user)\/[^/]+/, '$1/:id')}`);
  }

  private script(): StepScript {
    return this.options.steps?.[this.stepIndex] ?? this.options.defaultStep ?? {};
  }

  private row(direction: 'inbound' | 'outbound', text: string, traceId: string | null): Row {
    this.seq += 1;
    return {
      id: `m-${this.seq}`,
      direction,
      text,
      occurredAt: new Date(T0 + this.seq * 1_000).toISOString(),
      traceId,
      messageType: direction === 'inbound' ? 'user' : 'reply',
      sentAt: direction === 'outbound' ? new Date(T0 + this.seq * 1_000).toISOString() : null,
      metadata: null,
      jobStatus: null,
    };
  }
}

/** A P-10-like suite: one L2 journey (two steps, freshPersona) plus the atomic coverage test the loader requires. */
export function l2JourneySuite(id = 'x-l2'): LoadedSuite {
  const sources = [
    {
      id: 'X-10',
      requirement: ['REQ-10'],
      kind: 'conversation',
      expectedBehavior: 'The coach keeps the thread across a two-step check-in.',
      criteria: [
        { id: 'X-10.C1', layer: 'P', passCondition: 'The coach replies to the first step.' },
        { id: 'X-10.C2', layer: 'D', passCondition: 'The second reply follows up on the first.' },
        { id: 'X-10.C3', layer: 'S', passCondition: 'Exactly two outbound messages are recorded.' },
      ],
    },
  ];
  const tests = [
    {
      // Atomic coverage (the loader requires it); atomic tests never declare L2, so it is out of scope here.
      id: 'X-10.A1',
      sourceCase: 'X-10',
      requirement: ['REQ-10'],
      kind: 'atomic',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: [],
      seed: { history: [] },
      preconditions: [],
      steps: [{ text: 'Rough week.' }],
      criteria: [
        { id: 'X-10.C1', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }] },
        { id: 'X-10.C2', evaluatedAt: 'reply:1', checks: [{ type: 'meaning' }] },
        { id: 'X-10.C3', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }] },
      ],
    },
    {
      id: 'X-10.J',
      sourceCase: 'X-10',
      requirement: ['REQ-10'],
      kind: 'journey',
      levels: ['L2'],
      runProfile: 'isolated',
      setup: [{ name: 'freshPersona' }],
      preconditions: [],
      steps: [{ text: 'Rough week.' }, { text: 'Two releases slipped.' }],
      criteria: [
        { id: 'X-10.C1', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }] },
        { id: 'X-10.C2', evaluatedAt: 'reply:2', checks: [{ type: 'meaning' }] },
        {
          id: 'X-10.C3',
          evaluatedAt: 'state',
          stateQuery: { name: 'outboundCount', at: 'after', kind: 'change' },
          checks: [{ type: 'rule', rule: 'state-equals', params: { query: 'outboundCount', at: 'after', expected: 2 } }],
        },
      ],
    },
  ];
  return validateSuite(id, { sources, tests });
}
