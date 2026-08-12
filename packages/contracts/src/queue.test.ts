import { describe, expect, expectTypeOf, it } from 'vitest';
import { ALL_QUEUE_NAMES, QUEUE_NAMES, type AdminQueuesResponse, type QueueName } from './queue';

describe('queue contract', () => {
  it('keeps the canonical queue string values stable', () => {
    expect(QUEUE_NAMES).toEqual({
      CONVERSATION: 'conversation',
      MEMORY_EXTRACTION: 'memory-extraction',
      SURVEY_EVIDENCE: 'survey-evidence',
      RISK_ANALYSIS: 'risk-analysis',
      FOLLOWUP_PLANNING: 'followup-planning',
      FOLLOWUP_EXECUTION: 'followup-execution',
      MESSAGE_SEND: 'message-send',
      PROACTIVE_SCAN: 'proactive-scan',
      GROUP_REPORT: 'group-report',
      STYLE_ANALYSIS: 'style-analysis',
      PROFILE_HYDRATION: 'profile-hydration',
    });
  });

  it('lists every known queue for operational tooling', () => {
    expect(ALL_QUEUE_NAMES).toEqual([
      'conversation',
      'memory-extraction',
      'survey-evidence',
      'risk-analysis',
      'followup-planning',
      'followup-execution',
      'message-send',
      'proactive-scan',
      'group-report',
      'style-analysis',
      'profile-hydration',
    ]);
  });

  it('types admin queue stats with canonical queue names', () => {
    const response = {
      queues: [{ name: QUEUE_NAMES.MESSAGE_SEND, counts: { completed: 12, failed: 0 } }],
      timestamp: '2026-08-12T00:00:00.000Z',
    } satisfies AdminQueuesResponse;

    expect(response.queues[0]?.name).toBe('message-send');
    expect(response.queues[0]?.counts.completed).toBe(12);
    expectTypeOf(response).toMatchTypeOf<AdminQueuesResponse>();
    expectTypeOf<AdminQueuesResponse['queues'][number]['name']>().toEqualTypeOf<QueueName>();
  });
});
