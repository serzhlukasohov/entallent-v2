import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProfileHydrationUseCase } from '@entalent/application';
import type { ProfileHydrationPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';

@Processor(QUEUE_NAMES.PROFILE_HYDRATION)
export class ProfileHydrationProcessor extends WorkerHost {
  private readonly logger = new Logger(ProfileHydrationProcessor.name);
  constructor(private readonly useCase: ProfileHydrationUseCase) { super(); }
  async process(job: Job<ProfileHydrationPayload>): Promise<void> {
    const { userId, tenantId, channelType, externalWorkspaceId, traceId } = job.data;
    try {
      await this.useCase.execute({ userId, tenantId, channelType, externalWorkspaceId });
    } catch (err) {
      this.logger.error(`Profile hydration failed [${traceId}]: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}
