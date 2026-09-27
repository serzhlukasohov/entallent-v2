import { Module } from '@nestjs/common';
import { CompanyAuthController } from './company-auth.controller';
import { CompanyAdminIdentityService } from './company-admin-identity.service';
import { CompanyAdminSessionService } from './company-admin-session.service';

@Module({
  controllers: [CompanyAuthController],
  providers: [CompanyAdminIdentityService, CompanyAdminSessionService],
  exports: [CompanyAdminSessionService],
})
export class CompanyAuthModule {}
