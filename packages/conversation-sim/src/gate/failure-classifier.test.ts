import { describe, expect, it } from 'vitest';
import { classifyFailure } from './failure-classifier';

describe('classifyFailure', () => {
  it('keeps a report-backed timeout assertion as a product failure', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'AssertionError: expected timeout guidance to be absent',
        reportCount: 1,
      }),
    ).toBe('product');
  });

  it('keeps an assertion without a report as a product failure', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'AssertionError: network wording was repeated',
        reportCount: 0,
      }),
    ).toBe('product');
  });

  it('retries only a report-free transport failure', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'TypeError: fetch failed caused by ECONNRESET',
        reportCount: 0,
      }),
    ).toBe('infrastructure');
  });

  it('does not treat incidental network and 5xx wording as transport evidence', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'Error: expected network policy to reject 500 characters',
        reportCount: 0,
      }),
    ).toBe('product');
  });

  it('requires a report even when the subprocess exits successfully', () => {
    expect(classifyFailure({ exitCode: 0, output: '', reportCount: 1 })).toBe('none');
    expect(classifyFailure({ exitCode: 0, output: '', reportCount: 0 })).toBe('product');
  });
});
