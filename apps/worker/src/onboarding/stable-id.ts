import { createHash } from 'node:crypto';

/** Deterministic RFC4122-shaped (v5-style) UUID derived from the given parts. */
export function stableId(...parts: string[]): string {
  const b = createHash('sha256').update(parts.join('\u0000')).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
