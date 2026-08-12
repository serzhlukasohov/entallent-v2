import { describe, expect, it } from 'vitest';
import { attachTeamDisplayNames, normalizeDisplayName } from './team-users';

describe('team user display names', () => {
  it('normalizes blank names to null', () => {
    expect(normalizeDisplayName(' Alice ')).toBe('Alice');
    expect(normalizeDisplayName('   ')).toBeNull();
    expect(normalizeDisplayName(null)).toBeNull();
  });

  it('prefers users.preferredName over channel account displayName', () => {
    const rows = attachTeamDisplayNames(
      [{ id: 'u1', preferredName: 'Alice' }],
      [{ userId: 'u1', displayName: 'Slack Alice' }],
    );

    expect(rows).toEqual([{ id: 'u1', displayName: 'Alice' }]);
  });

  it('falls back to channel account displayName when preferredName is missing', () => {
    const rows = attachTeamDisplayNames(
      [
        { id: 'u1', preferredName: null },
        { id: 'u2', preferredName: '   ' },
      ],
      [
        { userId: 'u1', displayName: 'Slack Alice' },
        { userId: 'u2', displayName: 'Slack Bob' },
      ],
    );

    expect(rows).toEqual([
      { id: 'u1', displayName: 'Slack Alice' },
      { id: 'u2', displayName: 'Slack Bob' },
    ]);
  });
});
