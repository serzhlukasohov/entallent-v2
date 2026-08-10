import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { InternalServiceAuthGuard } from './internal-auth.guard';
import { InternalServiceAuthService } from './internal-auth.service';

@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: InternalServiceAuthService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new InternalServiceAuthService({
          secret: ((): string | undefined => {
            const internalSecret = config.get<string>('INTERNAL_SERVICE_AUTH_SECRET')?.trim();
            if (internalSecret) {
              return internalSecret;
            }
            return config.get<string>('AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET')?.trim();
          })(),
        }),
    },
    InternalServiceAuthGuard,
  ],
  exports: [InternalServiceAuthGuard, InternalServiceAuthService],
})
export class InternalAuthModule {}
