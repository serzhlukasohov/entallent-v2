import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@entalent/config';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { ConversationModule } from './conversation/conversation.module';
import { MessageSendModule } from './message-send/message-send.module';
import { MemoryModule } from './memory/memory.module';
import { FollowUpModule } from './followup/followup.module';
import { SurveyModule } from './survey/survey.module';
import { SafetyModule } from './safety/safety.module';
import { ProactiveSchedulerModule } from './proactive/proactive-scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: () => validateEnv() }),
    DatabaseModule,
    QueueModule,
    HealthModule,
    ConversationModule,
    MessageSendModule,
    MemoryModule,
    FollowUpModule,
    SurveyModule,
    SafetyModule,
    ProactiveSchedulerModule,
  ],
})
export class AppModule {}
