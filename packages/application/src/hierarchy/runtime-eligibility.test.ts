import { describe, expect, it } from 'vitest';
import { isRuntimeEligibleUser } from './runtime-eligibility';

describe('isRuntimeEligibleUser', () => {
  const active = { userStatus: 'active', deletedAt: null, personLifecycle: 'active', pulseParticipant: true };

  it('allows active participating Persons and active legacy users', () => {
    expect(isRuntimeEligibleUser(active)).toBe(true);
    expect(isRuntimeEligibleUser({ ...active, personLifecycle: null, pulseParticipant: null })).toBe(true);
  });

  it('excludes draft, inactive, non-participant and deleted identities', () => {
    expect(isRuntimeEligibleUser({ ...active, personLifecycle: 'draft' })).toBe(false);
    expect(isRuntimeEligibleUser({ ...active, personLifecycle: 'inactive' })).toBe(false);
    expect(isRuntimeEligibleUser({ ...active, pulseParticipant: false })).toBe(false);
    expect(isRuntimeEligibleUser({ ...active, userStatus: 'inactive' })).toBe(false);
    expect(isRuntimeEligibleUser({ ...active, deletedAt: new Date() })).toBe(false);
  });
});
