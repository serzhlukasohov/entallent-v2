import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebClient } from '@slack/web-api';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PulseSlackTransport, PULSE_SLACK_OPTIONS } from './pulse-report-transport';
const body = {
  text: 'literal',
  blocks: [],
  mrkdwn: false,
  parse: 'none',
  link_names: false,
  unfurl_links: false,
  unfurl_media: false,
};
test('native transport has finite no-retry SDK settings and exact workspace/private DM proof', async () => {
  assert.equal(PULSE_SLACK_OPTIONS.retryConfig.retries, 0);
  assert.equal(PULSE_SLACK_OPTIONS.rejectRateLimitedCalls, true);
  assert.equal(PULSE_SLACK_OPTIONS.timeout, 10000);
  let posts = 0;
  const client = {
    auth: { test: async () => ({ ok: true, team_id: 'T1', user_id: 'B1', bot_id: 'bot' }) },
    conversations: {
      open: async () => ({ channel: { id: 'D1' } }),
      info: async () => ({ ok: true, channel: { id: 'D1', is_im: true, user: 'U1' } }),
    },
    chat: {
      postMessage: async () => {
        posts++;
        return { ok: true, channel: 'D1', ts: '1793200000.123456' };
      },
    },
  };
  const transport = new PulseSlackTransport(() => client as never);
  const candidate = { workspaceId: 'T1', slackUserId: 'U1' } as never;
  assert.equal((await transport.prove(candidate, 'synthetic'))?.channelId, 'D1');
  assert.equal(
    await transport.prove(
      { ...(candidate as object), workspaceId: 'Twrong' } as never,
      'synthetic',
    ),
    null,
  );
  assert.equal((await transport.post('synthetic', 'D1', body)).status, 'accepted');
  assert.equal(posts, 1);
});
test('unverified response, network errors and timeout remain unknown; explicit provider rejection is nonpublication', async () => {
  for (const error of [
    { code: 'slack_webapi_request_error' },
    { code: 'timeout' },
    { code: 'anything' },
  ]) {
    let calls = 0;
    const t = new PulseSlackTransport(
      () =>
        ({
          chat: {
            postMessage: async () => {
              calls++;
              throw error;
            },
          },
        }) as never,
    );
    assert.equal((await t.post('synthetic', 'D1', body)).status, 'unknown');
    assert.equal(calls, 1);
  }
  for (const code of ['invalid_auth', 'channel_not_found', 'missing_scope']) {
    const t = new PulseSlackTransport(
      () =>
        ({
          chat: {
            postMessage: async () => {
              throw { code: 'slack_webapi_platform_error', data: { error: code } };
            },
          },
        }) as never,
    );
    assert.equal((await t.post('synthetic', 'D1', body)).status, 'definitely_not_sent');
  }
});

test('actual Slack SDK rate limit has one invocation and no hidden retry', async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    res.end('{"ok":false,"error":"ratelimited"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture address');
  const client = new WebClient('synthetic-fixture-token', {
    ...PULSE_SLACK_OPTIONS,
    slackApiUrl: 'http://127.0.0.1:' + address.port + '/',
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      getLevel() {
        return 'error' as never;
      },
      setLevel() {},
      setName() {},
    },
  });
  const transport = new PulseSlackTransport(() => client);
  try {
    const result = await transport.post('synthetic', 'D1', body);
    assert.equal(result.status, 'definitely_not_sent');
    assert.equal(calls, 1);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
test('malformed or mismatched positive responses remain unknown after exactly one invocation', async () => {
  for (const response of [
    { ok: true, channel: 'D1' },
    { ok: true, channel: 'Dother', ts: '1793200000.123456' },
    { ok: true, channel: 'D1', ts: 'invalid' },
    { ok: false, channel: 'D1', ts: '1793200000.123456' },
  ]) {
    let calls = 0;
    const transport = new PulseSlackTransport(
      () =>
        ({
          chat: {
            postMessage: async () => {
              calls++;
              return response;
            },
          },
        }) as never,
    );
    assert.equal((await transport.post('synthetic', 'D1', body)).status, 'unknown');
    assert.equal(calls, 1);
  }
});
test('actual Slack SDK timeout closes the one local HTTP request without retry and stays unknown', async () => {
  let calls = 0,
    closed!: () => void;
  const requestClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((_req, res) => {
    calls++;
    res.on('close', closed);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture address');
  const client = new WebClient('synthetic-fixture-token', {
    ...PULSE_SLACK_OPTIONS,
    timeout: 50,
    slackApiUrl: 'http://127.0.0.1:' + address.port + '/',
  });
  try {
    assert.equal(
      (await new PulseSlackTransport(() => client).post('synthetic', 'D1', body)).status,
      'unknown',
    );
    await Promise.race([
      requestClosed,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(Error('SDK timeout did not terminate request')),
          1000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
test('private metadata or implicit routing never reaches SDK', async () => {
  let calls = 0;
  const transport = new PulseSlackTransport(() => {
    calls++;
    throw Error('must not construct client');
  });
  assert.equal(
    (await transport.post('synthetic', 'D1', { ...body, metadata: { source: 'private' } })).status,
    'definitely_not_sent',
  );
  assert.equal(calls, 0);
});
