import { Module } from '@nestjs/common';
import { InternalAuthModule } from '../internal-auth';
import { AuditModule } from '../audit/audit.module';
import { InternalMafContextController } from './internal-maf-context.controller';
import { InternalMafContextService } from './internal-maf-context.service';

@Module({
  imports: [InternalAuthModule, AuditModule],
  controllers: [InternalMafContextController],
  providers: [InternalMafContextService],
})
export class InternalMafContextModule {}
