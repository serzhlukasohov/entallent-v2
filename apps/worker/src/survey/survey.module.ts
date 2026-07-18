import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SurveyEvidenceExtractionUseCase } from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';
import { SurveyRepository } from './repositories/survey.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { AiService } from '../conversation/ai.service';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.SURVEY_EVIDENCE }),
  ],
  providers: [
    AiService,
    ConversationRepository,
    SurveyRepository,
    {
      provide: SurveyEvidenceExtractionUseCase,
      useFactory: (ai: AiService, convRepo: ConversationRepository, surveyRepo: SurveyRepository) =>
        new SurveyEvidenceExtractionUseCase(ai, convRepo, surveyRepo),
      inject: [AiService, ConversationRepository, SurveyRepository],
    },
    SurveyEvidenceProcessor,
  ],
  exports: [SurveyRepository],
})
export class SurveyModule {}
