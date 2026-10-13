import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import type { ChatPostMessageResponse } from '@slack/web-api';
import { SlackAdapter } from './slack.adapter';

const message = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  conversationId: '00000000-0000-4000-8000-000000000002',
  text: 'Delivered',
  channel: 'slack' as const,
  externalWorkspaceId: 'T1',
  externalChannelId: 'C1',
};

function adapterReturning(result: ChatPostMessageResponse): SlackAdapter {
  const adapter = new SlackAdapter({ botToken: 'test-token' });
  Reflect.set(adapter, 'webClient', {
    chat: { postMessage: async () => result },
  });
  return adapter;
}

describe('SlackAdapter.verifyRequest', () => {
  const signingSecret = 'test-secret';
  const rawBody = '{"type":"event_callback"}';
  const adapter = new SlackAdapter({ signingSecret });

  function signedAt(timestamp: string) {
    return adapter.verifyRequest({
      rawBody,
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=' + createHmac('sha256', signingSecret)
          .update(`v0:${timestamp}:${rawBody}`).digest('hex'),
      },
    });
  }

  it('accepts a current signed request', async () => {
    assert.equal(await signedAt(String(Math.floor(Date.now() / 1000))), true);
  });

  it('rejects a signed request more than five minutes in the future', async () => {
    assert.equal(await signedAt(String(Math.floor(Date.now() / 1000) + 301)), false);
  });

  it('rejects a malformed signed timestamp', async () => {
    assert.equal(await signedAt('not-a-timestamp'), false);
  });
});

describe('SlackAdapter.sendMessage', () => {
  it('uses the Slack message timestamp as the delivery time', async () => {
    const result = await adapterReturning({ ok: true, ts: '1788430496.123456' })
      .sendMessage(message);

    assert.deepEqual(result.sentAt, new Date('2026-09-03T10:14:56.123Z'));
  });

  it('rejects a malformed Slack message timestamp', async () => {
    await assert.rejects(
      adapterReturning({ ok: true, ts: 'not-a-timestamp' }).sendMessage(message),
      /Slack sendMessage returned an invalid timestamp/,
    );
  });
});

describe('SlackAdapter.openDirectMessage', () => {
  it('returns the DM channel and passes the linked Slack user ID', async () => {
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    let userId: string | undefined;
    Reflect.set(adapter, 'webClient', {
      conversations: { open: async (input: { users: string }) => {
        userId = input.users;
        return { ok: true, channel: { id: 'D123' } };
      } },
    });

    assert.equal(await adapter.openDirectMessage('U123'), 'D123');
    assert.equal(userId, 'U123');
  });

  it('rejects a successful response without a channel', async () => {
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', { conversations: { open: async () => ({ ok: true }) } });
    await assert.rejects(adapter.openDirectMessage('U123'), /missing channel/);
  });
});

describe('SlackAdapter.getDirectMessageUser', () => {
  it('reads the owner of an existing DM without opening a new channel', async () => {
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', { conversations: {
      info: async () => ({ ok: true, channel: { id: 'D123', is_im: true, user: 'U123' } }),
    } });
    assert.equal(await adapter.getDirectMessageUser('D123'), 'U123');
  });

  it('rejects a channel that is not the requested DM', async () => {
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', { conversations: {
      info: async () => ({ ok: true, channel: { id: 'C123', is_im: false, user: 'U123' } }),
    } });
    assert.equal(await adapter.getDirectMessageUser('D123'), null);
  });
});
