import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../types/records';
import { isContentFilterOutcome, modelMessagesAfterContentFilter, modelMessagesForInbound } from './content-filter-recovery';

function message(id: string, direction: 'inbound' | 'outbound', metadata?: Record<string, unknown>): MessageRecord {
  return {
    id, conversationId: 'c', tenantId: 't', userId: 'u', direction,
    text: id, occurredAt: new Date(), createdAt: new Date(), metadata,
  };
}

describe('content filter context projection', () => {
  const outcome = message('recovery', 'outbound', {
    conversationOutcome: 'input_filtered', sourceInboundMessageId: 'blocked',
  });

  it('keeps the explanation and new inbound while leaving durable history intact', () => {
    const history = [message('older', 'inbound'), message('blocked', 'inbound'), outcome, message('new', 'inbound')];
    expect(modelMessagesAfterContentFilter(history).map((entry) => entry.id)).toEqual(['recovery', 'new']);
    expect(history.map((entry) => entry.id)).toEqual(['older', 'blocked', 'recovery', 'new']);
    expect(modelMessagesForInbound(history, 3)).toEqual({ messages: [outcome, history[3]], boundaryApplied: true });
  });

  it('recognizes only a persisted outbound with a source', () => {
    expect(isContentFilterOutcome(message('fake', 'inbound', outcome.metadata))).toBe(false);
    expect(isContentFilterOutcome(message('incomplete', 'outbound', { conversationOutcome: 'input_filtered' }))).toBe(false);
    expect(modelMessagesAfterContentFilter([message('normal', 'inbound')])).toHaveLength(1);
  });

  it('uses causal order when recovery is persisted after a newer inbound', () => {
    const history = [message('blocked', 'inbound'), message('new', 'inbound'), outcome];
    expect(modelMessagesForInbound(history, 1)).toEqual({ messages: [outcome, history[1]], boundaryApplied: true });
  });

  it('uses a recovery record when its rejected source was outside the loaded history', () => {
    const history = [outcome, message('new', 'inbound')];
    expect(modelMessagesForInbound(history, 1)).toEqual({ messages: history, boundaryApplied: true });
  });
});
