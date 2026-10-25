import { describe, expect, it, vi } from 'vitest';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { InMemoryQuestionConfirmationRepository } from '../../fakes/question-confirmation';
import { ScriptedAiProvider } from '../../fakes/scripted-ai';
import { createL1World } from '../executors/l1-orchestrator-executor';
import { L0_STATE_QUERY_NAMES } from '../executors/state-queries-l0';
import { SuiteExecutionError } from '../executors/types';
import { StateQueryNameSchema } from '../schema';
import { L1_STATE_QUERIES, readL1Snapshot } from './state-queries';

const START = new Date('2026-01-05T08:00:00.000Z');

function world() {
  const built = createL1World(START, new ScriptedAiProvider(), 'openai:test');
  built.state.questionConfirmationRepo.seedWindow({
    tenantId: SIM_TENANT_ID,
    userId: SIM_USER_ID,
    surveyWindowId: 'w',
    questions: [
      { surveyQuestionId: 'a1', questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'S.', status: 'confirmed' },
      { surveyQuestionId: 'a2', questionVersion: 'v1', questionGroup: 'autonomy', workingSummary: 'S.', status: 'pending' },
      { surveyQuestionId: 'g1', questionVersion: 'v1', questionGroup: 'growth', workingSummary: 'S.', status: 'confirmed' },
    ],
  });
  return built;
}

describe('L1 state-query table', () => {
  it('has one L1 accessor per StateQueryName; the L0 table is unchanged', () => {
    expect(Object.keys(L1_STATE_QUERIES).sort()).toEqual([...StateQueryNameSchema.options].sort());
    for (const row of Object.values(L1_STATE_QUERIES)) expect(typeof row.l1).toBe('function');
    expect(L0_STATE_QUERY_NAMES).not.toContain('surveyEvidenceCount');
  });

  it('reads question progress over the group or the whole window, counts, and survey evidence', async () => {
    const built = world();
    await built.state.conversationRepo.saveMessage({
      conversationId: SIM_CONVERSATION_ID, tenantId: SIM_TENANT_ID, userId: SIM_USER_ID, direction: 'outbound', text: 'Hi.',
    });
    expect(readL1Snapshot(built.state, { group: 'autonomy' })).toEqual({
      questionProgress: { answered: 1, total: 2 },
      stagedBundleCount: 0,
      surveyEvidenceCount: 0,
      outboundCount: 1,
    });
    expect(readL1Snapshot(built.state, { group: null }).questionProgress).toEqual({ answered: 2, total: 3 });

    const evidence = await built.state.surveyRepo.saveEvidence({
      surveyWindowId: 'w', surveyQuestionId: 'a2', userId: SIM_USER_ID, sourceMessageIds: ['m1'], evidenceSummary: 'x',
      polarity: 'positive', strength: 0.8, completeness: 0.8, confidence: 0.9, evaluatorVersion: 'v1', promptVersion: 'v1',
    });
    expect(readL1Snapshot(built.state, { group: null }).surveyEvidenceCount).toBe(1);
    await built.state.surveyRepo.markEvidenceSuperseded([evidence.id]);
    expect(readL1Snapshot(built.state, { group: null }).surveyEvidenceCount).toBe(0);
  });

  it('an invalid value is a SuiteExecutionError state-query:<name>', () => {
    const spy = vi.spyOn(InMemoryQuestionConfirmationRepository.prototype, 'stagedBundleCount').mockReturnValue(-1);
    try {
      expect(() => readL1Snapshot(world().state, { group: null })).toThrow(SuiteExecutionError);
      try {
        readL1Snapshot(world().state, { group: null });
      } catch (error) {
        expect(error).toMatchObject({ kind: 'infrastructure', reason: 'state-query:stagedBundleCount' });
      }
    } finally {
      spy.mockRestore();
    }
  });
});
