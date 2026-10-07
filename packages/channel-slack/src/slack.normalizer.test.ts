import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSlackEvent } from './slack.normalizer';

function blockActions(overrides: Record<string, unknown> = {}, actions?: unknown[]): Record<string, unknown> {
  return {
    type: 'block_actions',
    team: { id: 'T1' },
    user: { id: 'U1' },
    channel: { id: 'D1' },
    container: { message_ts: '1788430496.123456' },
    message: { ts: '1788430496.123456' },
    actions: actions ?? [{ action_id: 'onboarding:start', value: 'start', action_ts: '1788430500.000100' }],
    ...overrides,
  };
}

describe('normalizeSlackEvent block_actions', () => {
  it('turns a DM block_actions click with one action into an interaction', () => {
    assert.deepEqual(normalizeSlackEvent({ body: blockActions(), tenantId: 't' }), [{
      type: 'interaction',
      payload: {
        externalWorkspaceId: 'T1',
        externalUserId: 'U1',
        externalChannelId: 'D1',
        messageTs: '1788430496.123456',
        actionId: 'onboarding:start',
        value: 'start',
        actionTs: '1788430500.000100',
      },
    }]);
  });

  it('drops a click in a public channel', () => {
    assert.deepEqual(normalizeSlackEvent({ body: blockActions({ channel: { id: 'C1' } }), tenantId: 't' }), []);
  });

  it('drops a payload with two actions', () => {
    const two = [
      { action_id: 'onboarding:start', value: 'start', action_ts: '1.1' },
      { action_id: 'onboarding:later', value: 'later', action_ts: '1.2' },
    ];
    assert.deepEqual(normalizeSlackEvent({ body: blockActions({}, two), tenantId: 't' }), []);
  });

  it('drops a payload missing the user or message ts', () => {
    assert.deepEqual(normalizeSlackEvent({ body: blockActions({ user: undefined }), tenantId: 't' }), []);
    assert.deepEqual(normalizeSlackEvent({ body: blockActions({ container: {}, message: {} }), tenantId: 't' }), []);
  });
});
