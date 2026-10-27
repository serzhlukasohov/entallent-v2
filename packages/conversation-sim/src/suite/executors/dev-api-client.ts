import { z } from 'zod';

/**
 * The L2 client over the local stack's `/api/v1/dev` endpoints (architecture AD-4, Epic 14).
 * It talks only to a localhost API (`devApiConfigFromEnv` refuses anything else), sends
 * `X-Api-Key` on every call and validates every response body with a zod schema. Network
 * access is an injected `DevApiTransport`; only `run-live.ts` builds the default
 * `createFetchTransport`. The key is never logged or put in an error message.
 */

export interface DevApiConfig {
  /** `<protocol>//<host>[:port]` of the local API; requests go to `<origin>/api/v1/dev/...`. */
  origin: string;
  tenantId: string;
  apiKey: string;
}

/** A refused L2 environment; the message names the variable and the rule, never the value. */
export class DevApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevApiConfigError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Compared after trailing slashes are removed, so `/` and `/api/v1/` are accepted too. */
const ALLOWED_PATHS = new Set(['', '/api/v1']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads `SUITE_L2_API_BASE` (http/https, host exactly localhost, 127.0.0.1 or [::1], path
 * empty, `/` or `/api/v1` (a trailing slash is allowed), no userinfo, query or hash), `SUITE_L2_TENANT_ID` (a UUID) and
 * `ADMIN_API_KEY` (non-empty). Throws `DevApiConfigError` on the first violation.
 */
export function devApiConfigFromEnv(env: Readonly<Record<string, string | undefined>>): DevApiConfig {
  const refuse = (variable: string, rule: string): never => {
    throw new DevApiConfigError(`[suite] L2: ${variable} ${rule}`);
  };
  const base = env.SUITE_L2_API_BASE?.trim() ?? '';
  if (base === '') refuse('SUITE_L2_API_BASE', 'is required');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return refuse('SUITE_L2_API_BASE', 'must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') refuse('SUITE_L2_API_BASE', 'must use http: or https:');
  if (!LOCAL_HOSTS.has(url.hostname)) refuse('SUITE_L2_API_BASE', 'must target localhost, 127.0.0.1 or [::1] (never a remote or production host)');
  if (url.username !== '' || url.password !== '') refuse('SUITE_L2_API_BASE', 'must not carry userinfo');
  if (url.search !== '' || base.includes('?')) refuse('SUITE_L2_API_BASE', 'must not carry a query');
  if (url.hash !== '' || base.includes('#')) refuse('SUITE_L2_API_BASE', 'must not carry a hash');
  if (!ALLOWED_PATHS.has(url.pathname.replace(/\/+$/, ''))) refuse('SUITE_L2_API_BASE', 'path must be empty, / or /api/v1');

  const tenantId = env.SUITE_L2_TENANT_ID?.trim() ?? '';
  if (!UUID_PATTERN.test(tenantId)) refuse('SUITE_L2_TENANT_ID', 'must be a UUID');

  const apiKey = env.ADMIN_API_KEY ?? '';
  if (apiKey.trim() === '') refuse('ADMIN_API_KEY', 'is required (non-empty)');

  return { origin: url.origin, tenantId, apiKey };
}

export interface DevApiRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  /** JSON text for POST requests. */
  body?: string;
}

export interface DevApiResponse {
  status: number;
  /** The parsed JSON body; `null` when the body is empty, `undefined` when it is not JSON. */
  body: unknown;
}

/** One HTTP exchange; a rejection is a transport failure (including a timeout). */
export type DevApiTransport = (request: DevApiRequest) => Promise<DevApiResponse>;

/**
 * The default transport over the global `fetch`, with a per-request timeout. Only
 * `run-live.ts` calls it; tests inject a fake transport (or `fetchImpl`).
 */
export function createFetchTransport(timeoutMs: number, fetchImpl: typeof fetch = globalThis.fetch): DevApiTransport {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      // A redirect could carry X-Api-Key past the localhost guard: it fails as a transport error.
      redirect: 'error',
    });
    const text = await response.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    return { status: response.status, body };
  };
}

export type DevApiOperation =
  | 'findConversation'
  | 'resetUser'
  | 'simulateMessage'
  | 'messages'
  | 'questionConfirmation'
  | 'surveyState'
  | 'memory';

/**
 * A failed dev API call: non-2xx (`status`), or a transport rejection, timeout or a body
 * failing its schema (`status` null for the first two; the response status for the last).
 */
export class DevApiError extends Error {
  readonly operation: DevApiOperation;
  readonly status: number | null;
  override readonly cause: unknown;

  constructor(input: { operation: DevApiOperation; status: number | null; detail: string; cause?: unknown }) {
    super(`[suite] dev API ${input.operation} failed: ${input.detail}`);
    this.name = 'DevApiError';
    this.operation = input.operation;
    this.status = input.status;
    this.cause = input.cause;
  }
}

const IsoString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'expected an ISO timestamp');

export const FindConversationSchema = z.object({ conversationId: z.string().min(1), userId: z.string().min(1) }).passthrough();
export const ResetUserSchema = z.object({}).passthrough();
export const SimulateMessageSchema = z
  .object({ traceId: z.string().min(1), messageId: z.string().min(1), conversationId: z.string().min(1), userId: z.string().min(1) })
  .passthrough();
export const DevJobStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export const DevMessageRowSchema = z
  .object({
    id: z.string().min(1),
    direction: z.enum(['inbound', 'outbound']),
    text: z.string(),
    occurredAt: IsoString,
    traceId: z.string().nullable(),
    messageType: z.string().nullable().optional(),
    sentAt: IsoString.nullable(),
    metadata: z.unknown().optional(),
    jobStatus: DevJobStatusSchema.nullable().optional(),
  })
  .passthrough();
export const DevMessagesSchema = z.array(DevMessageRowSchema);
const nonNegativeInt = z.number().int().nonnegative();
export const QuestionConfirmationSchema = z
  .object({
    surveyWindowId: z.string().nullable(),
    group: z.string().nullable(),
    questions: z.array(
      z.object({ surveyQuestionId: z.string(), stableKey: z.string(), questionGroup: z.string(), status: z.string() }).passthrough(),
    ),
    progress: z.object({ answered: nonNegativeInt, total: nonNegativeInt }).passthrough(),
    appliedVerdicts: z.array(z.unknown()),
    stagedBundleCount: nonNegativeInt,
    pendingClarification: z.object({}).passthrough().nullable(),
  })
  .passthrough();
export const CountSchema = z.object({ count: nonNegativeInt }).passthrough();

export type DevFindConversation = z.infer<typeof FindConversationSchema>;
export type DevSimulatedMessage = z.infer<typeof SimulateMessageSchema>;
export type DevJobStatus = z.infer<typeof DevJobStatusSchema>;
export type DevMessageRow = z.infer<typeof DevMessageRowSchema>;
export type DevQuestionConfirmation = z.infer<typeof QuestionConfirmationSchema>;
export type DevCount = z.infer<typeof CountSchema>;

/** The dev API calls the L2 executor makes; every one sends `X-Api-Key`. */
export class DevApiClient {
  readonly tenantId: string;
  private readonly origin: string;
  private readonly apiKey: string;
  private readonly transport: DevApiTransport;

  constructor(config: DevApiConfig, transport: DevApiTransport) {
    this.origin = config.origin;
    this.tenantId = config.tenantId;
    this.apiKey = config.apiKey;
    this.transport = transport;
  }

  findConversation(externalUserId: string, userName: string): Promise<DevFindConversation> {
    const query = new URLSearchParams({ tenantId: this.tenantId, userId: externalUserId, userName });
    return this.call('findConversation', 'GET', `find-conversation?${query.toString()}`, FindConversationSchema);
  }

  resetUser(userId: string): Promise<z.infer<typeof ResetUserSchema>> {
    return this.call('resetUser', 'POST', 'reset-user', ResetUserSchema, { userId, tenantId: this.tenantId, deep: true });
  }

  simulateMessage(externalUserId: string, text: string): Promise<DevSimulatedMessage> {
    return this.call('simulateMessage', 'POST', 'simulate-message', SimulateMessageSchema, { tenantId: this.tenantId, userId: externalUserId, text });
  }

  /** The conversation's messages oldest first; with `after`, only the rows after that message (400 when unknown). */
  messages(conversationId: string, after?: string): Promise<DevMessageRow[]> {
    const query = after !== undefined ? `?${new URLSearchParams({ after }).toString()}` : '';
    return this.call('messages', 'GET', `conversation/${encodeURIComponent(conversationId)}/messages${query}`, DevMessagesSchema);
  }

  questionConfirmation(userId: string, group: string | null): Promise<DevQuestionConfirmation> {
    const query = new URLSearchParams({ tenantId: this.tenantId, ...(group !== null ? { group } : {}) });
    return this.call(
      'questionConfirmation',
      'GET',
      `user/${encodeURIComponent(userId)}/question-confirmation?${query.toString()}`,
      QuestionConfirmationSchema,
    );
  }

  surveyState(userId: string): Promise<DevCount> {
    return this.call('surveyState', 'GET', `user/${encodeURIComponent(userId)}/survey-state`, CountSchema);
  }

  memory(userId: string): Promise<DevCount> {
    return this.call('memory', 'GET', `user/${encodeURIComponent(userId)}/memory`, CountSchema);
  }

  private async call<T extends z.ZodTypeAny>(
    operation: DevApiOperation,
    method: 'GET' | 'POST',
    path: string,
    schema: T,
    body?: Record<string, unknown>,
  ): Promise<z.infer<T>> {
    const request: DevApiRequest = {
      method,
      url: `${this.origin}/api/v1/dev/${path}`,
      headers: {
        'X-Api-Key': this.apiKey,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    let response: DevApiResponse;
    try {
      response = await this.transport(request);
    } catch (error) {
      // Only the error name: a transport message could echo request details.
      const name = error instanceof Error ? error.name : 'non-error rejection';
      throw new DevApiError({ operation, status: null, detail: `transport error (${name})`, cause: error });
    }
    if (response.status < 200 || response.status > 299) {
      throw new DevApiError({ operation, status: response.status, detail: `status ${response.status}` });
    }
    const parsed = schema.safeParse(response.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DevApiError({
        operation,
        status: response.status,
        detail: `invalid response body at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
      });
    }
    return parsed.data;
  }
}
