import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type {
  FinalizeQuestionInsightUseCase, SurveyEvidenceExtractionUseCase,
  SurveyEvidencePayload,
} from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';

const job = { data: {
  conversationId: 'conversation', userId: 'person', tenantId: 'tenant',
  inboundMessageId: 'message', traceId: 'trace',
} } as Job<SurveyEvidencePayload>;

describe('SurveyEvidenceProcessor V2 finalization', () => {
  it('rejects a mismatched queued conversation before finalization or model work', async () => {
    const useCase = {
      assertConversationOwner: vi.fn().mockRejectedValue(new Error('private scope detail')),
      execute: vi.fn(),
    };
    const finalizer = { executePending: vi.fn() };
    const processor = new SurveyEvidenceProcessor(
      useCase as unknown as SurveyEvidenceExtractionUseCase,
      finalizer as unknown as FinalizeQuestionInsightUseCase,
    );

    await expect(processor.process(job)).rejects.toThrow('survey_evidence_processing_failed');
    expect(finalizer.executePending).not.toHaveBeenCalled();
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('finalizes confirmed questions before new evidence extraction', async () => {
    const order: string[] = [];
    const useCase = {
      assertConversationOwner: vi.fn().mockImplementation(async () => { order.push('scope'); }),
      execute: vi.fn().mockImplementation(async () => { order.push('evidence'); }),
    };
    const finalizer = { executePending: vi.fn().mockImplementation(async () => { order.push('finalize'); }) };
    const processor = new SurveyEvidenceProcessor(
      useCase as unknown as SurveyEvidenceExtractionUseCase,
      finalizer as unknown as FinalizeQuestionInsightUseCase,
    );

    await processor.process(job);

    expect(order).toEqual(['scope', 'finalize', 'evidence']);
    expect(finalizer.executePending).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'person' });
  });

  it('does not expose private model output in the queue failure reason', async () => {
    const useCase = { assertConversationOwner: vi.fn(), execute: vi.fn().mockResolvedValue(undefined) };
    const finalizer = { executePending: vi.fn().mockRejectedValue(
      new Error('private summary about Project Atlas'),
    ) };
    const processor = new SurveyEvidenceProcessor(
      useCase as unknown as SurveyEvidenceExtractionUseCase,
      finalizer as unknown as FinalizeQuestionInsightUseCase,
    );

    await expect(processor.process(job)).rejects.toThrow('v2_question_finalization_failed');
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('does not persist evidence-model error text in queue reasons or operational logs', async () => {
    const privateText = 'private employee statement about Project Atlas';
    const useCase = {
      assertConversationOwner: vi.fn(),
      execute: vi.fn().mockRejectedValue(new Error(privateText)),
    };
    const finalizer = { executePending: vi.fn() };
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const processor = new SurveyEvidenceProcessor(
      useCase as unknown as SurveyEvidenceExtractionUseCase,
      finalizer as unknown as FinalizeQuestionInsightUseCase,
    );
    try {
      await expect(processor.process(job)).rejects.toThrow('survey_evidence_processing_failed');
      expect(logged.mock.calls.flat().join(' ')).not.toContain(privateText);
      expect(finalizer.executePending).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'person' });
    } finally {
      logged.mockRestore();
    }
  });
});

it('RPT05 finalization-only recovery calls no capture/extractor even without a pending extraction intent',async()=>{
 const extract={assertConversationOwner:vi.fn().mockResolvedValue(undefined),prepare:vi.fn(),apply:vi.fn(),execute:vi.fn()};const finalizer={executePending:vi.fn().mockResolvedValue(1)};const capture={execute:vi.fn()};const processor=new SurveyEvidenceProcessor(extract as never,finalizer as never,{status:vi.fn()} as never,capture as never);
 await processor.process({data:{tenantId:'t',userId:'u',conversationId:'c',inboundMessageId:'i',traceId:'trace',mode:'finalize_only'}} as never);expect(finalizer.executePending).toHaveBeenCalledOnce();expect(capture.execute).not.toHaveBeenCalled();expect(extract.prepare).not.toHaveBeenCalled();expect(extract.execute).not.toHaveBeenCalled();
});

 it.each(['native_only', 'legacy_only'] as const)('injected native lifecycle preserves immediate %s finalization and disjoint window ownership', async (scope) => {
   const extract = { assertConversationOwner: vi.fn(), execute: vi.fn(), prepare: vi.fn() };
   const finalizer = { executePending: vi.fn() };
   const progress = { finalizationScope: vi.fn().mockResolvedValue(scope), completeEvidence: vi.fn() };
   const processor = new SurveyEvidenceProcessor(extract as never, finalizer as never, undefined, undefined, progress as never);
   await processor.process(job);
   expect(progress.finalizationScope).toHaveBeenCalledWith({ conversationId: 'conversation', tenantId: 'tenant', userId: 'person', inboundMessageId: 'message' });
   expect(finalizer.executePending).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'person', scope });
 });

it('historical backfill with the real empty receipt payload remains legacy-owned and bypasses native UUID classification', async () => {
  const extract = { assertConversationOwner: vi.fn(), backfill: vi.fn().mockResolvedValue({ windowsProcessed: 1 }), prepare: vi.fn() };
  const finalizer = { executePending: vi.fn() };
  const capture = { backfill: vi.fn() };
  const progress = { finalizationScope: vi.fn().mockRejectedValue(new Error('invalid_uuid_receipt')), completeEvidence: vi.fn() };
  const processor = new SurveyEvidenceProcessor(extract as never, finalizer as never, undefined, capture as never, progress as never);
  const payload = { tenantId: 'tenant', userId: 'person', conversationId: 'conversation', inboundMessageId: '', traceId: 'backfill', mode: 'backfill' as const };
  await processor.process({ data: payload } as Job<SurveyEvidencePayload>);
  expect(progress.finalizationScope).not.toHaveBeenCalled();
  expect(finalizer.executePending).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'person', scope: 'legacy_only' });
  expect(capture.backfill).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'person', conversationId: 'conversation' });
  expect(extract.backfill).toHaveBeenCalledOnce();
  expect(extract.prepare).not.toHaveBeenCalled();
});
