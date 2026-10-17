import { createHash } from 'node:crypto';

const URL_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
const OUTBOUND_ID_NAME = 'entalent:conversation-outbound:v1:';

/** Stable UUID for the response to one persisted inbound message. */
export function conversationOutboundMessageId(inboundMessageId: string): string {
  const bytes = createHash('sha1').update(URL_NAMESPACE).update(OUTBOUND_ID_NAME)
    .update(inboundMessageId).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
