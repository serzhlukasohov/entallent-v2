import { describe, expect, it } from 'vitest';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { createL0World, fixtureContext, type L0World } from '../executors/l0-deterministic-executor';
import { PreconditionResultSchema, type FixtureName, type LoadedTest, type SeedTurn } from '../schema';
import { L0_FIXTURES } from './index';
import type { FixtureContext, FixtureInstance } from './types';

const START = new Date('2026-01-05T08:00:00.000Z');

function test(seed: SeedTurn[] = []): LoadedTest {
  return {
    id: 'X-01.A1',
    sourceCase: 'X-01',
    requirement: [],
    kind: 'atomic',
    levels: ['L0'],
    runProfile: 'isolated',
    setup: [],
    seed: { history: seed },
    scripted: [],
    preconditions: [],
    steps: [{ text: 'Hello.' }],
    criteria: [],
  };
}

interface Built {
  world: L0World;
  context: FixtureContext;
  instance: FixtureInstance;
}

function build(name: FixtureName, params: unknown, options: { seed?: SeedTurn[]; timezone?: string } = {}): Built {
  const module = L0_FIXTURES[name]!;
  const parsed = module.params.parse(params);
  const world = createL0World(test(options.seed), START, options.timezone);
  const context = fixtureContext(world, test(options.seed), START);
  return { world, context, instance: module.create(context, parsed) };
}

async function applyAndVerify(built: Built): Promise<ReturnType<FixtureInstance['verify']> extends Promise<infer R> ? R : never> {
  await built.instance.apply();
  const result = await built.instance.verify();
  PreconditionResultSchema.parse(result);
  return result;
}

describe('L0 fixtures', () => {
  it('registers every L0 fixture and leaves pulseCycle out', () => {
    expect(Object.keys(L0_FIXTURES).sort()).toEqual(
      ['clock', 'confirmationState', 'disclosureDelivered', 'freshPersona', 'pendingBotQuestion', 'proactiveUsers', 'seededHistory'],
    );
    for (const [name, module] of Object.entries(L0_FIXTURES)) expect(module!.name).toBe(name);
  });

  it('clock: positions the run start and verifies nothing moved it', async () => {
    const module = L0_FIXTURES.clock!;
    expect(module.harnessOptions!(module.params.parse({ start: '2026-02-02T09:00:00.000Z' }))).toEqual({
      clockStart: new Date('2026-02-02T09:00:00.000Z'),
    });
    expect(module.harnessOptions!(module.params.parse(undefined))).toEqual({});
    expect(() => module.params.parse({ start: 'tomorrow' })).toThrow();

    const built = build('clock', {});
    expect(await applyAndVerify(built)).toMatchObject({ source: 'fixture', name: 'clock', satisfied: true });
    built.world.clock.advance(1);
    expect((await built.instance.verify()).satisfied).toBe(false);
  });

  it('seededHistory: writes each seed turn at start - atOffsetMs and reads it back', async () => {
    const seed: SeedTurn[] = [
      { role: 'user', text: 'We ship Friday.', atOffsetMs: 300_000 },
      { role: 'coach', text: 'What could slip?', atOffsetMs: 120_000, metadata: { messageKind: 'seed' } },
    ];
    const built = build('seededHistory', undefined, { seed });
    expect(await applyAndVerify(built)).toMatchObject({ name: 'seededHistory', satisfied: true });

    const messages = built.world.state.conversationRepo.messages;
    expect(messages.map((message) => [message.direction, message.text, message.occurredAt.toISOString()])).toEqual([
      ['inbound', 'We ship Friday.', '2026-01-05T07:55:00.000Z'],
      ['outbound', 'What could slip?', '2026-01-05T07:58:00.000Z'],
    ]);
    expect(messages[1]?.metadata).toEqual({ messageKind: 'seed' });
    expect(built.world.sink.events.map((event) => `${event.stepIndex}:${event.port}.${event.method}`)).toEqual([
      '0:conversationRepo.saveMessage',
      '0:conversationRepo.saveMessage',
    ]);

    // A seed turn that is not in the repository fails the read-back.
    built.world.state.conversationRepo.messages.pop();
    expect((await built.instance.verify()).satisfied).toBe(false);
  });

  it('confirmationState: seeds the window, stages a bundle through the port and a pending clarification', async () => {
    const params = {
      surveyWindowId: 'window-1',
      questions: [
        { surveyQuestionId: 'q1', questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'You choose how.', status: 'confirmed' },
        { surveyQuestionId: 'q2', questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'You set order.', status: 'ready' },
        { surveyQuestionId: 'q3', questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'You push back.', status: 'disputed' },
      ],
      stagedBundle: { questionGroup: 'autonomy', displayedText: 'I heard you set the order. Fair?', questionIds: ['q2'] },
      pendingClarification: { surveyQuestionId: 'q3', disputedStatement: 'You push back.' },
    };
    const built = build('confirmationState', params);
    expect(await applyAndVerify(built)).toMatchObject({ name: 'confirmationState', satisfied: true });

    const repo = built.world.state.questionConfirmationRepo;
    expect(repo.questionProgress()).toEqual({ answered: 1, total: 3 });
    expect(repo.stagedBundleCount()).toBe(1);
    expect(repo.pendingClarification()).toMatchObject({ surveyQuestionId: 'q3', questionGroup: 'autonomy' });
    const scope = { tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, conversationId: SIM_CONVERSATION_ID, inboundMessageId: 'none' };
    expect(await repo.findAwaitingQuestionBundle(scope)).toMatchObject({ displayedText: 'I heard you set the order. Fair?' });
    expect(built.world.sink.events.map((event) => `${event.port}.${event.method}`)).toEqual([
      'questionConfirmationRepo.stageQuestionConfirmationBundle',
    ]);

    const parse = (value: unknown) => L0_FIXTURES.confirmationState!.params.parse(value);
    expect(() => parse({ ...params, stagedBundle: { ...params.stagedBundle, questionIds: ['q9'] } })).toThrow(/unknown question/);
    // Staging would rewrite a recorded verdict to awaiting.
    expect(() => parse({ ...params, stagedBundle: { ...params.stagedBundle, questionIds: ['q1'] } })).toThrow(/q1 is confirmed/);
    expect(() => parse({ ...params, stagedBundle: { ...params.stagedBundle, questionIds: ['q3'] } })).toThrow(/q3 is disputed/);
    expect(() => parse({ ...params, stagedBundle: { ...params.stagedBundle, questionGroup: 'belonging' } })).toThrow(/not in group belonging/);
    expect(() => parse({ ...params, pendingClarification: { surveyQuestionId: 'q2', disputedStatement: 'x' } })).toThrow(/needs a disputed question/);
  });

  it('freshPersona: verifies no memory, style or survey state', async () => {
    const built = build('freshPersona', {});
    expect(await applyAndVerify(built)).toMatchObject({ name: 'freshPersona', satisfied: true });
    expect(built.world.sink.events).toEqual([]);

    await built.world.state.memoryRepo.save({
      tenantId: SIM_TENANT_ID,
      userId: SIM_USER_ID,
      category: 'preference',
      content: 'likes short replies',
      confidence: 0.9,
      importance: 0.5,
      sensitivity: 'normal',
      sourceMessageIds: [],
    });
    expect(await built.instance.verify()).toMatchObject({ satisfied: false, detail: 'memory:1' });
  });

  it('pendingBotQuestion: the last message is an unanswered outbound bot question', async () => {
    const built = build('pendingBotQuestion', { text: 'How did the demo go?', atOffsetMs: 3_600_000, messageType: 'proactive_check_in' });
    expect(await applyAndVerify(built)).toMatchObject({ name: 'pendingBotQuestion', satisfied: true });
    const [question] = built.world.state.conversationRepo.messages;
    expect(question).toMatchObject({ direction: 'outbound', occurredAt: new Date('2026-01-05T07:00:00.000Z') });
    expect(built.world.state.conversationRepo.sideFieldsOf(question!.id)).toEqual({ messageType: 'proactive_check_in' });

    await built.world.state.conversationRepo.saveMessage({
      conversationId: SIM_CONVERSATION_ID,
      tenantId: SIM_TENANT_ID,
      userId: SIM_USER_ID,
      direction: 'inbound',
      text: 'Fine.',
      occurredAt: new Date('2026-01-05T07:30:00.000Z'),
    });
    expect(await built.instance.verify()).toMatchObject({ satisfied: false, detail: 'an inbound message follows the question' });
  });

  it('disclosureDelivered: a delivered outbound with the disclosure version, found by the repository lookup', async () => {
    const built = build('disclosureDelivered', { text: 'Your reflections can be used in aggregated reporting.', atOffsetMs: 600_000 });
    expect(await applyAndVerify(built)).toMatchObject({ name: 'disclosureDelivered', satisfied: true });
    const [message] = built.world.state.conversationRepo.messages;
    expect(message?.metadata).toEqual({ reportingDisclosureVersion: 'reporting-disclosure-v1' });
    expect(built.world.state.conversationRepo.deliveredAtOf(message!.id)).toEqual(new Date('2026-01-05T07:50:00.000Z'));
    expect(() => L0_FIXTURES.disclosureDelivered!.params.parse({ text: 'x', atOffsetMs: 0 })).toThrow();

    const other = build('disclosureDelivered', { text: 'Old wording.', atOffsetMs: 600_000, version: 'reporting-disclosure-v0' });
    await other.instance.apply();
    expect((await other.instance.verify()).satisfied).toBe(true);
  });

  it('proactiveUsers: requires every outcome-affecting input and registers exactly one user', async () => {
    const params = {
      timezone: 'Europe/Kyiv',
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
      scan: { minSilenceDays: 3, minCheckInGapDays: 2, quietHoursEnabled: true },
    };
    const module = L0_FIXTURES.proactiveUsers!;
    expect(module.harnessOptions!(module.params.parse(params))).toEqual({ timezone: 'Europe/Kyiv' });
    // Only quietHours varies: enabled hours must be named, disabled ones need none.
    expect(() => module.params.parse({ ...params, quietHours: { enabled: true } })).toThrow(/startHour and endHour/);
    expect(() => module.params.parse({ ...params, quietHours: { enabled: true, startHour: 22 } })).toThrow(/startHour and endHour/);
    expect((module.params.parse({ ...params, quietHours: { enabled: false } }) as typeof params).quietHours).toEqual({ enabled: false });
    expect(() => module.params.parse({ ...params, timezone: 'Mars/Olympus' })).toThrow();

    const built = build('proactiveUsers', params, { timezone: 'Europe/Kyiv' });
    expect(await applyAndVerify(built)).toMatchObject({ name: 'proactiveUsers', satisfied: true });
    expect(built.world.proactive.users).toEqual([params]);

    // Built without the fixture's timezone, the conversation does not match the user.
    const mismatched = build('proactiveUsers', params);
    await mismatched.instance.apply();
    expect((await mismatched.instance.verify()).satisfied).toBe(false);
  });
});
