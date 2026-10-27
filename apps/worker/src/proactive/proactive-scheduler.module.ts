import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ProactiveSchedulerUseCase, systemClock } from '@entalent/application';
import type { Env } from '@entalent/config';
import { ProactiveSchedulerRepository } from './proactive-scheduler.repository';
import { CheckInEnqueueService } from './check-in-enqueue.service';
import { ProactiveScanProcessor } from './proactive-scan.processor';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { ConversationModule } from '../conversation/conversation.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [
    DatabaseModule,
    ConversationModule,
    OnboardingModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PROACTIVE_SCAN },
      { name: QUEUE_NAMES.CONVERSATION },
    ),
  ],
  providers: [
    ProactiveSchedulerRepository,
    CheckInEnqueueService,
    {
      provide: ProactiveSchedulerUseCase,
      useFactory: (
        repo: ProactiveSchedulerRepository,
        queue: CheckInEnqueueService,
        config: ConfigService<Env, true>,
      ) =>
        new ProactiveSchedulerUseCase(repo, queue, {
          minSilenceDays: config.get('PROACTIVE_MIN_SILENCE_DAYS', { infer: true }),
          minCheckInGapDays: config.get('PROACTIVE_MIN_GAP_DAYS', { infer: true }),
          batchLimit: config.get('PROACTIVE_BATCH_LIMIT', { infer: true }),
          quietHoursEnabled: config.get('QUIET_HOURS_ENABLED', { infer: true }),
        }, systemClock),
      inject: [ProactiveSchedulerRepository, CheckInEnqueueService, ConfigService],
    },
    ProactiveScanProcessor,
  ],
})
export class ProactiveSchedulerModule {}
