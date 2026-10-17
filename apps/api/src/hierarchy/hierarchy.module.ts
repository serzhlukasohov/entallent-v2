import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingEventPublisher } from '../onboarding/onboarding-event-publisher';
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
  imports: [CompanyAuthModule, BullModule.registerQueue({ name: QUEUE_NAMES.ONBOARDING_ACTION })],
  controllers: [CompanySetupController, CompanySetupUiController],
  providers: [HierarchyDraftService, HierarchySlackLinkService, SlackDirectoryService, HierarchyRolloutService, CompanySetupReadService, HierarchyMutationService, HierarchyCapabilityService, HierarchyAdvisorScopeService, HierarchyDeactivationService, OnboardingEventPublisher],
  exports: [HierarchyDraftService, HierarchySlackLinkService, HierarchyRolloutService],
})
export class HierarchyModule {}
