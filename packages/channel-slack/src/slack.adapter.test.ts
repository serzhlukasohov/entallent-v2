import assert from 'node:assert/strict';
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
