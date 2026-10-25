import { SurveyEvidenceExtractionUseCase } from '@entalent/application';
import { describe, expect, it, vi } from 'vitest';
import { SIM_CONVERSATION_ID, SIM_TENANT_ID, SIM_USER_ID, createSimConversation } from '../../harness/coach-harness';
import { InlineOutbox } from '../../fakes/inline-outbox';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryStyleProfileRepository,
} from '../../fakes/repositories';
import { ScriptedAiProvider } from '../../fakes/scripted-ai';
import { InMemorySurveyRepository } from '../../fakes/survey-repository';
import { FixedClock } from './clock';

const PAYLOAD = { conversationId: SIM_CONVERSATION_ID, userId: SIM_USER_ID, tenantId: SIM_TENANT_ID, inboundMessageId: 'm1', traceId: 't1' };

function outbox(withSurvey = true): InlineOutbox {
  const clock = new FixedClock(new Date('2026-01-05T08:00:00.000Z'));
  const conversations = new InMemoryConversationRepository(createSimConversation({ clock }), clock);
  return new InlineOutbox(
    new ScriptedAiProvider(),
    conversations,
    new InMemoryMemoryRepository(clock),
    new InMemoryGoalRepository(clock),
    new InMemoryStyleProfileRepository(),
    { clock, ...(withSurvey ? { surveyEvidence: { surveyRepo: new InMemorySurveyRepository(clock) } } : {}) },
  );
}

describe('InlineOutbox survey evidence', () => {
  it('is a no-op without a survey repository', async () => {
    const execute = vi.spyOn(SurveyEvidenceExtractionUseCase.prototype, 'execute');
    try {
      await outbox(false).enqueueSurveyEvidence(PAYLOAD);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  it('runs execute for a turn and backfill for mode backfill', async () => {
    const execute = vi.spyOn(SurveyEvidenceExtractionUseCase.prototype, 'execute').mockResolvedValue();
    const backfill = vi.spyOn(SurveyEvidenceExtractionUseCase.prototype, 'backfill').mockResolvedValue({ windowsProcessed: 0 });
    try {
      const box = outbox();
      await box.enqueueSurveyEvidence(PAYLOAD);
      expect(execute).toHaveBeenCalledWith({ conversationId: SIM_CONVERSATION_ID, userId: SIM_USER_ID, tenantId: SIM_TENANT_ID, inboundMessageId: 'm1' });
      expect(backfill).not.toHaveBeenCalled();
      await box.enqueueSurveyEvidence({ ...PAYLOAD, mode: 'backfill' });
      expect(backfill).toHaveBeenCalledWith({ conversationId: SIM_CONVERSATION_ID, userId: SIM_USER_ID, tenantId: SIM_TENANT_ID });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      execute.mockRestore();
      backfill.mockRestore();
    }
  });

  it('records a throwing extraction instead of rejecting, as the worker isolates it from the reply', async () => {
    const execute = vi.spyOn(SurveyEvidenceExtractionUseCase.prototype, 'execute').mockRejectedValue(new Error('survey_evidence_prepared_history_changed'));
    try {
      const box = outbox();
      await expect(box.enqueueSurveyEvidence(PAYLOAD)).resolves.toBeUndefined();
      expect(box.surveyEvidenceFailures).toEqual(['Error: survey_evidence_prepared_history_changed']);
    } finally {
      execute.mockRestore();
    }
  });
});
