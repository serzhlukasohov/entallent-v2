import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FollowUpExecutionUseCase, FollowUpSchedulerUseCase } from '@entalent/application';
import { FollowUpExecutionProcessor } from './follow-up-execution.processor';
import { ScheduledActionRepository } from './repositories/scheduled-action.repository';
import { FollowUpContextRepository } from './repositories/follow-up-context.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { OutboxService } from '../conversation/outbox.service';
import { AiService } from '../conversation/ai.service';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.FOLLOWUP_EXECUTION },
      { name: QUEUE_NAMES.MESSAGE_SEND },
      { name: QUEUE_NAMES.MEMORY_EXTRACTION },
    ),
  ],
  providers: [
    AiService,
    ConversationRepository,
    ScheduledActionRepository,
    FollowUpContextRepository,
    OutboxService,
    {
      provide: FollowUpExecutionUseCase,
      useFactory: (
        actionRepo: ScheduledActionRepository,
        contextRepo: FollowUpContextRepository,
        convRepo: ConversationRepository,
        outbox: OutboxService,
        ai: AiService,
      ) => new FollowUpExecutionUseCase(actionRepo, contextRepo, convRepo, outbox, ai),
      inject: [
        ScheduledActionRepository,
        FollowUpContextRepository,
        ConversationRepository,
        OutboxService,
        AiService,
      ],
    },
    {
      provide: FollowUpSchedulerUseCase,
      useFactory: (actionRepo: ScheduledActionRepository, outbox: OutboxService) =>
        new FollowUpSchedulerUseCase(actionRepo, outbox),
      inject: [ScheduledActionRepository, OutboxService],
    },
    FollowUpExecutionProcessor,
  ],
  exports: [ScheduledActionRepository, FollowUpSchedulerUseCase],
})
export class FollowUpModule {}
