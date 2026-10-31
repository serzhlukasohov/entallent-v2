import { describe, expect, it } from 'vitest';
import { appendBeforeExactForm } from './reporting-disclosure';

describe('acknowledgment composition around an approved exact form', () => {
  it('keeps the exact form last after ordinary text and acknowledgment', () => {
    expect(appendBeforeExactForm('Reply\n\nScore 1–10?', 'Acknowledged.', 'Score 1–10?'))
      .toBe('Reply\n\nAcknowledged.\n\nScore 1–10?');
  });

  it('keeps acknowledgment before a form-only response', () => {
    expect(appendBeforeExactForm('Score 1–10?', 'Acknowledged.', 'Score 1–10?'))
      .toBe('Acknowledged.\n\nScore 1–10?');
  });

  it('fails closed when a previously approved form is no longer the suffix', () => {
    expect(() => appendBeforeExactForm('Score 1–10?\nChanged', 'Acknowledged.', 'Score 1–10?'))
      .toThrow('engagement_probe_form_not_suffix');
  });

  it('retains ordinary trailing acknowledgments without an approved form', () => {
    expect(appendBeforeExactForm('Reply', 'Acknowledged.')).toBe('Reply\n\nAcknowledged.');
  });
});
