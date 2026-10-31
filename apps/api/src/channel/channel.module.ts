import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SlackEventsController } from './slack-events.controller';
import { IngestionService } from './ingestion.service';
import { EventIdempotencyService } from './event-idempotency.service';
import { SlackIngestService } from './slack-ingest.service';
import { SlackSocketModeService } from './slack-socket-mode.service';
import { ReportingRightsAdmissionRepository } from './reporting-rights-interaction';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.ONBOARDING_ACTION },
      { name: QUEUE_NAMES.REPORTING_RIGHTS },
    ),
  ],
  controllers: [SlackEventsController],
  providers: [
    IngestionService,
    EventIdempotencyService,
    SlackIngestService,
    SlackSocketModeService,
    ReportingRightsAdmissionRepository,
  ],
  exports: [IngestionService],
})
export class ChannelModule {}
