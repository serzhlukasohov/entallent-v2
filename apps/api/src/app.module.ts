import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@entalent/config';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { ChannelModule } from './channel/channel.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { DevModule } from './dev/dev.module';
import { shouldMountDevModule } from './dev/dev-endpoints';

const mountDevModule = shouldMountDevModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: () => validateEnv() }),
    DatabaseModule,
    QueueModule,
    HealthModule,
    ChannelModule,
    UsersModule,
    AdminModule,
    ...(mountDevModule ? [DevModule] : []),
  ],
})
export class AppModule {}
