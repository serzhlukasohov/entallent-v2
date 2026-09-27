import { Module } from '@nestjs/common';
import { HierarchyDraftService } from './hierarchy-draft.service';
import { HierarchySlackLinkService } from './hierarchy-slack-link.service';
import { SlackDirectoryService } from './slack-directory.service';
import { HierarchyRolloutService } from './hierarchy-rollout.service';
import { CompanyAuthModule } from '../company-auth/company-auth.module';
import { CompanySetupController } from './company-setup.controller';
import { CompanySetupReadService } from './company-setup-read.service';
import { CompanySetupUiController } from './company-setup-ui.controller';
import { HierarchyMutationService } from './hierarchy-mutation.service';
import { HierarchyCapabilityService } from './hierarchy-capability.service';
import { HierarchyAdvisorScopeService } from './hierarchy-advisor-scope.service';
import { HierarchyDeactivationService } from './hierarchy-deactivation.service';

@Module({
  imports: [CompanyAuthModule],
  controllers: [CompanySetupController, CompanySetupUiController],
  providers: [HierarchyDraftService, HierarchySlackLinkService, SlackDirectoryService, HierarchyRolloutService, CompanySetupReadService, HierarchyMutationService, HierarchyCapabilityService, HierarchyAdvisorScopeService, HierarchyDeactivationService],
  exports: [HierarchyDraftService, HierarchySlackLinkService, HierarchyRolloutService],
})
export class HierarchyModule {}
