import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectJudgeVerdict } from './judge-verdict';

function judgeMiss() {
  return { success: false, metCriteria: [], unmetCriteria: ['criterion'], reasoning: 'missed criterion' };
}

describe('expectJudgeVerdict', () => {
  const originalRunId = process.env.SIM_GATE_RUN_ID;

  afterEach(() => {
    if (originalRunId === undefined) delete process.env.SIM_GATE_RUN_ID;
    else process.env.SIM_GATE_RUN_ID = originalRunId;
    vi.restoreAllMocks();
  });

  it('fails a standalone run when the judge misses', () => {
    delete process.env.SIM_GATE_RUN_ID;

    expect(() => expectJudgeVerdict(judgeMiss(), 'demo')).toThrow(
      'missed criterion',
    );
  });

  it('leaves a gate sample green on a judge miss so the gate pass rate decides', () => {
    process.env.SIM_GATE_RUN_ID = 'demo-1-attempt-1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => expectJudgeVerdict(judgeMiss(), 'demo')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missed criterion'));
  });

  it('treats an empty SIM_GATE_RUN_ID as a standalone run', () => {
    process.env.SIM_GATE_RUN_ID = '';

    expect(() => expectJudgeVerdict(judgeMiss(), 'demo')).toThrow('missed criterion');
  });

  it('still fails a gate sample whose scenario ended without a judge verdict', () => {
    process.env.SIM_GATE_RUN_ID = 'demo-1-attempt-1';

    expect(() =>
      expectJudgeVerdict({ success: false, metCriteria: [], unmetCriteria: [], reasoning: 'Reached max turns' }, 'demo'),
    ).toThrow('Reached max turns');
  });

  it('passes silently when the judge passes', () => {
    process.env.SIM_GATE_RUN_ID = 'demo-1-attempt-1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expectJudgeVerdict({ success: true, metCriteria: ['ok'], unmetCriteria: [] }, 'demo');
    delete process.env.SIM_GATE_RUN_ID;
    expectJudgeVerdict({ success: true, metCriteria: ['ok'], unmetCriteria: [] }, 'demo');

    expect(warn).not.toHaveBeenCalled();
  });
});
