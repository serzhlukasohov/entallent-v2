import { describe, expect, it } from 'vitest';
import { toConversationActiveTopic } from './conversation.repository';

describe('toConversationActiveTopic', () => {
  it('accepts the owned JSON shape and rejects invalid or unbounded state', () => {
    expect(toConversationActiveTopic({
      summary: 'Ship Atlas',
      status: 'parked',
      startedAt: '2026-08-01T10:00:00.000Z',
    })).toEqual({
      summary: 'Ship Atlas',
      status: 'parked',
      startedAt: '2026-08-01T10:00:00.000Z',
    });
    expect(toConversationActiveTopic({
      summary: '😀'.repeat(500),
      status: 'active',
      startedAt: '2026-08-01T10:00:00.000Z',
    })?.summary).toBe('😀'.repeat(500));

    for (const invalid of [
      null,
      { summary: '', status: 'active', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: 'x'.repeat(501), status: 'active', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: '😀'.repeat(501), status: 'active', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: 'Ship Atlas', status: 'closed', startedAt: '2026-08-01T10:00:00.000Z' },
      { summary: 'Ship Atlas', status: 'active', startedAt: '2026-08-01' },
    ]) {
      expect(toConversationActiveTopic(invalid)).toBeUndefined();
    }
  });
});
