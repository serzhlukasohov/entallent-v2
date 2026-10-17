import { describe, expect, it } from 'vitest';
import { findReaskedQuestions, findUnstatedEmotionWords } from './fidelity-checks';

const BLOCKER_ANSWERED = [
  {
    detail: 'the blocker is the security sign-off',
    pattern: /\b(?:where|what|which|who)\b[^?]*\b(?:block|stuck|hold(?:ing|s)? (?:it |things )?up|bottleneck)/i,
  },
  {
    detail: 'the reviewer manager and the security channel were already pinged',
    pattern: /\b(?:have|did|had)\s+you\b[^?]*\b(?:ping|reach|contact|talk|spoke|speak|escalat|ask|flag|rais)/i,
  },
];

describe('findReaskedQuestions', () => {
  it('flags a question that asks for an answered detail in other words', () => {
    const replies = [
      'Sounds like a week of waiting on one signature. Where do you think the release is actually stuck right now?',
      'Understood. Have you tried reaching out to the security team lead about a backup reviewer?',
    ];
    expect(findReaskedQuestions(replies, BLOCKER_ANSWERED)).toEqual([
      {
        turn: 1,
        question: 'Where do you think the release is actually stuck right now?',
        detail: 'the blocker is the security sign-off',
      },
      {
        turn: 2,
        question: 'Have you tried reaching out to the security team lead about a backup reviewer?',
        detail: 'the reviewer manager and the security channel were already pinged',
      },
    ]);
  });

  it('ignores statements that mention the detail and questions about something new', () => {
    const replies = [
      'The blocker being a single reviewer who is out is a process gap, not something you missed. Who on the security side could grant a one-off exception?',
      'You have already pinged the manager twice and the channel, so the ask is in. What does the team need to hear from you this week?',
    ];
    expect(findReaskedQuestions(replies, BLOCKER_ANSWERED)).toEqual([]);
  });

  it('does not flag a question about who could change the stated rule', () => {
    const answered = [
      {
        detail: 'nobody else is allowed to sign off',
        pattern: /\b(?:is there|are there|any(?:one|body)? else|no ?one else|nobody else)\b[^?]*\b(?:sign[- ]?off|approv|review|path|cover|step in|touch)/i,
      },
    ];
    expect(
      findReaskedQuestions(
        [
          'Who owns the decision to name a backup reviewer when the only authorized person is out?',
          'Who owns the decision to let someone else cover that sign-off when the reviewer is out?',
        ],
        answered,
      ),
    ).toEqual([]);
    expect(
      findReaskedQuestions(
        ['Is the real snag the missing reviewer, or the rule that nobody else can step in?'],
        answered,
      ),
    ).toHaveLength(1);
  });

  it('restricts the check to later turns when asked', () => {
    const replies = ['Where is it stuck?', 'What would unblock it?'];
    expect(findReaskedQuestions(replies, BLOCKER_ANSWERED, { fromTurn: 2 })).toEqual([]);
    expect(findReaskedQuestions(replies, BLOCKER_ANSWERED)).toHaveLength(1);
  });
});

describe('findUnstatedEmotionWords', () => {
  const employeeTurns = [
    'Quick update: my proposal for the new on-call rotation was rejected in the planning meeting today. The team is keeping the current rotation for another quarter.',
  ];

  it('flags emotional weight the employee did not state', () => {
    const replies = [
      'That sounds particularly unfair after the work you put in, and it must be frustrating to see it rejected.',
      'Rejected proposals are a normal part of planning. The prep is still yours to reuse.',
    ];
    expect(findUnstatedEmotionWords(replies, employeeTurns)).toEqual([
      { turn: 1, word: 'unfair' },
      { turn: 1, word: 'frustrating' },
    ]);
  });

  it('allows words the employee used themselves', () => {
    const replies = ['Frustrating is a fair word for a week of prep being set aside.'];
    expect(
      findUnstatedEmotionWords(replies, [
        'My proposal was rejected in planning, which is frustrating because the prep took a week.',
      ]),
    ).toEqual([]);
  });

  it('flags asserted feelings phrased as "must be" or "that is hard"', () => {
    const replies = ['That is hard to hear after a week of prep. What do you want to do with the analysis?'];
    expect(findUnstatedEmotionWords(replies, employeeTurns)).toEqual([{ turn: 1, word: 'That is hard' }]);
  });

  it('does not flag neutral uses of generic words', () => {
    const replies = [
      'There is a hard deadline for the next planning round, so the doc could be hard to finish this week; which section matters most?',
    ];
    expect(findUnstatedEmotionWords(replies, employeeTurns)).toEqual([]);
  });
});
