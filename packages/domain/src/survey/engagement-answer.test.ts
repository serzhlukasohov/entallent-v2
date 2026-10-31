import { describe, expect, it } from 'vitest';
import { parseLiteralEngagementAnswer } from './engagement-answer';

describe('literal engagement answer', () => {
  it.each([['1', 1], ['7', 7], ['10', 10], ['8/10', 8], ['  8 / 10. ', 8]])('accepts %s', (text, value) => {
    expect(parseLiteralEngagementAnswer(text)).toBe(value);
  });
  it.each(['0', '-1', '11', '7.5', '10.5/10', '7 meetings', 'not 7', '7 or 8', 'I feel great', '8/9', '07', '7, 8'])('rejects %s', (text) => {
    expect(parseLiteralEngagementAnswer(text)).toBeNull();
  });
});
