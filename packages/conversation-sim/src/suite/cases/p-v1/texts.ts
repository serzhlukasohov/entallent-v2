import type { ScriptedStep, SeedTurn } from '../../schema';

/**
 * Texts and shared shapes of suite p-v1 (Story 12.4). Suite user texts are the Confluence
 * page 189333505 v3 text verbatim (`_bmad-output/specs/spec-conversation-eval-regression/
 * p-suite-v1-confluence-v3.md`); `verbatim.test.ts` checks every one against the snapshot.
 * Seeded coach texts, working summaries and the authored P-09 user turns were drafted by the
 * agent and approved by Illia (2026-10-26/27); never edit them without a new approval.
 */

// ---------------------------------------------------------------------------
// Suite user texts (Confluence v3, verbatim)
// ---------------------------------------------------------------------------

export const P01_STEP_1 = 'hey, can you help me think through how to prioritise my tasks today?';
export const P02_STEP_1 = 'late one — can you help me write a quick note to my team that I\'ll be offline tomorrow morning?';
export const P03_STEP_1 = 'unrelated, but do you know a good way to structure a weekly status update?';
export const P04_STEP_1 = 'quick one — can you help me phrase a reminder to my team about tomorrow\'s deadline?';
export const P04_STEP_2 = 'also — how do I politely ask someone to stop interrupting in meetings?';
export const P05_STEP_1 = 'hi';
export const P07_STEPS = [
  'hey, quiet day today, got a few minutes',
  'not much going on, just the usual tasks',
  'anyway, is there anything you wanted to ask me?',
] as const;
export const P08_STEPS = [
  'honestly I feel kind of flat this week',
  'there have just been a lot of deadlines lately',
  'they keep getting added on top of everything else',
] as const;
export const P09_STEPS = [
  'I choose how I do my work, nobody tells me which tools or order to use. But deadlines get moved without anyone asking me.',
  'small ideas about how we work usually get picked up. anything about planning or deadlines just disappears.',
  'day to day my role is clear. it\'s the one-off tasks where nobody says what "done" looks like.',
  'mostly right, but small ideas do get picked up, so it\'s not that I have no influence at all',
  'did I answer everything you needed from me? what\'s left?',
] as const;
export const P10_STEPS = [
  'I get on well with my team, I feel like I fit in there',
  'I can say when something\'s broken or when I messed up, nobody blames anyone',
  'my manager is supportive when I go to him. also, quick one — how do I politely decline a meeting invite?',
] as const;

// ---------------------------------------------------------------------------
// P-06.C4 setup (approved by Illia, 2026-10-27; not in the snapshot)
// ---------------------------------------------------------------------------

/** The earlier conversation a check-in should continue (Friday 2026-01-02 16:00 UTC). */
export const P06_EARLIER_CONVERSATION = [
  'I\'ll ask my lead on Monday whether the release date can move.',
  'Sounds like a good plan. Let me know how it goes.',
] as const;
/** The commitment that conversation left in memory. */
export const P06_REMEMBERED_COMMITMENT = 'Plans to ask the team lead on Monday whether the release date can move.';

// ---------------------------------------------------------------------------
// Authored P-09 user turns (approved by Illia, 2026-10-27; not in the snapshot)
// ---------------------------------------------------------------------------

/** The user turn after the third answer, on which the product shows the summary. */
export const P09_AUTHORED_SUMMARY_TURN = 'that\'s pretty much it on my side';
/** The user's answer to the clarification question about the disputed second statement. */
export const P09_AUTHORED_CLARIFICATION =
  'small ideas about how we work get picked up, so I do have some say there. it\'s planning and deadlines where nothing I say lands.';
/** The user's confirmation of the corrected statement. */
export const P09_AUTHORED_CONFIRMATION = 'yes, that\'s right';

export const AUTHORED_USER_TURNS: readonly string[] = [
  P06_EARLIER_CONVERSATION[0],
  P09_AUTHORED_SUMMARY_TURN,
  P09_AUTHORED_CLARIFICATION,
  P09_AUTHORED_CONFIRMATION,
];

// ---------------------------------------------------------------------------
// Approved seeded coach texts (Illia, 2026-10-26/27)
// ---------------------------------------------------------------------------

export const P03_PENDING_BOT_QUESTION = 'Hey! How did the planning session with your team go yesterday?';
export const P04_COACH_1 =
  'Sure! Something like: "Hi all, a quick reminder that the report is due tomorrow at 5pm. If anything might get in the way, flag it today so we can sort it out." Want it more formal or more casual?';
export const P07_COACH = [
  'Nice, a quiet day can be a good chance to catch your breath. How\'s the week been so far?',
  'Got it — steady days like that have their place.',
] as const;
export const P08_COACH = [
  'Thanks for telling me. What do you think is behind that flat feeling this week?',
  'That\'s a lot to keep track of when deadlines pile up.',
] as const;
export const P10_COACH = [
  'Good to hear you feel you fit in. When something goes wrong on the team, how does that usually get handled?',
  'That kind of openness matters. How do things look with your manager?',
] as const;
export const P09_COACH = {
  afterStep1:
    'That\'s a useful distinction: freedom in how you work, but no say when deadlines move. When ideas come up about how the team works, what usually happens to them?',
  afterStep2:
    'So small process ideas land, but anything touching planning or deadlines gets lost. How clear is your role day to day?',
  /** Not a summary. */
  afterStep3: 'That\'s a clear picture: the day-to-day is clear, the one-off tasks aren\'t.',
  /** Seeded with `metadata.v2ConfirmationBundle: true`. */
  summary:
    'Here\'s how I\'d sum up what you shared:\n• You decide how you do your work, but deadlines get moved without asking you.\n• Small ideas about how you work get picked up; anything about planning or deadlines disappears.\n• Your role is clear day to day, but one-off tasks lack a clear definition of done.\nDoes that sound right?',
  clarificationPrompt:
    'Thanks. To get the second point right: how would you put the part about ideas and influence in your own words?',
  correctedStatement:
    'Updated: Small ideas about how you work get picked up, so you do have some influence; ideas about planning or deadlines don\'t land. Is that right now?',
  complete: 'Got it, thanks — that part is complete.',
} as const;

/** The disputed second statement as the summary showed it (a line of the approved summary). */
export const P09_DISPUTED_STATEMENT = 'Small ideas about how you work get picked up; anything about planning or deadlines disappears.';
/** The corrected second statement as the corrected-statement reply showed it (part of the approved text). */
export const P09_CORRECTED_STATEMENT =
  'Small ideas about how you work get picked up, so you do have some influence; ideas about planning or deadlines don\'t land.';

// ---------------------------------------------------------------------------
// confirmationState / pulseCycle data
// ---------------------------------------------------------------------------

export const AUTONOMY_WINDOW = 'p-v1-autonomy-window';
export const BELONGING_WINDOW = 'p-v1-belonging-window';

/** Autonomy and Belonging canonical questions from `packages/database/src/seed.ts`. */
export const CANONICAL = {
  q12_strengths_opportunity: {
    title: 'Opportunity to Do Best Work',
    meaning: 'Does the employee have the opportunity to do what they do best every day?',
  },
  q12_opinions_count: {
    title: 'Opinions Count',
    meaning: 'Does the employee feel that their opinions and input actually matter at work — that they are heard and taken seriously?',
  },
  q12_expectations: {
    title: 'Clear Expectations',
    meaning: 'Does the employee know what is expected of them at work?',
  },
  wellbeing_at_work: {
    title: 'Wellbeing at Work',
    meaning: 'How is the employee\'s overall wellbeing — energy, stress, and sense of balance at work?',
  },
  belonging_psychological_safety: {
    title: 'Psychological Safety',
    meaning: 'Does the employee feel safe speaking up with concerns, ideas, or admitting mistakes?',
  },
  q12_supervisor_cares: {
    title: 'Supervisor Cares',
    meaning:
      'Does the employee feel that their supervisor, or someone at work, genuinely cares about them as a person — not just as a resource?',
  },
} as const;

type CanonicalId = keyof typeof CANONICAL;

/** P-09 Autonomy questions in suite order: q1 tools and order of work, q2 ideas and influence, q3 role clarity. */
export const AUTONOMY_IDS = ['q12_strengths_opportunity', 'q12_opinions_count', 'q12_expectations'] as const;
/** P-10 Belonging questions in suite order: q1 fitting in, q2 raising problems, q3 the manager. */
export const BELONGING_IDS = ['wellbeing_at_work', 'belonging_psychological_safety', 'q12_supervisor_cares'] as const;

/** Approved working summaries (Illia, 2026-10-26). */
export const AUTONOMY_SUMMARIES: Record<(typeof AUTONOMY_IDS)[number], string> = {
  q12_strengths_opportunity: 'Chooses own tools and order of work; deadlines are moved without being consulted.',
  q12_opinions_count: 'Small ideas about ways of working get picked up; ideas about planning or deadlines are dropped.',
  q12_expectations: 'Day-to-day role is clear; one-off tasks lack a definition of done.',
};
/** The third Belonging summary was approved by Illia on 2026-10-27 so that a summary is due on P-10 reply 3. */
export const BELONGING_SUMMARIES: Record<(typeof BELONGING_IDS)[number], string> = {
  wellbeing_at_work: 'Gets on well with the team and feels they fit in.',
  belonging_psychological_safety: 'Can raise problems or own mistakes without blame.',
  q12_supervisor_cares: 'Finds the manager supportive when they go to him.',
};

export type QuestionStatus = 'pending' | 'ready' | 'confirmed' | 'disputed' | 'declined';

/** A `confirmationState` question; a question without an approved summary carries its canonical meaning (never shown). */
export function confirmationQuestion(
  id: CanonicalId,
  group: 'autonomy' | 'belonging',
  status: QuestionStatus,
  workingSummary?: string,
): Record<string, unknown> {
  return {
    surveyQuestionId: id,
    questionVersion: '1',
    questionGroup: group,
    workingSummary: workingSummary ?? CANONICAL[id].meaning,
    status,
  };
}

/** `pulseCycle` params: one open group of three pending questions, uncovered, with its canonical questions. */
export function pulseCycleParams(group: 'autonomy' | 'belonging'): Record<string, unknown> {
  const ids = group === 'autonomy' ? AUTONOMY_IDS : BELONGING_IDS;
  return {
    surveyWindowId: group === 'autonomy' ? AUTONOMY_WINDOW : BELONGING_WINDOW,
    questions: ids.map((id) => ({ ...confirmationQuestion(id, group, 'pending'), title: CANONICAL[id].title })),
    uncoveredTopics: [{ topic: group, canonicalQuestions: ids.map((id) => CANONICAL[id].meaning) }],
  };
}

// ---------------------------------------------------------------------------
// Fixtures, seeds, scripted outputs and checks
// ---------------------------------------------------------------------------

/**
 * The product's English reporting disclosure (`packages/application/src/utils/reporting-disclosure.ts`,
 * not exported), as the delivered message that carried it.
 */
export const REPORTING_DISCLOSURE =
  'If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.';

/** One hour before the evaluated turn, older than every seed turn. */
export const DISCLOSURE_OFFSET_MS = 3_600_000;

export const disclosureDelivered = { name: 'disclosureDelivered', params: { text: REPORTING_DISCLOSURE, atOffsetMs: DISCLOSURE_OFFSET_MS } } as const;

/** The suite's "at least 60 s between messages". */
export const TURN_GAP_MS = 60_000;

/**
 * Seed history from turns in chronological order: the last turn lies `lastGapMs` before the
 * evaluated turn and earlier turns are `TURN_GAP_MS` apart.
 */
export function seedOf(
  turns: ReadonlyArray<{ role: 'user' | 'coach'; text: string; metadata?: Record<string, unknown> }>,
  lastGapMs = TURN_GAP_MS,
): { history: SeedTurn[] } {
  return {
    history: turns.map((turn, index) => ({
      role: turn.role,
      text: turn.text,
      atOffsetMs: lastGapMs + (turns.length - 1 - index) * TURN_GAP_MS,
      ...(turn.metadata ? { metadata: turn.metadata } : {}),
    })),
  };
}

export const user = (text: string) => ({ role: 'user' as const, text });
export const coach = (text: string, metadata?: Record<string, unknown>) => ({ role: 'coach' as const, text, ...(metadata ? { metadata } : {}) });

/**
 * L0 model outputs for the one evaluated turn. L0 never reads reply text, so the reply is a
 * neutral placeholder (no question, so it also satisfies the answer-then-bundle contract).
 */
export function scriptedTurn(step = 1): ScriptedStep[] {
  return [{ step, classification: {}, risk: {}, memoryProposal: {}, response: { text: 'Scripted L0 reply.' } }];
}

export const SEND = { port: 'outbox', method: 'enqueueMessageSend' } as const;
export const STAGE = { port: 'questionConfirmationRepo', method: 'stageQuestionConfirmationBundle' } as const;
export const VERDICT = { port: 'questionConfirmationRepo', method: 'applyQuestionBundleVerdict' } as const;
export const CLARIFY = { port: 'questionConfirmationRepo', method: 'applyQuestionClarificationVerdict' } as const;

/** An `effect-count` check: exactly `expected` successful `port.method` calls on `step`. */
export function effect(target: { port: string; method: string }, expected: number, step = 1): Record<string, unknown> {
  return { type: 'rule', rule: 'effect-count', params: { ...target, expected, step } };
}

export const rule = (name: string, params?: Record<string, unknown>) => ({ type: 'rule', rule: name, ...(params ? { params } : {}) });
export const MEANING = { type: 'meaning' } as const;
