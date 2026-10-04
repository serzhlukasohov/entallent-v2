import { describe, expect, it } from 'vitest';
import { normalizeOnboardingAction } from './slack-onboarding-action';
const payload = { type: 'block_actions', team: { id: 'T1' }, user: { id: 'U1' }, channel: { id: 'D1' },
  message: { ts: '1720000000.123456' }, actions: [{ action_id: 'onboarding:start', action_ts: '1720000001.123456' }] };
describe('Slack onboarding action normalization', () => {
  it('uses the verified acting user and original message timestamp', () => {
    const normalized = normalizeOnboardingAction(payload)!;
    expect(normalized.action).toBe('start');
    expect(normalized.parentMessageTs).toBe(payload.message.ts);
    expect(normalized.body.event).toMatchObject({ user: 'U1', channel: 'D1' });
    expect(normalizeOnboardingAction(payload)).toEqual(normalized);
  });
  it('rejects public channels, unsupported actions, and malformed actors', () => {
    expect(normalizeOnboardingAction({ ...payload, channel: { id: 'C1' } })).toBeNull();
    expect(normalizeOnboardingAction({ ...payload, user: {} })).toBeNull();
    expect(normalizeOnboardingAction({ ...payload, actions: [{ action_id: 'onboarding:view_sample' }] })).toBeNull();
    expect(normalizeOnboardingAction({ ...payload, actions: [] })).toBeNull();
  });
});
