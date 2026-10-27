import { describe, expect, it } from 'vitest';
import { REPLY_MESSAGE_SEPARATOR, type CaseRun } from '../schema';
import { noGreetingRestart } from './no-greeting-restart';
import { syntheticRun } from './synthetic-run';
import { GREETING_PHRASES } from './terms/greeting-phrases';

const at = (evaluatedAt: string) => ({ id: 'X-01.C1', evaluatedAt });
function twoMessages(first: string, second: string): CaseRun {
  const run = syntheticRun('X-01.A1', [first]);
  const step = run.steps[0]!;
  const messages = [first, second].map((text, position) => ({
    id: `X-01.A1-m1-${position}`,
    text,
    occurredAt: '2026-01-05T10:01:00.000Z',
    metadata: {},
  }));
  return { ...run, steps: [{ ...step, reply: { messages, text: messages.map((m) => m.text).join(REPLY_MESSAGE_SEPARATOR) } }] };
}

const check = (text: string) => noGreetingRestart.run(syntheticRun('X-01.A1', [text]), at('reply:1'));

describe('no-greeting-restart', () => {
  it('is frozen data', () => {
    expect(Object.isFrozen(GREETING_PHRASES)).toBe(true);
  });

  it('checks only the first sentence (a greeting mid-reply PASSes)', () => {
    expect(check('Thanks. Hi again, and hello to the new plan. Which part moves first?')).toEqual({ status: 'PASS' });
  });

  it('checks only the first message when it has no end punctuation', () => {
    const run = twoMessages('Got it', 'Hello again! Which part moves first?');
    expect(noGreetingRestart.run(run, at('reply:1'))).toEqual({ status: 'PASS' });
    const greeting = twoMessages('Hello again', 'Got it. Which part moves first?');
    expect(noGreetingRestart.run(greeting, at('reply:1'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — Hello again (hello)',
    });
  });

  it("keeps I'm-style phrases and apostrophes correct", () => {
    expect(check("Okay, I'm your coach here. What is new?").status).toBe('FAIL');
    expect(check("Let's say hi later. What is new?")).toEqual({
      status: 'FAIL',
      evidence: "turn 1 — Let's say hi later. (hi)",
    });
    expect(check("Rock'n'hey vibes. What is new?")).toEqual({ status: 'PASS' });
  });

  it('does not match greetings inside other words', () => {
    expect(check('This week sounds heavy. Which part moves first?')).toEqual({ status: 'PASS' });
    expect(check('Highlights first: which part moves?')).toEqual({ status: 'PASS' });
  });

  it.each([
    ['Hi! Which part moves first?', 'Hi!', 'hi'],
    ['Hello there, how is the week?', 'Hello there, how is the week?', 'hello'],
    ['Hey. What is new?', 'Hey.', 'hey'],
    ['Good   morning, Anna. What is new?', 'Good   morning, Anna.', 'good morning'],
    ['I’m your coach for this week. What is new?', 'I’m your coach for this week.', "I'm your coach"],
    ['So, my name is Ava. What is new?', 'So, my name is Ava.', 'my name is'],
  ])('FAILs on "%s"', (text, opening, phrase) => {
    expect(check(text)).toEqual({ status: 'FAIL', evidence: `turn 1 — ${opening} (${phrase})` });
  });

  it('is NOT_OBSERVABLE without reply.text', () => {
    const run = syntheticRun('X-01.A1', ['Hi!'], ['events']);
    expect(noGreetingRestart.run(run, at('reply:1'))).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'unobservable:reply.text@L0' });
  });
});
