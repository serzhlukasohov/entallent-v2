import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LocalEncryptionAdapter } from '../crypto/local-encryption.adapter';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { ConversationTracePurgeProcessor } from './conversation-trace-purge.processor';
import { ConversationTraceRecorder } from './conversation-trace.recorder';
import { ConversationTraceRepository } from './conversation-trace.repository';

/** Production conversation trace (SPEC CAP-6): recorder for the composition root, storage, 30-day purge. */
@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.CONVERSATION_TRACE_PURGE }),
  ],
  providers: [
    LocalEncryptionAdapter,
    ConversationTraceRepository,
    ConversationTraceRecorder,
    ConversationTracePurgeProcessor,
  ],
  exports: [ConversationTraceRecorder],
})
export class ConversationTraceModule {}
