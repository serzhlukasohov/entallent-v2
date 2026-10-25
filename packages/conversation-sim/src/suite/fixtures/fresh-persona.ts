import { z } from 'zod';
import { SIM_TENANT_ID, SIM_USER_ID } from '../../harness/coach-harness';
import { satisfied, type FixtureModule } from './types';

const params = z.object({}).strict().default({});

/** No seeded memory, goals, style or survey (question-confirmation) state (AD-18). Writes nothing. */
export const freshPersonaFixture: FixtureModule<z.infer<typeof params>> = {
  name: 'freshPersona',
  params,
  create(context) {
    return {
      async apply() {},
      async verify() {
        const { memoryRepo, goalRepo, styleRepo, questionConfirmationRepo } = context.state;
        const found: string[] = [];
        if (memoryRepo.items.length > 0) found.push(`memory:${memoryRepo.items.length}`);
        if (goalRepo.goals.length > 0) found.push(`goals:${goalRepo.goals.length}`);
        if (await styleRepo.findByUser(SIM_USER_ID, SIM_TENANT_ID)) found.push('style-profile');
        if (questionConfirmationRepo.questionProgress().total > 0) found.push('question-window');
        if (questionConfirmationRepo.stagedBundleCount() > 0) found.push('staged-bundles');
        if (questionConfirmationRepo.pendingClarification()) found.push('pending-clarification');
        return satisfied('freshPersona', found.length === 0, found.length > 0 ? found.join(', ') : undefined);
      },
    };
  },
};
