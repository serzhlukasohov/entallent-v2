import type { CaptureEngagementAnswerInput, EngagementAnswerRepositoryPort, EngagementCaptureResult } from '../ports/engagement-answer.repository.port';

/** Capture has no model dependency and must precede all resumable/coalesced conversation work. */
export class CaptureEngagementAnswerUseCase {
  constructor(private readonly repository: EngagementAnswerRepositoryPort) {}
  execute(input: CaptureEngagementAnswerInput): Promise<EngagementCaptureResult> {
    return this.repository.capture(input);
  }
  backfill(input: Omit<CaptureEngagementAnswerInput, 'inboundMessageId'>): Promise<void> {
    return this.repository.captureConversation(input);
  }
}
