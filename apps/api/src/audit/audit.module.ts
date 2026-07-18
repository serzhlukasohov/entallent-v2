import { Module } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [AuditLogRepository],
  exports: [AuditLogRepository],
})
export class AuditModule {}
