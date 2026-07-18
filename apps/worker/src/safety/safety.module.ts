import { Module } from '@nestjs/common';
import { RiskSignalRepository } from './repositories/risk-signal.repository';
import { AuditLogRepository } from './repositories/audit-log.repository';
import { EscalationStubService, AUDIT_LOG_PORT } from './escalation-stub.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    RiskSignalRepository,
    AuditLogRepository,
    { provide: AUDIT_LOG_PORT, useClass: AuditLogRepository },
    EscalationStubService,
  ],
  exports: [RiskSignalRepository, AuditLogRepository, EscalationStubService],
})
export class SafetyModule {}
