import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SlackEventsController } from './slack-events.controller';
import { IngestionService } from './ingestion.service';
import { EventIdempotencyService } from './event-idempotency.service';
import { SlackIngestService } from './slack-ingest.service';
import { SlackSocketModeService } from './slack-socket-mode.service';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.CONVERSATION }),
  ],
  controllers: [SlackEventsController],
  providers: [
    IngestionService,
    EventIdempotencyService,
    SlackIngestService,
    SlackSocketModeService,
  ],
  exports: [IngestionService],
})
export class ChannelModule {}
