import { describe, expect, it } from 'vitest';
import {
  normalizeProfileDisplayName,
  resolveExternalProfileFacts,
  resolveUsableExternalDisplayName,
} from './profile-facts-policy';

describe('profile facts policy', () => {
  it('normalizes blank display names to null', () => {
    expect(normalizeProfileDisplayName(' Alice ')).toBe('Alice');
    expect(normalizeProfileDisplayName('   ')).toBeNull();
    expect(normalizeProfileDisplayName(null)).toBeNull();
  });

  it('rejects external display names that are only the external user id', () => {
    expect(resolveUsableExternalDisplayName(' U123 ', 'U123')).toBeNull();
    expect(resolveUsableExternalDisplayName(' u123 ', 'U123')).toBeNull();
    expect(resolveUsableExternalDisplayName('Slack Alice', 'U123')).toBe('Slack Alice');
  });

  it('preserves an existing preferred name while allowing channel display updates', () => {
    expect(
      resolveExternalProfileFacts(
        { externalUserId: 'U123', displayName: 'Slack Alice', timezone: ' Europe/Berlin ' },
        { preferredName: 'Alice' },
      ),
    ).toEqual({
      displayName: 'Slack Alice',
      timezone: 'Europe/Berlin',
    });
  });

  it('populates preferred name when no user-owned name exists', () => {
    expect(
      resolveExternalProfileFacts(
        { externalUserId: 'U123', displayName: 'Slack Alice' },
        { preferredName: '   ' },
      ),
    ).toEqual({
      displayName: 'Slack Alice',
      preferredName: 'Slack Alice',
    });
  });

  it('skips display-name writes for unusable external names', () => {
    expect(
      resolveExternalProfileFacts(
        { externalUserId: 'U123', displayName: ' U123 ', timezone: 'UTC' },
        { preferredName: null },
      ),
    ).toEqual({
      timezone: 'UTC',
    });
  });
});
