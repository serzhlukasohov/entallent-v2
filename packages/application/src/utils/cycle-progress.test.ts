import { describe, expect, it } from 'vitest';
import { predictCycleProgress, type CycleProgressSnapshot } from './cycle-progress';

function snapshot(groups: Record<string, string[]>): CycleProgressSnapshot {
  return {
    surveyWindowId: 'w-1',
    groups: Object.entries(groups).map(([questionGroup, statuses]) => ({
      questionGroup,
      questions: statuses.map((status, index) => ({ surveyQuestionId: `${questionGroup}-${index + 1}`, status })),
    })),
  };
}

describe('predictCycleProgress', () => {
  it('counts closed topics from the stored state when nothing changes this turn', () => {
    const progress = predictCycleProgress(snapshot({
      autonomy: ['confirmed', 'confirmed', 'declined'],
      growth: ['collecting', 'no_data', 'no_data'],
      purpose: ['no_data', 'no_data', 'no_data'],
      belonging: ['pending_confirmation', 'pending_confirmation', 'confirmed'],
    }));
    expect(progress).toEqual({
      inCycle: true,
      topicsTotal: 4,
      topicsClosed: 1,
      openTopics: ['growth', 'purpose', 'belonging'],
      closedNow: null,
      awaitingReply: true,
    });
  });

  it('closes the topic on an agree verdict over the whole bundle', () => {
    const progress = predictCycleProgress(snapshot({
      autonomy: ['pending_confirmation', 'pending_confirmation', 'pending_confirmation'],
      growth: ['no_data', 'no_data', 'no_data'],
      purpose: ['no_data', 'no_data', 'no_data'],
      belonging: ['no_data', 'no_data', 'no_data'],
    }), {
      questionGroup: 'autonomy',
      componentQuestionIds: ['autonomy-1', 'autonomy-2', 'autonomy-3'],
      verdict: { kind: 'agree' },
    });
    expect(progress.closedNow).toBe('autonomy');
    expect(progress.topicsClosed).toBe(1);
    expect(progress.openTopics).toEqual(['growth', 'purpose', 'belonging']);
    expect(progress.awaitingReply).toBe(false);
  });

  it('closes the topic on a partial verdict that accepts and declines but disputes nothing', () => {
    const progress = predictCycleProgress(snapshot({
      autonomy: ['pending_confirmation', 'pending_confirmation', 'confirmed'],
      growth: ['no_data', 'no_data', 'no_data'],
      purpose: ['no_data', 'no_data', 'no_data'],
      belonging: ['no_data', 'no_data', 'no_data'],
    }), {
      questionGroup: 'autonomy',
      componentQuestionIds: ['autonomy-1', 'autonomy-2'],
      verdict: { kind: 'partial', acceptedQuestionIds: ['autonomy-1'], disputedQuestionIds: [], declinedQuestionIds: ['autonomy-2'] },
    });
    expect(progress.closedNow).toBe('autonomy');
    expect(progress.topicsClosed).toBe(1);
  });

  it('keeps the topic open while a statement is disputed', () => {
    const progress = predictCycleProgress(snapshot({
      autonomy: ['pending_confirmation', 'pending_confirmation', 'confirmed'],
      growth: ['no_data', 'no_data', 'no_data'],
      purpose: ['no_data', 'no_data', 'no_data'],
      belonging: ['no_data', 'no_data', 'no_data'],
    }), {
      questionGroup: 'autonomy',
      componentQuestionIds: ['autonomy-1', 'autonomy-2'],
      verdict: { kind: 'partial', acceptedQuestionIds: ['autonomy-1'], disputedQuestionIds: ['autonomy-2'], declinedQuestionIds: [] },
    });
    expect(progress.closedNow).toBeNull();
    expect(progress.topicsClosed).toBe(0);
    expect(progress.awaitingReply).toBe(true);
  });

  it('closes the topic when the corrected statement is the last open one', () => {
    const progress = predictCycleProgress(snapshot({
      autonomy: ['confirmed', 'pending_confirmation', 'confirmed'],
      growth: ['no_data', 'no_data', 'no_data'],
      purpose: ['no_data', 'no_data', 'no_data'],
      belonging: ['no_data', 'no_data', 'no_data'],
    }), {
      questionGroup: 'autonomy',
      componentQuestionIds: ['autonomy-2'],
      verdict: { kind: 'agree' },
    });
    expect(progress.closedNow).toBe('autonomy');
  });

  it('does not close on reject, and reports an already closed topic as not newly closed', () => {
    const rejected = predictCycleProgress(snapshot({
      autonomy: ['pending_confirmation', 'pending_confirmation', 'pending_confirmation'],
    }), {
      questionGroup: 'autonomy',
      componentQuestionIds: ['autonomy-1', 'autonomy-2', 'autonomy-3'],
      verdict: { kind: 'reject' },
    });
    expect(rejected.closedNow).toBeNull();
    expect(rejected.topicsClosed).toBe(0);

    const already = predictCycleProgress(snapshot({
      autonomy: ['confirmed', 'confirmed', 'confirmed'],
    }), {
      questionGroup: 'autonomy',
      componentQuestionIds: ['autonomy-1'],
      verdict: { kind: 'agree' },
    });
    expect(already.closedNow).toBeNull();
    expect(already.topicsClosed).toBe(1);
  });

  it('reports no cycle when there is no snapshot', () => {
    expect(predictCycleProgress(null)).toEqual({
      inCycle: false, topicsTotal: 0, topicsClosed: 0, openTopics: [], closedNow: null, awaitingReply: false,
    });
  });
});
