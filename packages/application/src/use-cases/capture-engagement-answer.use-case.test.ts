import { expect, it, vi } from 'vitest';
import { CaptureEngagementAnswerUseCase } from './capture-engagement-answer.use-case';
import type { EngagementAnswerRepositoryPort } from '../ports/engagement-answer.repository.port';
const input={tenantId:'tenant',userId:'subject',conversationId:'conversation',inboundMessageId:'receipt'};
it('keeps benign literal denial separate from retryable proof failure',async()=>{
  const capture=vi.fn().mockResolvedValueOnce({status:'ineligible',replayed:false}).mockRejectedValueOnce(new Error('engagement_source_proof_unavailable'));
  const useCase=new CaptureEngagementAnswerUseCase({capture} as unknown as EngagementAnswerRepositoryPort);
  await expect(useCase.execute(input)).resolves.toEqual({status:'ineligible',replayed:false});
  await expect(useCase.execute(input)).rejects.toThrow('engagement_source_proof_unavailable');
});
