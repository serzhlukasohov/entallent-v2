import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StyleAnalysisUseCase } from '@entalent/application';
import { StyleAnalysisProcessor } from './style-analysis.processor';
import { StyleProfileRepository } from './repositories/style-profile.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { AiService } from '../conversation/ai.service';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.STYLE_ANALYSIS }),
  ],
  providers: [
    AiService,
    ConversationRepository,
    StyleProfileRepository,
    {
      provide: StyleAnalysisUseCase,
      useFactory: (ai: AiService, convRepo: ConversationRepository, styleRepo: StyleProfileRepository) =>
        new StyleAnalysisUseCase(ai, convRepo, styleRepo),
      inject: [AiService, ConversationRepository, StyleProfileRepository],
    },
    StyleAnalysisProcessor,
  ],
  exports: [StyleProfileRepository],
})
export class StyleModule {}
