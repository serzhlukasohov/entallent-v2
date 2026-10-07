import { describe, expect, it } from 'vitest';
import { OnboardingQueueJobSchema } from './onboarding';

const button = { tenantId: 't', personId: 'p', action: 'start', actionTs: '1.1', messageTs: '1.1', channelId: 'D1' };

describe('OnboardingQueueJobSchema', () => {
  it('treats a job without kind as a button job', () => {
    expect(OnboardingQueueJobSchema.parse(button)).toMatchObject({ kind: 'button', action: 'start' });
  });
  it('parses explicit button and system jobs', () => {
    expect(OnboardingQueueJobSchema.parse({ ...button, kind: 'button' }).kind).toBe('button');
    expect(OnboardingQueueJobSchema.parse({
      kind: 'system', tenantId: 't', personId: 'p', event: { type: 'role_changed', from: 'manager', to: 'employee' },
    })).toMatchObject({ kind: 'system', event: { to: 'employee' } });
    expect(OnboardingQueueJobSchema.parse({
      kind: 'system', tenantId: 't', personId: 'p', event: { type: 'deactivated' },
    }).kind).toBe('system');
  });
  it('rejects unknown roles and event types', () => {
    expect(() => OnboardingQueueJobSchema.parse({
      kind: 'system', tenantId: 't', personId: 'p', event: { type: 'role_changed', from: 'x', to: 'employee' },
    })).toThrow();
    expect(() => OnboardingQueueJobSchema.parse({
      kind: 'system', tenantId: 't', personId: 'p', event: { type: 'nope' },
    })).toThrow();
  });
});
