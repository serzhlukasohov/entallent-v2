import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import {
  ScriptedAiProvider,
  makeClassification,
  makeMemoryProposal,
} from '../fakes/scripted-ai';
import { expectNoDeterministicViolations, reportDeterministicRun } from './baseline-test-helpers';

describe('migration baseline: planning and memory', () => {
  it('supports assessment preparation without turning it into a manager assessment', async () => {
    const { harness } = createCoachAgent({
      userName: 'Leon',
      aiProvider: new ScriptedAiProvider({
        classifications: [
          makeClassification({
            primaryIntent: 'feedback_request',
            latestUserSubstance: 'prepare for assessment conversation',
          }),
        ],
        responses: [
          {
            text: 'We can make this about what you want to communicate, not a scorecard for your manager.',
            confidence: 0.9,
            containsSurveyProbe: false,
          },
        ],
      }),
    });

    await harness.send('Can you help me prepare for my assessment conversation?');
    await reportDeterministicRun('assessment preparation', harness);

    expectNoDeterministicViolations(harness);
    expect(harness.turns[0]?.classification.primaryIntent).toBe('feedback_request');
    expect(harness.replies.join('\n')).not.toMatch(/manager score|performance rating/i);
  });

  it('creates and later updates a goal through observable repository state', async () => {
    const aiProvider = new ScriptedAiProvider({
      classifications: [
        makeClassification({ primaryIntent: 'goal_setting', latestUserSubstance: 'create goal' }),
        makeClassification({ primaryIntent: 'progress_update', latestUserSubstance: 'goal completed' }),
      ],
      memoryProposals: [
        makeMemoryProposal({
          goalProposals: [
            {
              title: 'Prepare assessment examples',
              description: 'Collect concrete examples before the assessment conversation.',
              category: 'career',
              confidence: 0.92,
              sourceMessageIds: [],
              action: 'create',
              existingGoalId: null,
            },
          ],
        }),
        ({ existing }) =>
          makeMemoryProposal({
            goalProposals: [
              {
                title: 'Prepare assessment examples',
                category: 'career',
                confidence: 0.9,
                sourceMessageIds: [],
                action: 'complete',
                existingGoalId: existing.goals[0]?.id ?? null,
              },
            ],
          }),
      ],
    });
    const { harness } = createCoachAgent({ userName: 'Leon', aiProvider });

    await harness.send('I want to collect concrete examples before my assessment.');
    await harness.send('I finished collecting those examples.');
    await reportDeterministicRun('goal create update', harness);

    expectNoDeterministicViolations(harness);
    expect(harness.goalRepo.goals).toHaveLength(1);
    expect(harness.goalRepo.goals[0]).toMatchObject({
      title: 'Prepare assessment examples',
      status: 'completed',
    });
  });

  it('extracts memory and supersedes an incorrect memory when corrected', async () => {
    const aiProvider = new ScriptedAiProvider({
      classifications: [
        makeClassification({ primaryIntent: 'progress_update', latestUserSubstance: 'incorrect memory seed' }),
        makeClassification({ primaryIntent: 'clarification', dialogueAct: 'correction', latestUserSubstance: 'memory correction' }),
      ],
      memoryProposals: [
        makeMemoryProposal({
          memoryItems: [
            {
              category: 'project_context',
              canonicalKey: 'current_project',
              content: 'User is working on Project Atlas.',
              confidence: 0.88,
              importance: 0.7,
              sensitivity: 'normal',
              expectedLifetime: 'months',
              sourceMessageIds: [],
              action: 'create',
              existingItemId: null,
            },
          ],
        }),
        makeMemoryProposal({
          memoryItems: [
            {
              category: 'project_context',
              canonicalKey: 'current_project',
              content: 'User is working on Project Boreal, not Project Atlas.',
              confidence: 0.91,
              importance: 0.75,
              sensitivity: 'normal',
              expectedLifetime: 'months',
              sourceMessageIds: [],
              action: 'update',
              existingItemId: null,
            },
          ],
        }),
      ],
    });
    const { harness } = createCoachAgent({ userName: 'Leon', aiProvider });

    await harness.send('I am working on Project Atlas this quarter.');
    await harness.send('Correction: it is Project Boreal, not Project Atlas.');
    await reportDeterministicRun('memory correction', harness);

    expectNoDeterministicViolations(harness);
    expect(harness.memoryItems).toHaveLength(1);
    expect(harness.memoryItems[0]?.content).toMatch(/Project Boreal/);
    expect(harness.memoryRepo.items.some((item) => item.status === 'superseded')).toBe(true);
  });

  it('keeps casual conversation light and non-invasive', async () => {
    const { harness } = createCoachAgent({
      userName: 'Leon',
      aiProvider: new ScriptedAiProvider({
        classifications: [
          makeClassification({
            primaryIntent: 'casual_conversation',
            dialogueAct: 'acknowledgement',
            latestUserSubstance: 'ordinary greeting',
          }),
        ],
        responses: [
          {
            text: 'Good to hear from you. We can keep it light.',
            confidence: 0.9,
            containsSurveyProbe: false,
          },
        ],
      }),
    });

    await harness.send('Hey, just saying hi.');
    await reportDeterministicRun('casual conversation', harness);

    expectNoDeterministicViolations(harness);
    expect(harness.turns[0]?.mode).toBe('normal');
    expect(harness.replies.join('\n')).not.toMatch(/survey|goal|assessment/i);
  });
});
