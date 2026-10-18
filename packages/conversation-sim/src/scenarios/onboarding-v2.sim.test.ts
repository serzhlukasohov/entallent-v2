import { describe, expect, it } from 'vitest';
import { ACK_COPY, initialOnboardingState, type OnboardingState } from '@entalent/application';
import type { OnboardingSignal } from '@entalent/contracts';
import { createCoachAgent } from '../harness/coach-agent';
import { InMemoryOnboardingTurn } from '../fakes/onboarding-turn';
import { ScriptedAiProvider, makeClassification } from '../fakes/scripted-ai';

function setup(
  state: OnboardingState,
  signal: OnboardingSignal,
  response = 'Scripted support reply.',
) {
  const onboardingTurn = new InMemoryOnboardingTurn(state);
  const aiProvider = new ScriptedAiProvider({
    classifications: [makeClassification({ onboardingSignal: signal })],
    responses: [{ text: response, confidence: 0.9, containsSurveyProbe: false }],
  });
  const { harness } = createCoachAgent({ userName: 'Sam', aiProvider, onboardingTurn });
  return { harness, onboardingTurn };
}

const delivered = (state: OnboardingState): OnboardingState => ({
  ...state,
  introStatus: 'delivered',
  buttonsActive: true,
  reminderStatus: 'scheduled',
  reminderOriginAt: new Date(),
});

describe('onboarding v2 (deterministic, scripted classifier)', () => {
  it('answers an undecided employee "later" with the pre-reminder acknowledgement', async () => {
    const { harness, onboardingTurn } = setup(
      delivered(initialOnboardingState('employee')),
      { intent: 'later', substantive: false },
    );

    await harness.send("I'm swamped, let's do it later");

    expect(harness.replies).toEqual([ACK_COPY.later_before_reminder]);
    expect(onboardingTurn.state.participation).toBe('deferred');
  });

  it('answers a venting undecided employee normally and activates participation', async () => {
    const { harness, onboardingTurn } = setup(
      delivered(initialOnboardingState('employee')),
      { intent: 'none', substantive: true },
      'That sounds exhausting. What part is weighing on you most?',
    );

    await harness.send('My project keeps slipping and I feel like I am the only one who cares.');

    expect(harness.replies[0]).toContain('That sounds exhausting');
    expect(Object.values(ACK_COPY)).not.toContain(harness.replies[0]);
    expect(onboardingTurn.state.participation).toBe('active');
  });

  it('keeps an active employee "not now" as a normal reply with no state change', async () => {
    const active: OnboardingState = {
      ...initialOnboardingState('employee'),
      participation: 'active',
      introStatus: 'completed',
      completedAt: new Date(),
    };
    const { harness, onboardingTurn } = setup(
      active,
      { intent: 'end_today_only', substantive: false },
      'No problem, we can pick this up whenever.',
    );

    await harness.send('not now, in a meeting');

    expect(harness.replies).toEqual(['No problem, we can pick this up whenever.']);
    expect(onboardingTurn.state).toEqual(active);
    expect(onboardingTurn.events).toEqual([]);
  });

  it('answers a manager "ok thanks" with the management acknowledgement', async () => {
    const { harness, onboardingTurn } = setup(
      delivered(initialOnboardingState('manager')),
      { intent: 'acknowledge', substantive: false },
    );

    await harness.send('ok thanks');

    expect(harness.replies).toEqual([ACK_COPY.got_it_management]);
    expect(onboardingTurn.state.introStatus).toBe('completed');
  });
});
