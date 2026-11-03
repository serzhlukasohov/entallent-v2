import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseModule } from '../database/database.module';
import { ConversationTraceAdminController } from './conversation-trace-admin.controller';
import { ConversationTraceAdminService } from './conversation-trace-admin.service';
import { ConversationTraceReader } from './conversation-trace.reader';

/** Mounted by AppModule only when `shouldMountConversationTraceAdmin()` is true. */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [ConversationTraceAdminController],
  providers: [ApiKeyGuard, ConversationTraceReader, ConversationTraceAdminService],
})
export class ConversationTraceAdminModule {}
