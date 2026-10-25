import { describe, expect, it } from 'vitest';
import {
  DevApiClient,
  DevApiConfigError,
  DevApiError,
  createFetchTransport,
  devApiConfigFromEnv,
  type DevApiRequest,
  type DevApiResponse,
} from './dev-api-client';

const TENANT = '00000000-0000-4000-8000-000000000001';
const KEY = 'admin-key-test-fake-0123456789';
const ENV = { SUITE_L2_API_BASE: 'http://localhost:3000', SUITE_L2_TENANT_ID: TENANT, ADMIN_API_KEY: KEY };

function recording(respond: (request: DevApiRequest) => DevApiResponse | Promise<DevApiResponse>) {
  const requests: DevApiRequest[] = [];
  const transport = async (request: DevApiRequest) => {
    requests.push(request);
    return respond(request);
  };
  return { requests, client: new DevApiClient(devApiConfigFromEnv(ENV), transport) };
}

function refusal(env: Record<string, string | undefined>): string {
  try {
    devApiConfigFromEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(DevApiConfigError);
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('devApiConfigFromEnv', () => {
  it.each([
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/api/v1', 'http://127.0.0.1:3000'],
    ['http://localhost:3000/api/v1/', 'http://localhost:3000'],
    ['https://localhost', 'https://localhost'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
  ])('accepts %s', (base, origin) => {
    expect(devApiConfigFromEnv({ ...ENV, SUITE_L2_API_BASE: base })).toEqual({ origin, tenantId: TENANT, apiKey: KEY });
  });

  it.each([
    [{ SUITE_L2_API_BASE: undefined }, 'SUITE_L2_API_BASE is required'],
    [{ SUITE_L2_API_BASE: '  ' }, 'SUITE_L2_API_BASE is required'],
    [{ SUITE_L2_API_BASE: 'localhost:3000' }, 'SUITE_L2_API_BASE must use http: or https:'],
    [{ SUITE_L2_API_BASE: 'not a url' }, 'SUITE_L2_API_BASE must be an absolute http(s) URL'],
    [{ SUITE_L2_API_BASE: 'ftp://localhost' }, 'SUITE_L2_API_BASE must use http: or https:'],
    [{ SUITE_L2_API_BASE: 'https://api.prod-secret.example.com' }, 'SUITE_L2_API_BASE must target localhost, 127.0.0.1 or [::1]'],
    [{ SUITE_L2_API_BASE: 'http://localhost.evil-secret.example' }, 'SUITE_L2_API_BASE must target localhost'],
    [{ SUITE_L2_API_BASE: 'http://10.0.0.5:3000' }, 'SUITE_L2_API_BASE must target localhost'],
    [{ SUITE_L2_API_BASE: 'http://user:pw-secret@localhost:3000' }, 'SUITE_L2_API_BASE must not carry userinfo'],
    [{ SUITE_L2_API_BASE: 'http://localhost:3000/?q=secret' }, 'SUITE_L2_API_BASE must not carry a query'],
    [{ SUITE_L2_API_BASE: 'http://localhost:3000/?' }, 'SUITE_L2_API_BASE must not carry a query'],
    [{ SUITE_L2_API_BASE: 'http://localhost:3000/#secret' }, 'SUITE_L2_API_BASE must not carry a hash'],
    [{ SUITE_L2_API_BASE: 'http://localhost:3000/x' }, 'SUITE_L2_API_BASE path must be empty, / or /api/v1'],
    [{ SUITE_L2_API_BASE: 'http://localhost:3000/api/v1/dev' }, 'SUITE_L2_API_BASE path must be empty, / or /api/v1'],
    [{ SUITE_L2_TENANT_ID: 'tenant-secret' }, 'SUITE_L2_TENANT_ID must be a UUID'],
    [{ SUITE_L2_TENANT_ID: undefined }, 'SUITE_L2_TENANT_ID must be a UUID'],
    [{ ADMIN_API_KEY: undefined }, 'ADMIN_API_KEY is required'],
    [{ ADMIN_API_KEY: '   ' }, 'ADMIN_API_KEY is required'],
  ])('refuses %j naming the variable and the rule, never the value', (override, message) => {
    const text = refusal({ ...ENV, ...override });
    expect(text).toContain(message);
    expect(text).toMatch(/^\[suite\] L2: /);
    expect(text).not.toMatch(/secret|example|10\.0\.0\.5/);
    expect(text).not.toContain(KEY);
  });
});

describe('DevApiClient', () => {
  it('builds every URL under <origin>/api/v1/dev and sends X-Api-Key on every call', async () => {
    const { requests, client } = recording((request) => {
      if (request.url.includes('find-conversation')) return { status: 200, body: { conversationId: 'c 1', userId: 'u/1' } };
      if (request.url.includes('simulate-message')) return { status: 202, body: { traceId: 't', messageId: 'm', conversationId: 'c', userId: 'u' } };
      if (request.url.includes('/messages')) return { status: 200, body: [] };
      if (request.url.includes('question-confirmation')) {
        return {
          status: 200,
          body: { surveyWindowId: null, group: null, questions: [], progress: { answered: 0, total: 0 }, appliedVerdicts: [], stagedBundleCount: 0, pendingClarification: null },
        };
      }
      return { status: 200, body: { count: 0 } };
    });
    await client.findConversation('suite-r-X 1', 'Suite X');
    await client.resetUser('u-1');
    await client.simulateMessage('suite-r-X', 'Hello there.');
    await client.messages('c-1');
    await client.messages('c-1', 'm 1');
    await client.questionConfirmation('u-1', 'autonomy');
    await client.questionConfirmation('u-1', null);
    await client.surveyState('u-1');
    await client.memory('u-1');

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET http://localhost:3000/api/v1/dev/find-conversation?tenantId=${TENANT}&userId=suite-r-X+1&userName=Suite+X`,
      'POST http://localhost:3000/api/v1/dev/reset-user',
      'POST http://localhost:3000/api/v1/dev/simulate-message',
      'GET http://localhost:3000/api/v1/dev/conversation/c-1/messages',
      'GET http://localhost:3000/api/v1/dev/conversation/c-1/messages?after=m+1',
      `GET http://localhost:3000/api/v1/dev/user/u-1/question-confirmation?tenantId=${TENANT}&group=autonomy`,
      `GET http://localhost:3000/api/v1/dev/user/u-1/question-confirmation?tenantId=${TENANT}`,
      'GET http://localhost:3000/api/v1/dev/user/u-1/survey-state',
      'GET http://localhost:3000/api/v1/dev/user/u-1/memory',
    ]);
    for (const request of requests) expect(request.headers['X-Api-Key']).toBe(KEY);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ userId: 'u-1', tenantId: TENANT, deep: true });
    expect(JSON.parse(requests[2]!.body!)).toEqual({ tenantId: TENANT, userId: 'suite-r-X', text: 'Hello there.' });
    expect(requests[1]!.headers['Content-Type']).toBe('application/json');
  });

  it('accepts JSON dates as ISO strings and the 14.1 message row fields', async () => {
    const row = {
      id: 'm-1', direction: 'outbound', text: 'Hi.', occurredAt: '2026-10-26T10:00:00.000Z', traceId: 't-1',
      messageType: 'reply', sentAt: null, metadata: null, jobStatus: null,
    };
    const { client } = recording(() => ({ status: 200, body: [row] }));
    expect(await client.messages('c-1')).toEqual([row]);
  });

  it.each([
    ['a non-2xx status', () => ({ status: 500, body: { message: 'boom' } }), 500],
    ['a 400', () => ({ status: 400, body: { message: 'after message not found' } }), 400],
    ['a body failing its schema', () => ({ status: 200, body: [{ id: 'm-1' }] }), 200],
    ['a non-JSON body', () => ({ status: 200, body: undefined }), 200],
  ])('maps %s to DevApiError { operation, status }', async (_name, respond, status) => {
    const { client } = recording(respond);
    const error = await client.messages('c-1', 'm-0').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DevApiError);
    expect(error).toMatchObject({ operation: 'messages', status });
    expect((error as Error).message).not.toContain(KEY);
  });

  it('maps a transport rejection or timeout to DevApiError with a null status and no request detail', async () => {
    const { client } = recording(() => {
      const error = new Error(`connect ECONNREFUSED with key ${KEY}`);
      error.name = 'TimeoutError';
      throw error;
    });
    const error = await client.surveyState('u-1').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'DevApiError', operation: 'surveyState', status: null });
    expect((error as Error).message).toBe('[suite] dev API surveyState failed: transport error (TimeoutError)');
  });
});

describe('createFetchTransport', () => {
  it('calls the injected fetch with a timeout signal and parses JSON, empty and non-JSON bodies', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const bodies = ['{"count":2}', '', '<html>'];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(bodies.shift()!, { status: 200 });
    }) as unknown as typeof fetch;
    const transport = createFetchTransport(5_000, fetchImpl);
    const request: DevApiRequest = { method: 'GET', url: 'http://localhost:3000/api/v1/dev/user/u/memory', headers: { 'X-Api-Key': KEY } };
    expect(await transport(request)).toEqual({ status: 200, body: { count: 2 } });
    expect(await transport(request)).toEqual({ status: 200, body: null });
    expect(await transport(request)).toEqual({ status: 200, body: undefined });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.init.headers).toEqual({ 'X-Api-Key': KEY });
    expect(calls[0]!.init.method).toBe('GET');
    expect('body' in calls[0]!.init).toBe(false);
    expect(calls[0]!.init.redirect).toBe('error');
  });

  it('sends a POST with its method, JSON body and content type, never following redirects', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const { requests, client } = recording(async (request) => createFetchTransport(5_000, fetchImpl)(request));
    await client.resetUser('u-1');
    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/dev/reset-user');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe(requests[0]!.body);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ userId: 'u-1', tenantId: TENANT, deep: true });
    expect(calls[0]!.init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Api-Key': KEY });
    expect(calls[0]!.init.redirect).toBe('error');
  });

  it('a redirect is a transport failure: DevApiError with a null status', async () => {
    // fetch with redirect: 'error' rejects with a TypeError on any 3xx.
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      if (init.redirect === 'error') throw new TypeError('fetch failed');
      return new Response('{"count":0}', { status: 200 });
    }) as unknown as typeof fetch;
    const { client } = recording(async (request) => createFetchTransport(5_000, fetchImpl)(request));
    await expect(client.memory('u-1')).rejects.toMatchObject({ name: 'DevApiError', operation: 'memory', status: null });
  });
});
