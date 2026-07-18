import { Module } from '@nestjs/common';
import { UserMemoryController } from './user-memory.controller';
import { UserPreferencesController } from './user-preferences.controller';
import { UserDataController } from './user-data.controller';
import { UserMemoryService } from './user-memory.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [UserMemoryController, UserPreferencesController, UserDataController],
  providers: [UserMemoryService, ApiKeyGuard],
})
export class UsersModule {}
