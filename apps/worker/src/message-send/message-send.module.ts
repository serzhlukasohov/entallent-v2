import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessageSendProcessor } from './message-send.processor';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.MESSAGE_SEND }),
  ],
  providers: [
    WorkspaceConnectionRepository,
    ConversationRepository,
    MessageSendProcessor,
  ],
})
export class MessageSendModule {}
