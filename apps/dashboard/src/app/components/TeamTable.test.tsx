import * as React from 'react';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminManagerTeamEmployee, AdminManagerTeamQuestionSignal } from '@entalent/contracts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

import { EmployeeDetail } from './TeamTable';

const unansweredSignal: AdminManagerTeamQuestionSignal = {
  stableKey: 'engagement',
  title: 'Engagement',
  dimension: 'engagement',
  assessmentStatus: 'unknown',
  polarity: null,
  strength: null,
  confidence: null,
  evidenceSummary: null,
};

function employee(
  overrides: Partial<AdminManagerTeamEmployee> = {},
): AdminManagerTeamEmployee {
  return {
    userId: 'employee-1',
    displayName: 'Employee One',
    lastActiveAt: null,
    hasActiveRisk: false,
    surveyWindowId: 'window-current',
    scoredCount: 0,
    totalQuestions: 1,
    coveragePct: 0,
    signals: [unansweredSignal],
    previousWindow: null,
    ...overrides,
  };
}

function renderDetail(value: AdminManagerTeamEmployee): string {
  return renderToStaticMarkup(<EmployeeDetail employee={value} />);
}

describe('EmployeeDetail empty state', () => {
  it('acknowledges conversation activity separately from missing pulse insights', () => {
    const html = renderDetail(
      employee({
        lastActiveAt: '2026-09-18T10:00:00.000Z',
        signals: [{ ...unansweredSignal, assessmentStatus: 'scored' }],
      }),
    );

    assert.match(html, /Conversation activity recorded; no pulse insights yet\./);
    assert.match(html, /Not yet covered/);
    assert.doesNotMatch(html, /No pulse insights or recorded conversation activity\./);
    assert.doesNotMatch(html, /No insights in the current window\./);
    assert.doesNotMatch(html, /no conversations yet/);
  });

  it('uses a neutral label when no conversation activity is retained', () => {
    const html = renderDetail(employee());

    assert.match(html, /No pulse insights or recorded conversation activity\./);
    assert.doesNotMatch(html, /Conversation activity recorded; no pulse insights yet\./);
    assert.doesNotMatch(html, /No insights in the current window\./);
    assert.doesNotMatch(html, /no conversations yet/);
  });

  it('prioritizes the current-window label and keeps previous evidence separate', () => {
    const previousSignal = {
      ...unansweredSignal,
      assessmentStatus: 'scored',
      polarity: 'positive',
      strength: 0.8,
      evidenceSummary: 'Previous pulse evidence',
    };
    const html = renderDetail(
      employee({
        lastActiveAt: '2026-09-18T10:00:00.000Z',
        previousWindow: {
          surveyWindowId: 'window-previous',
          completedAt: '2026-09-17T10:00:00.000Z',
          scoredCount: 1,
          totalQuestions: 1,
          coveragePct: 100,
          signals: [previousSignal],
        },
      }),
    );

    assert.match(html, /No insights in the current window\./);
    assert.match(html, /Previous pulse evidence/);
    assert.doesNotMatch(html, /Conversation activity recorded; no pulse insights yet\./);
    assert.doesNotMatch(html, /No pulse insights or recorded conversation activity\./);
    assert.doesNotMatch(html, /no conversations yet/);
  });

  it('renders current evidence without any empty-state label', () => {
    const html = renderDetail(
      employee({
        signals: [
          {
            ...unansweredSignal,
            assessmentStatus: 'scored',
            polarity: 'positive',
            strength: 0.8,
            evidenceSummary: 'Current pulse evidence',
          },
        ],
      }),
    );

    assert.match(html, /Current pulse evidence/);
    assert.doesNotMatch(html, /Conversation activity recorded; no pulse insights yet\./);
    assert.doesNotMatch(html, /No pulse insights or recorded conversation activity\./);
    assert.doesNotMatch(html, /No insights in the current window\./);
  });
});
