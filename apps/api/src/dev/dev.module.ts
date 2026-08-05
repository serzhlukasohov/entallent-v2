import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DevSimulateController } from './dev-simulate.controller';
import { ChannelModule } from '../channel/channel.module';
import { DatabaseModule } from '../database/database.module';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    ChannelModule,
    DatabaseModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.PROACTIVE_SCAN },
    ),
  ],
  controllers: [DevSimulateController],
  providers: [ApiKeyGuard],
})
export class DevModule {}
