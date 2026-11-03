/** Compact, bounded rendering of call arguments: long text is shortened and bare ids are dropped. */
export function summarizeArgs(args: readonly unknown[]): string {
  const visible = args.filter((arg) => arg !== undefined);
  // Bare ids (conversation, tenant, message) say nothing a reader needs.
  const shown = visible.filter((arg) => typeof arg !== 'string' || !BARE_ID.test(arg));
  return clip(shown.map((arg) => summarizeValue(arg, 0)).filter((text) => text !== '{}').join(', '), 240);
}

export function summarizeValue(value: unknown, depth: number): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return quote(value, depth === 0 ? 160 : 80);
  if (typeof value !== 'object') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= 2) return `[${value.length} items]`;
    const shown = value.slice(0, 4).map((item) => summarizeValue(item, depth + 1));
    return `[${shown.join(', ')}${value.length > 4 ? `, +${value.length - 4} more` : ''}]`;
  }
  if (depth >= 2) return `{${Object.keys(value).join(', ')}}`;
  const entries = Object.entries(value).filter(([key, entry]) => entry !== undefined && !OMITTED_KEYS.has(key));
  return `{${entries.map(([key, entry]) => `${key}: ${
    KEYS_ONLY.has(key) && entry && typeof entry === 'object' ? `{${Object.keys(entry).join(', ')}}` : summarizeValue(entry, depth + 1)
  }`).join(', ')}}`;
}

/** Identity fields shared by every call of a turn; they add length without telling anything. */
const OMITTED_KEYS = new Set([
  'id', 'tenantId', 'userId', 'conversationId', 'externalWorkspaceId', 'externalConversationId', 'externalChannelId',
  'channelType', 'traceId', 'messageId', 'inboundMessageId', 'outboundMessageId', 'sourceInboundMessageId',
]);
/** Large nested payloads whose field names are enough to see what was written. */
const KEYS_ONLY = new Set(['metadata']);
/** Simulation ids (`sim-...`) and UUIDs. */
const BARE_ID = /^(sim-|[0-9a-f]{8}-[0-9a-f]{4}-)/;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function quote(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return JSON.stringify(flat.length > max ? `${flat.slice(0, max)}...` : flat);
}
