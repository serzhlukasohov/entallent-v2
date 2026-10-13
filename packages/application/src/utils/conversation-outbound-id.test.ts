import { describe, expect, it } from 'vitest';
import { conversationOutboundMessageId } from './conversation-outbound-id';

describe('conversationOutboundMessageId', () => {
  it('derives one stable UUID per inbound message', () => {
    const source = '11111111-1111-4111-8111-111111111111';
    const outbound = conversationOutboundMessageId(source);
    expect(outbound).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(outbound).toBe(conversationOutboundMessageId(source));
    expect(outbound).not.toBe(source);
    expect(outbound).not.toBe(conversationOutboundMessageId('22222222-2222-4222-8222-222222222222'));
  });
});
