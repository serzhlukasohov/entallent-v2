/**
 * Source manifest for suite p-v1: Confluence page 189333505 "Product & Business Logic — Test
 * Suite v1", version 3 (Framework v2.1.1 P-suite). `C<n>` criteria number the case's table rows
 * top to bottom; pass conditions and NOT TESTABLE reasons are the v3 text verbatim, except
 * P-06.C3, which checks 08:00-20:00 (Illia, 2026-10-26; the only allowed deviation).
 * `E<n>` criteria are the engineering effects approved by Illia on 2026-10-27
 * (`_bmad-output/specs/spec-conversation-eval-regression/p-v1-effects-draft.md`): rule-only,
 * never from Confluence. The draft numbers effects per test; here they are numbered per source
 * case (see `case-mapping.md` section 5).
 */
export const sources: unknown[] = [
  {
    id: 'P-01',
    requirement: ['CF-004'],
    kind: 'conversation',
    expectedBehavior:
      'The bot responds to an employee-initiated message and engages with the user\'s topic without needing a prior proactive message.',
    criteria: [
      { id: 'P-01.C1', layer: 'P', passCondition: 'Responds to the user\'s topic, not with a generic or unrelated message' },
      { id: 'P-01.C2', layer: 'P', passCondition: 'Does not require a prior proactive message or setup step to start' },
      { id: 'P-01.E1', layer: 'E', passCondition: 'exactly one reply is sent' },
      { id: 'P-01.E2', layer: 'E', passCondition: 'no survey summary is staged' },
      // Decision and context checks (approved by Illia, 2026-10-27).
      { id: 'P-01.E3', layer: 'E', passCondition: 'an ordinary work request is not a risk turn' },
      { id: 'P-01.E4', layer: 'E', passCondition: 'only the user\'s message reaches the model, nothing remembered, a new session' },
    ],
  },
  {
    id: 'P-02',
    requirement: ['CF-004', 'CF-003'],
    kind: 'conversation',
    expectedBehavior:
      'Working-hours limits apply only to proactive conversations; an employee-initiated message is answered at any time.',
    criteria: [
      { id: 'P-02.C1', layer: 'P', passCondition: 'Engages with the request' },
      { id: 'P-02.C2', layer: 'P', passCondition: 'Does not refuse or postpone because it is outside working hours' },
      { id: 'P-02.E1', layer: 'E', passCondition: 'the night message is answered: one reply sent' },
      { id: 'P-02.E2', layer: 'E', passCondition: 'a late-night request is not a risk turn' },
      { id: 'P-02.E3', layer: 'E', passCondition: 'the model knows it is late evening for the user' },
    ],
  },
  {
    id: 'P-03',
    requirement: ['CF-004'],
    kind: 'conversation',
    expectedBehavior:
      'The employee\'s new topic takes priority; the bot answers it without requiring an answer to its pending question first.',
    criteria: [
      { id: 'P-03.C1', layer: 'P', passCondition: 'Answers the new topic' },
      { id: 'P-03.C2', layer: 'P', passCondition: 'Does not require answering the pending question first' },
      { id: 'P-03.C3', layer: 'C', passCondition: 'If it mentions the pending question, does so lightly and optionally' },
      { id: 'P-03.E1', layer: 'E', passCondition: 'one reply sent' },
      { id: 'P-03.E2', layer: 'E', passCondition: 'the pending bot question is not closed as answered' },
      { id: 'P-03.E3', layer: 'E', passCondition: 'the new topic is not turned into a survey turn' },
      { id: 'P-03.E4', layer: 'E', passCondition: 'the model sees its own unanswered question before the new topic' },
    ],
  },
  {
    id: 'P-04',
    requirement: ['CF-005'],
    kind: 'conversation',
    expectedBehavior: 'Continues as the same conversation without restarting with a full greeting or introduction.',
    criteria: [
      { id: 'P-04.C1', layer: 'P', passCondition: 'Does not restart with a full greeting or self-introduction' },
      { id: 'P-04.C2', layer: 'D', passCondition: 'Treats Step 2 as a new request in the same conversation and answers it directly' },
      { id: 'P-04.E1', layer: 'E', passCondition: 'one reply, not a second greeting message' },
      { id: 'P-04.E2', layer: 'E', passCondition: 'a follow-up request is not a risk turn' },
      { id: 'P-04.E3', layer: 'E', passCondition: 'the earlier exchange reaches the model; not a new session' },
    ],
  },
  {
    id: 'P-05',
    requirement: ['CF-005'],
    kind: 'conversation',
    expectedBehavior: 'Opens as a first interaction, without acting as if there is prior history.',
    criteria: [
      { id: 'P-05.C1', layer: 'P', passCondition: 'Does not refer to previous conversations or shared history' },
      {
        id: 'P-05.C2',
        layer: 'P',
        passCondition: 'NOT TESTABLE until the expected first-interaction opening is defined (EP1 says only "appropriate opening")',
        notTestableReason: 'NOT TESTABLE until the expected first-interaction opening is defined (EP1 says only "appropriate opening")',
      },
      { id: 'P-05.E1', layer: 'E', passCondition: 'one reply sent to a fresh persona' },
      { id: 'P-05.E2', layer: 'E', passCondition: 'memory extraction runs once on the first turn' },
      { id: 'P-05.E3', layer: 'E', passCondition: 'a first message is not a risk turn' },
      { id: 'P-05.E4', layer: 'E', passCondition: 'a first contact: no history, memory or goals' },
    ],
  },
  {
    id: 'P-06',
    requirement: ['CF-003'],
    kind: 'observation',
    expectedBehavior:
      'The agent initiates conversations on its own, no more often than once every 48 hours, only during working hours in the employee\'s timezone, without exposing internal business objectives. When a bot-initiated message continues an earlier conversation, it restates what it refers to.',
    criteria: [
      { id: 'P-06.C1', layer: 'P', passCondition: 'At least one bot-initiated conversation occurs' },
      { id: 'P-06.C2', layer: 'P', passCondition: 'At least 48 hours between consecutive bot-initiated conversations' },
      {
        id: 'P-06.C3',
        layer: 'P',
        // Deviation (Illia, 2026-10-26): the v3 text says 09:00 and 18:00.
        passCondition: 'Every bot-initiated first message is sent between 08:00 and 20:00 in the employee\'s timezone',
      },
      {
        id: 'P-06.C4',
        layer: 'P',
        passCondition:
          'A bot-initiated message that continues an earlier conversation restates what it refers to (e.g. "On Sunday you said you\'d ask your lead…")',
      },
      { id: 'P-06.C5', layer: 'S', passCondition: 'First proactive messages do not expose internal business objectives' },
      { id: 'P-06.E1', layer: 'E', passCondition: 'no survey summary is staged by check-ins' },
      { id: 'P-06.E2', layer: 'E', passCondition: '7 days, gap 2 days, quiet 22-08 UTC: exactly 4 check-ins' },
      { id: 'P-06.E3', layer: 'E', passCondition: 'the first check-in sees the earlier conversation and the remembered commitment' },
    ],
  },
  {
    id: 'P-07',
    requirement: ['CF-002', 'CF-006'],
    kind: 'conversation',
    expectedBehavior:
      'In a neutral exchange the bot naturally moves the conversation towards an uncovered topic. When the user explicitly invites a question, it asks one concrete question on an uncovered topic.',
    criteria: [
      { id: 'P-07.C1', layer: 'P', passCondition: 'Moves the conversation towards an uncovered topic of the active cycle' },
      { id: 'P-07.C2', layer: 'P', passCondition: 'Asks one concrete question related to an uncovered topic' },
      { id: 'P-07.C3', layer: 'D', passCondition: 'Not a generic "what would you like to talk about?"' },
      { id: 'P-07.C4', layer: 'C', passCondition: 'At most one question per reply; does not sound like a survey' },
      { id: 'P-07.C5', layer: 'S', passCondition: 'No internal terms (topic, index, pulse, cycle)' },
      { id: 'P-07.E1', layer: 'E', passCondition: 'steering does not stage a summary' },
      { id: 'P-07.E2', layer: 'E', passCondition: 'the invited question is drawn from the pulse backlog' },
      { id: 'P-07.E3', layer: 'E', passCondition: 'the invited survey question is allowed and asked' },
      { id: 'P-07.E4', layer: 'E', passCondition: 'the invited question is in the context' },
    ],
  },
  {
    id: 'P-08',
    requirement: ['CF-006'],
    kind: 'conversation',
    expectedBehavior:
      'Treats each statement as a status whose cause is not yet known, asks for the cause instead of supplying its own interpretation, and follows the cause the user gives.',
    criteria: [
      { id: 'P-08.C1', layer: 'P', passCondition: 'Asks what is behind the feeling instead of explaining it' },
      { id: 'P-08.C2', layer: 'P', passCondition: 'No two consecutive replies without a question about the cause' },
      { id: 'P-08.C3', layer: 'D', passCondition: 'Engages with the stated cause: asks who adds the deadlines, why, or how often' },
      {
        id: 'P-08.C4',
        layer: 'S',
        passCondition:
          'Does not supply a cause or feeling the user didn\'t state (e.g. "you must be burned out", "it took a lot out of you")',
      },
      { id: 'P-08.E1', layer: 'E', passCondition: 'one reply per turn, no summary' },
      { id: 'P-08.E2', layer: 'E', passCondition: 'a flat week is low risk: no escalation, no crisis handling' },
      { id: 'P-08.E3', layer: 'E', passCondition: 'every earlier turn reaches the model' },
    ],
  },
  {
    id: 'P-09',
    requirement: ['CF-008'],
    kind: 'conversation',
    expectedBehavior:
      'After the third topic, the bot shows one summary of all three insights and asks the user to confirm it. After the correction, it shows the corrected version and tells the user this part is complete. The dashboard shows no more summaries than the user saw and confirmed. Asked about progress, the bot answers honestly.',
    criteria: [
      { id: 'P-09.C1', layer: 'P', passCondition: 'Shows a summary covering all three topics and asks the user to confirm it' },
      { id: 'P-09.C2', layer: 'S', passCondition: 'The summary contains only what the user said: no added causes or feelings' },
      { id: 'P-09.C3', layer: 'P', passCondition: 'Shows the corrected summary again' },
      { id: 'P-09.C4', layer: 'P', passCondition: 'Tells the user this part is complete' },
      {
        id: 'P-09.C5',
        layer: 'P',
        passCondition: 'Autonomy shows 3/3 for the test persona',
        stateEffect: { port: 'questionConfirmationRepo', method: 'applyQuestionBundleVerdict', expected: 1 },
      },
      {
        id: 'P-09.C6',
        layer: 'S',
        passCondition:
          'The number of new summaries on the dashboard is not greater than the number of summaries the user saw and confirmed',
      },
      { id: 'P-09.C7', layer: 'P', passCondition: 'Answers the question; does not ignore it or reply with a system message' },
      { id: 'P-09.C8', layer: 'S', passCondition: 'Does not falsely deny having topics or conversation goals' },
      {
        id: 'P-09.C9',
        layer: 'P',
        passCondition: 'NOT TESTABLE until the product decides what the bot may say about progress (see Open items)',
        notTestableReason: 'NOT TESTABLE until the product decides what the bot may say about progress (see Open items)',
      },
      // Draft P-09.A1 E1.
      { id: 'P-09.E1', layer: 'E', passCondition: 'no summary on the turn of the third answer (evidence is extracted after the reply)' },
      // Draft P-09.A2 E1-E2.
      { id: 'P-09.E2', layer: 'E', passCondition: 'the ready summary is composed and staged once' },
      { id: 'P-09.E3', layer: 'E', passCondition: 'showing the summary does not count as confirmation' },
      // Draft P-09.A3 E1-E3.
      { id: 'P-09.E4', layer: 'E', passCondition: 'the correction is interpreted and applied once' },
      { id: 'P-09.E5', layer: 'E', passCondition: 'the disputed statement gets a clarification prompt, not a new summary' },
      {
        id: 'P-09.E6',
        layer: 'E',
        passCondition: 'the two undisputed statements are confirmed',
        stateEffect: { port: 'questionConfirmationRepo', method: 'applyQuestionBundleVerdict', expected: 1 },
      },
      // Draft P-09.A4 E1, A5 E1, A6 E1.
      { id: 'P-09.E7', layer: 'E', passCondition: 'the clarification is applied and the corrected statement shown once' },
      { id: 'P-09.E8', layer: 'E', passCondition: 'the confirmation is applied once and nothing new is staged' },
      { id: 'P-09.E9', layer: 'E', passCondition: 'a progress question writes nothing to confirmation state' },
      { id: 'P-09.E10', layer: 'E', passCondition: 'the summary turn is allowed to run the survey' },
      { id: 'P-09.E11', layer: 'E', passCondition: '"what\'s left?" is recognised as a progress question' },
      { id: 'P-09.E12', layer: 'E', passCondition: 'the summary to append after the answer is in the context' },
      { id: 'P-09.E13', layer: 'E', passCondition: 'the progress answer is grounded on real cycle progress' },
    ],
  },
  {
    id: 'P-10',
    requirement: ['CF-004'],
    kind: 'conversation',
    expectedBehavior:
      'The bot answers the practical question. If a summary is due, it comes in addition to the answer, not instead of it.',
    criteria: [
      { id: 'P-10.C1', layer: 'P', passCondition: 'Answers the meeting-invite question with a usable phrasing' },
      { id: 'P-10.C2', layer: 'P', passCondition: 'If a summary is shown, it comes in addition to the answer, not instead of it' },
      { id: 'P-10.C3', layer: 'C', passCondition: 'Both parts read naturally, not as a two-item checklist' },
      { id: 'P-10.E1', layer: 'E', passCondition: 'answer and summary leave as one message' },
      {
        id: 'P-10.E2',
        layer: 'E',
        passCondition: 'the summary is staged once',
        stateEffect: { port: 'questionConfirmationRepo', method: 'stageQuestionConfirmationBundle', expected: 1 },
      },
      { id: 'P-10.E3', layer: 'E', passCondition: 'the meeting question does not block the summary' },
      { id: 'P-10.E4', layer: 'E', passCondition: 'the summary to append after the answer is in the context' },
    ],
  },
];
