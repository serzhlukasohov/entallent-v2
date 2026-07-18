import { Module } from '@nestjs/common';
import { FeatureFlagRepository } from './feature-flag.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [FeatureFlagRepository],
  exports: [FeatureFlagRepository],
})
export class FeatureFlagModule {}
