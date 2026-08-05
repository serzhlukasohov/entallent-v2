import { Module } from '@nestjs/common';
import { FeatureFlagRepository } from './feature-flag.repository';
import { RuntimeControlFlagRepository } from './runtime-control-flag.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [FeatureFlagRepository, RuntimeControlFlagRepository],
  exports: [FeatureFlagRepository, RuntimeControlFlagRepository],
})
export class FeatureFlagModule {}
