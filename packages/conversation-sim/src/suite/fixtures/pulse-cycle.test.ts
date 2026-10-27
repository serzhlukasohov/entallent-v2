import { describe, expect, it } from 'vitest';
import { SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { ScriptedAiProvider } from '../../fakes/scripted-ai';
import { createL0World, fixtureContext } from '../executors/l0-deterministic-executor';
import { createL1World, l1FixtureContext } from '../executors/l1-orchestrator-executor';
import { fixtureContext as judgeFixtureContext } from '../judge/judge-input';
import { PreconditionResultSchema, type FixtureRef, type LoadedTest } from '../schema';
import { L0_FIXTURES, L1_FIXTURES } from './index';
import { pulseCycleFixture, pulseCycleGroupOf } from './pulse-cycle';

const START = new Date('2026-01-05T08:00:00.000Z');

const question = (surveyQuestionId: string, questionGroup: string, status: string) => ({
  surveyQuestionId,
  questionVersion: 'v2',
  questionGroup,
  workingSummary: `Summary ${surveyQuestionId}.`,
  title: `Title ${surveyQuestionId}`,
  status,
});

const PARAMS = {
  surveyWindowId: 'window-1',
  questions: [question('a1', 'autonomy', 'pending'), question('a2', 'autonomy', 'confirmed'), question('g1', 'growth', 'declined')],
  uncoveredTopics: [{ topic: 'autonomy', canonicalQuestions: ['How much say do you have over how you work?'] }],
};

function test(setup: FixtureRef[] = [{ name: 'pulseCycle', params: PARAMS }]): LoadedTest {
  return {
    id: 'P-07.A1',
    sourceCase: 'P-07',
    requirement: [],
    kind: 'atomic',
    levels: ['L1'],
    runProfile: 'isolated',
    setup,
    seed: { history: [] },
    preconditions: [],
    steps: [{ text: 'Hello.' }],
    criteria: [],
  };
}

function build(setup?: FixtureRef[]) {
  const loaded = test(setup);
  const world = createL1World(START, new ScriptedAiProvider(), 'openai:test');
  const context = l1FixtureContext(world, loaded, START);
  return { world, context, instance: pulseCycleFixture.create(context, pulseCycleFixture.params.parse(PARAMS)) };
}

describe('pulseCycle fixture', () => {
  it('is registered at L1 only', () => {
    expect(L1_FIXTURES.pulseCycle).toBe(pulseCycleFixture);
    expect(L0_FIXTURES.pulseCycle).toBeUndefined();
    expect(Object.keys(L1_FIXTURES).sort()).toEqual(
      ['clock', 'confirmationState', 'disclosureDelivered', 'freshPersona', 'memoryItems', 'pendingBotQuestion', 'proactiveUsers', 'pulseCycle', 'seededHistory'],
    );
  });

  it('validates params strictly and refines uncovered topics against open questions', () => {
    expect(pulseCycleFixture.params.safeParse(PARAMS).success).toBe(true);
    const issues = (value: unknown) => {
      const parsed = pulseCycleFixture.params.safeParse(value);
      return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    };
    expect(issues({ ...PARAMS, extra: 1 })).toEqual([expect.stringContaining('Unrecognized key')]);
    expect(issues({ ...PARAMS, questions: [] })).toContain('questions: Array must contain at least 1 element(s)');
    expect(issues({ ...PARAMS, uncoveredTopics: [] })).toEqual(['uncoveredTopics: Array must contain at least 1 element(s)']);
    expect(issues({ ...PARAMS, uncoveredTopics: [{ topic: 'autonomy', canonicalQuestions: [] }] })).toEqual([
      'uncoveredTopics.0.canonicalQuestions: Array must contain at least 1 element(s)',
    ]);
    expect(issues({ ...PARAMS, questions: [{ ...PARAMS.questions[0], title: undefined }] }).length).toBeGreaterThan(0);
    expect(issues({ ...PARAMS, uncoveredTopics: [{ topic: 'growth', canonicalQuestions: ['Q?'] }] })).toEqual([
      'uncoveredTopics.0.topic: topic growth has no question that is not confirmed or declined',
    ]);
    expect(issues({ ...PARAMS, uncoveredTopics: [{ topic: 'purpose', canonicalQuestions: ['Q?'] }] })).toEqual([
      'uncoveredTopics.0.topic: topic purpose has no question that is not confirmed or declined',
    ]);
  });

  it('apply seeds the V2 window and the survey window; verify reads the open topics back', async () => {
    const { world, instance } = build();
    await instance.apply();
    const result = await instance.verify();
    PreconditionResultSchema.parse(result);
    expect(result).toEqual({ source: 'fixture', name: 'pulseCycle', satisfied: true, detail: 'open topics: autonomy' });

    expect(world.state.questionConfirmationRepo.questionProgress()).toEqual({ answered: 1, total: 3 });
    expect(world.state.questionConfirmationRepo.questionProgress('autonomy')).toEqual({ answered: 1, total: 2 });
    const window = await world.state.surveyRepo.findOrCreateActiveWindow(SIM_USER_ID, SIM_TENANT_ID);
    expect(window).toMatchObject({ id: 'window-1', tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, status: 'active' });
    expect(window!.periodStart.getTime()).toBeLessThan(START.getTime());
    expect(window!.periodEnd.getTime()).toBeGreaterThan(START.getTime());
    const questions = await world.state.surveyRepo.findQuestionsForWindow('window-1');
    expect(questions.map((record) => [record.id, record.questionGroup, record.title, record.version])).toEqual([
      ['a1', 'autonomy', 'Title a1', 'v2'],
      ['a2', 'autonomy', 'Title a2', 'v2'],
      ['g1', 'growth', 'Title g1', 'v2'],
    ]);
    // The backlog steers to the first open question of the first uncovered topic.
    const next = await world.state.surveyRepo.pulseBacklog().getNextProbeQuestion(SIM_USER_ID, SIM_TENANT_ID);
    expect(next).toMatchObject({ question: { id: 'a1' }, windowId: 'window-1', focus: 'open' });
  });

  it('verify is false once the uncovered topic is closed in the raw fake', async () => {
    const { world, instance } = build();
    await instance.apply();
    world.state.questionConfirmationRepo.seedWindow({
      tenantId: SIM_TENANT_ID,
      userId: SIM_USER_ID,
      surveyWindowId: 'window-1',
      questions: PARAMS.questions.map(({ title: _title, ...rest }) => ({ ...rest, status: 'confirmed' as const })),
    });
    expect(await instance.verify()).toEqual({
      source: 'fixture',
      name: 'pulseCycle',
      satisfied: false,
      detail: 'open topics: none; not open: autonomy',
    });
  });

  it('refuses when a V2 window is already seeded, when confirmationState is also set up, or without a survey repository', async () => {
    const seeded = build();
    seeded.world.state.questionConfirmationRepo.seedWindow({ tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, surveyWindowId: 'other', questions: [] });
    await expect(seeded.instance.apply()).rejects.toThrow('already seeded');

    const both = build([{ name: 'pulseCycle', params: PARAMS }, { name: 'confirmationState', params: {} }]);
    await expect(both.instance.apply()).rejects.toThrow('confirmationState');

    const l0World = createL0World(test(), START);
    const l0 = pulseCycleFixture.create(fixtureContext(l0World, test(), START), pulseCycleFixture.params.parse(PARAMS));
    await expect(l0.apply()).rejects.toThrow('survey repository');
  });

  it('names the questionProgress group and keeps the judge fixture context unchanged', () => {
    expect(pulseCycleGroupOf(test())).toBe('autonomy');
    expect(pulseCycleGroupOf(test([]))).toBeNull();
    expect(pulseCycleGroupOf(test([{ name: 'pulseCycle', params: { surveyWindowId: 'w' } }]))).toBeNull();
    expect(judgeFixtureContext(test())).toEqual({ pulseCycle: { uncoveredTopics: PARAMS.uncoveredTopics } });
  });

  it('freshPersona sees a seeded survey window at L1', async () => {
    const { world, context, instance } = build();
    await instance.apply();
    const fresh = L1_FIXTURES.freshPersona!.create(context, {});
    expect(await fresh.verify()).toMatchObject({ satisfied: false, detail: expect.stringContaining('survey-window') });
    expect(world.state.surveyRepo.hasWindow()).toBe(true);
  });
});
