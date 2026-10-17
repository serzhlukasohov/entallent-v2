import type { AnsweredDetail } from '../harness/fidelity-checks';

/**
 * GC round 3 S8 fixtures (CAP-8 T9/T13, CAP-10 T12). The live scenarios and the offline
 * scripted replay share these so the employee turns, the answered details, and the judge
 * rubric cannot drift apart.
 */
export interface FidelityFixture {
  /** Scenario name; also the report slug. */
  name: string;
  description: string;
  employeeTurns: readonly string[];
  judgeCriteria: readonly string[];
}

/** T9: the employee says where the blocker sits and what they already did about it. */
export const REASKED_QUESTION_FIXTURE: FidelityFixture & { answeredDetails: readonly AnsweredDetail[] } = {
  name: 'CAP-8 answered question is not re-asked',
  description:
    'An employee reports a stuck release, states explicitly that the blocker is the security sign-off (the only reviewer is out and nobody else may sign off), then says they already pinged the reviewer\'s manager twice and asked in the security channel. The coach must not ask for any of those details again in other words.',
  employeeTurns: [
    'The release is stuck again. The blocker is on the security review side: the one reviewer who can sign off has been out all week and nobody else is allowed to. The code itself has been ready since Monday.',
    'I have already pinged the reviewer\'s manager twice and asked in the security channel, no answer so far. The team is getting restless and I am not sure what else I am supposed to do.',
  ],
  answeredDetails: [
    {
      detail: 'the blocker is the security sign-off (stated in the first employee message)',
      pattern: /\b(?:where|what|which|who)\b[^?]*\b(?:block|stuck|hold(?:ing|s)? (?:it |things |the release )?up|bottleneck)/i,
    },
    {
      detail: 'nobody else is allowed to sign off (stated in the first employee message)',
      pattern: /\b(?:is there|are there|any(?:one|body)? else|no ?one else|nobody else)\b[^?]*\b(?:sign[- ]?off|approv|review|path|cover|step in|touch)/i,
    },
    {
      detail: 'the reviewer\'s manager and the security channel were already pinged (stated in the second employee message)',
      pattern: /\b(?:have|did|had)\s+you\b[^?]*\b(?:ping|reach|contact|talk|spoke|speak|escalat|ask|flag|rais)/i,
    },
  ],
  judgeCriteria: [
    'No coach reply asks the employee to restate or confirm what they already said in their first message: where the blocker is, that only one reviewer may sign off and nobody else is allowed to, or that the release is waiting on that reviewer. A question about something they have not said is fine, for example who has the authority to grant an exception or name a backup reviewer, who owns the release timing, or whether the single-approver rule is temporary or permanent',
    'The final coach reply after the second employee message treats it as established that the employee already pinged the reviewer\'s manager twice and asked in the security channel, and does not ask whether they have contacted, escalated to, or reached out to anyone about it',
    'Any question in the final coach reply is about a materially new uncertainty, for example who could grant an exception or what the team needs from the employee now; ending without a question is also acceptable',
    'The coach engages with the situation the employee described rather than restating it back as a question',
  ],
};

/** T12: the coach suggests a move, the employee shows with a fact why it cannot work. */
export const CHANGED_ADVICE_FIXTURE: FidelityFixture = {
  name: 'CAP-10 changed advice is named',
  description:
    'An employee asks whether to raise a teammate\'s habit in Friday\'s retro. After the coach recommends an approach, the employee replies with two facts: a one-on-one already happened two weeks ago without effect, and the teammate is on leave until next month. If the coach\'s revised advice differs from its first suggestion, it must say so in one clause and name the facts as the reason.',
  employeeTurns: [
    'My teammate keeps rewriting my PR descriptions after I post them, without asking me. I was planning to bring it up in Friday\'s retro in front of the whole team. Good idea, or not?',
    'I did that two weeks ago, one on one. She said sure, no problem, and then kept doing it. And she is on leave until next month, so there is no second one-on-one before Friday\'s retro.',
  ],
  judgeCriteria: [
    'The first coach reply gives a clear recommendation on how to handle the situation (for example raising it directly with the teammate first, or raising it in the retro in a particular way)',
    'The final coach reply after the second employee message takes into account both new facts: the one-on-one already happened without effect, and the teammate is on leave until next month',
    'The final coach reply is explicit about its relation to the first recommendation: when its advice differs, it says in a clause of its own that it is changing or revising its earlier suggestion and names the employee\'s new facts as the reason; when it keeps the first recommendation, it says that it still holds despite the new facts and why; it never presents revised advice as if it had been the advice all along',
    'The final coach reply does not recommend the one-on-one the employee already tried as if it were a fresh idea',
  ],
};

/** T13: a neutral report of a rejected proposal; the coach must not add emotional weight. */
export const SENTIMENT_AMPLIFICATION_FIXTURE: FidelityFixture = {
  name: 'CAP-8 sentiment is not amplified',
  description:
    'An employee reports neutrally that their on-call rotation proposal was rejected in the planning meeting and that they are working out what to do with the prep. The coach must not call it unfair, frustrating, painful or similar, must not assert how the employee feels, and must engage with the practical question about reusing the prep work.',
  employeeTurns: [
    'Quick update: my proposal for the new on-call rotation was rejected in the planning meeting today. The team is keeping the current rotation for another quarter. I am now working out what to do with the prep I had done.',
    'Mostly I want to reuse the capacity analysis, it took a week. Thinking of turning it into a doc for the next planning round.',
  ],
  judgeCriteria: [
    'No coach reply adds emotional weight the employee did not state: it does not call the rejection unfair, frustrating, painful, disappointing, hard, or similar, and does not tell the employee they must be feeling any of that',
    'The coach reflects the facts in the employee\'s own terms (the proposal was rejected, the current rotation stays, the prep work remains) without reframing the decision as a slight against the employee or questioning the team\'s motives',
    'The coach engages with what the employee actually raised: what to do with the prep work and how to reuse the capacity analysis',
    'If the coach refers to how the employee feels at all, it asks rather than asserts, and it does not insist on an emotional reading once the employee stays practical',
  ],
};
