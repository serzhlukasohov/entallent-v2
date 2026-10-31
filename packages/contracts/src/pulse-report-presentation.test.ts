import { describe, it, expect } from 'vitest';
import {
  BuildPulseReportRequestSchema,
  PulseLabelsSchema,
  PulseNarrativeSchema,
  PulseSemanticReviewSchema,
  PULSE_ENGLISH_LABELS,
  PulseReportPresentationSchema,
} from './pulse-report-presentation';
describe('RPT06 strict presentation contracts', () => {
  it('request requires explicit audience and exactly the phase-appropriate approved Index', () => {
    const request = {
      tenantId: 't',
      cycleId: 'c',
      overallScopeId: 's',
      audience: 'manager',
      purpose: 'intermediate',
      indexKey: 'autonomy',
    };
    expect(BuildPulseReportRequestSchema.safeParse(request).success).toBe(true);
    for (const value of [
      { ...request, audience: undefined },
      { ...request, indexKey: 'engagement' },
      { ...request, purpose: 'final' },
      { ...request, frontier: 'yesterday' },
    ])
      expect(BuildPulseReportRequestSchema.safeParse(value).success).toBe(false);
  });
  it('all atomic label slots are required and unknown placeholders/numeric or control claims reject', () => {
    expect(PulseLabelsSchema.safeParse(PULSE_ENGLISH_LABELS).success).toBe(true);
    for (const value of [
      { ...PULSE_ENGLISH_LABELS, part: 'Part {ordinal}' },
      { ...PULSE_ENGLISH_LABELS, extra: 'hidden' },
      { ...PULSE_ENGLISH_LABELS, part: 'Part １' },
      { ...PULSE_ENGLISH_LABELS, part: 'Part\u202e' },
    ])
      expect(PulseLabelsSchema.safeParse(value).success).toBe(false);
  });
  it('narrative leaves reject added identifiers, Unicode numbers, illformed surrogates and number-bearing prose', () => {
    const draft = {
      explanation: [{ text: 'Mixed experience.', references: ['eA'] }],
      focus: { kind: 'none_supported' },
      actions: [],
    };
    expect(PulseNarrativeSchema.safeParse(draft).success).toBe(true);
    for (const value of [
      { ...draft, subjectId: 'private' },
      { ...draft, explanation: [{ text: 'Score ٥', references: ['eA'] }] },
      { ...draft, explanation: [{ text: 'Bad\udfff', references: ['eA'] }] },
      { ...draft, explanation: [{ text: 'Claim', references: ['private-id'] }] },
    ])
      expect(PulseNarrativeSchema.safeParse(value).success).toBe(false);
  });
  it('semantic pass is explicit, strict, and cannot contain an unhandled violation', () => {
    for (const value of [
      { verdict: 'pass', violations: ['identity'] },
      { passed: true },
      { verdict: 'pass', violations: [], extra: 'hidden' },
      null,
    ])
      expect(PulseSemanticReviewSchema.safeParse(value).success).toBe(false);
    expect(PulseSemanticReviewSchema.safeParse({ verdict: 'pass', violations: [] }).success).toBe(
      true,
    );
  });
  it('public nested sections cannot sneak in computation/source metadata', () => {
    const p = {
      contract: 'pulse-presentation-v1',
      locale: 'en',
      period: 'October 2026',
      labels: PULSE_ENGLISH_LABELS,
      labelVersion: 'pulse-labels-v1',
      labelHash: 'a'.repeat(64),
      variant: 'team_lead_final',
      purpose: 'final',
      audience: 'team_lead',
      sections: [{ sectionKey: 'sA', label: 'Team', status: 'insufficient_data' }],
    };
    expect(PulseReportPresentationSchema.safeParse(p).success).toBe(true);
    expect(
      PulseReportPresentationSchema.safeParse({
        ...p,
        sections: [{ ...p.sections[0], completeCount: 4 }],
      }).success,
    ).toBe(false);
    expect(
      PulseReportPresentationSchema.safeParse({
        ...p,
        sections: [{ ...p.sections[0], sourceIds: ['private'] }],
      }).success,
    ).toBe(false);
  });
});

it('RPT06 prose validators reject boundary control injection without trimming generated output', () => {
  const draft = {
    explanation: [{ text: '\nSafe words', references: ['eA'] }],
    focus: { kind: 'none_supported' },
    actions: [],
  };
  expect(PulseNarrativeSchema.safeParse(draft).success).toBe(false);
  expect(
    PulseSemanticReviewSchema.safeParse({
      verdict: 'fail',
      violations: ['unbounded arbitrary prose'],
    }).success,
  ).toBe(false);
});

it('RPT06 artifact identity inventory rejects duplicate sections and duplicate or foreign-owned actions', () => {
  const section = {
    sectionKey: 'sA',
    label: 'Team',
    status: 'eligible',
    metric: { kind: 'engagement', value: '7.1', direction: 'stable', compositionChanged: false },
    narrative: {
      explanation: ['Ownership is unclear.'],
      focus: { kind: 'none_supported' },
      actions: [
        { actionKey: 'sAaA', title: 'Clarify ownership', detail: 'Review decision ownership.' },
      ],
    },
  };
  const base = {
    contract: 'pulse-presentation-v1',
    locale: 'en',
    period: 'October 2026',
    labels: PULSE_ENGLISH_LABELS,
    labelVersion: 'pulse-labels-v1',
    labelHash: 'a'.repeat(64),
    variant: 'manager_final',
    purpose: 'final',
    audience: 'manager',
    sections: [section],
  };
  expect(PulseReportPresentationSchema.safeParse(base).success).toBe(true);
  expect(
    PulseReportPresentationSchema.safeParse({
      ...base,
      sections: [section, { sectionKey: 'sA', label: 'Same name', status: 'insufficient_data' }],
    }).success,
  ).toBe(false);
  expect(
    PulseReportPresentationSchema.safeParse({
      ...base,
      sections: [
        {
          ...section,
          narrative: {
            ...section.narrative,
            actions: [
              ...section.narrative.actions,
              { ...section.narrative.actions[0], title: 'Review responsibilities' },
            ],
          },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    PulseReportPresentationSchema.safeParse({
      ...base,
      sections: [
        {
          ...section,
          narrative: {
            ...section.narrative,
            actions: [{ ...section.narrative.actions[0], actionKey: 'sBaA' }],
          },
        },
      ],
    }).success,
  ).toBe(false);
});
