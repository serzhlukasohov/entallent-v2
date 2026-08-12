import { describe, expect, it } from 'vitest';
import { ALL_QUEUE_NAMES, QUEUE_NAMES } from './queue';

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
});
