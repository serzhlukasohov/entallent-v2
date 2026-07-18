import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MemoryExtractionUseCase } from '@entalent/application';
import { MemoryExtractionProcessor } from './memory-extraction.processor';
import { MemoryRepository } from './repositories/memory.repository';
import { GoalRepository } from './repositories/goal.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { AiService } from '../conversation/ai.service';
import { DatabaseModule } from '../database/database.module';
import { FollowUpModule } from '../followup/followup.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    FollowUpModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.MEMORY_EXTRACTION }),
  ],
  providers: [
    AiService,
    ConversationRepository,
    MemoryRepository,
    GoalRepository,
    {
      provide: MemoryExtractionUseCase,
      useFactory: (
        convRepo: ConversationRepository,
        memRepo: MemoryRepository,
        goalRepo: GoalRepository,
        ai: AiService,
      ) => new MemoryExtractionUseCase(convRepo, memRepo, goalRepo, ai),
      inject: [ConversationRepository, MemoryRepository, GoalRepository, AiService],
    },
    MemoryExtractionProcessor,
  ],
  exports: [MemoryRepository, GoalRepository, FollowUpModule],
})
export class MemoryModule {}
