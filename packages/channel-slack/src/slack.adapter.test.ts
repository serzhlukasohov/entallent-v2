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
const teamLeadActions = [
  { actionId: 'onboarding:start', label: 'Start My Conversation', value: 'start' },
  { actionId: 'onboarding:got_it', label: 'Got It', value: 'got_it' },
  { actionId: 'onboarding:later', label: 'Later', value: 'later' },
  { actionId: 'onboarding:decline', label: 'No Personal Check-ins', value: 'decline' },
];

type Block = Record<string, unknown>;
type Element = { action_id: string; value: string; text: { text: string } };

describe('SlackAdapter buttons', () => {
  it('sends section blocks split on blank lines plus the four Team Lead buttons in order', async () => {
    let posted: Record<string, unknown> | undefined;
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', {
      chat: { postMessage: async (input: Record<string, unknown>) => {
        posted = input;
        return { ok: true, ts: '1788430496.123456' };
      } },
    });
    await adapter.sendMessage({ ...message, text: 'One\n\nTwo', actions: teamLeadActions });

    assert.equal(posted?.['text'], 'One\n\nTwo');
    const blocks = posted?.['blocks'] as Block[];
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]?.['type'], 'section');
    assert.equal((blocks[1]?.['text'] as { text: string }).text, 'Two');
    const actions = blocks[2]!;
    assert.equal(actions['type'], 'actions');
    assert.deepEqual((actions['elements'] as Element[]).map((e) => e.action_id), [
      'onboarding:start', 'onboarding:got_it', 'onboarding:later', 'onboarding:decline',
    ]);
    assert.deepEqual((actions['elements'] as Element[]).map((e) => e.text.text), teamLeadActions.map((a) => a.label));
    assert.equal((actions['elements'] as Element[])[0]?.value, 'start');
  });

  it('sends plain text with no blocks when there are no actions', async () => {
    let posted: Record<string, unknown> | undefined;
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', {
      chat: { postMessage: async (input: Record<string, unknown>) => {
        posted = input;
        return { ok: true, ts: '1788430496.123456' };
      } },
    });
    await adapter.sendMessage(message);
    assert.equal(posted?.['blocks'], undefined);
  });

  it('splits a section paragraph longer than the Slack limit', async () => {
    let posted: Record<string, unknown> | undefined;
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', {
      chat: { postMessage: async (input: Record<string, unknown>) => {
        posted = input;
        return { ok: true, ts: '1788430496.123456' };
      } },
    });
    await adapter.sendMessage({ ...message, text: 'x'.repeat(3500), actions: teamLeadActions });
    const blocks = posted?.['blocks'] as Block[];
    assert.equal(blocks.length, 3);
    assert.ok(blocks.slice(0, 2).every((b) => (b['text'] as { text: string }).text.length <= 3000));
  });
});

describe('SlackAdapter.updateMessage', () => {
  it('calls chat.update with the DM channel, ts and blocks without buttons', async () => {
    let updated: Record<string, unknown> | undefined;
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', {
      chat: { update: async (input: Record<string, unknown>) => {
        updated = input;
        return { ok: true };
      } },
    });
    await adapter.updateMessage({
      tenantId: message.tenantId,
      externalChannelId: 'D123',
      externalMessageId: '1788430496.123456',
      text: 'Body\n\n_Done_',
    });
    assert.equal(updated?.['channel'], 'D123');
    assert.equal(updated?.['ts'], '1788430496.123456');
    const blocks = updated?.['blocks'] as Block[];
    assert.ok(blocks.every((b) => b['type'] === 'section'));
  });

  it('throws when Slack rejects the update', async () => {
    const adapter = new SlackAdapter({ botToken: 'test-token' });
    Reflect.set(adapter, 'webClient', { chat: { update: async () => ({ ok: false, error: 'message_not_found' }) } });
    await assert.rejects(
      adapter.updateMessage({ tenantId: message.tenantId, externalChannelId: 'D1', externalMessageId: '1.1', text: 't' }),
      /message_not_found/,
    );
  });
});
