import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReportConfigurationService } from './report-configuration.service';
@Module({
  imports: [DatabaseModule],
  providers: [ReportConfigurationService],
  exports: [ReportConfigurationService],
})
export class ReportConfigurationModule {}
