import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('ProactiveSchedulerRepository', () => {
  it('keeps the global cooldown and scopes accelerated QA cadence to an active frozen cohort', () => {
    const source = readFileSync(join(__dirname, 'proactive-scheduler.repository.ts'), 'utf8');

    expect(source).toContain("m.message_type = 'proactive_check_in_request'");
    expect(source).toContain("m.sender_type = 'system'");
    expect(source).toContain("THEN interval '4 hours' ELSE make_interval(days => ${params.minCheckInGapDays}) END");
    expect(source).toContain("cohort.id::text = t.proactive_messaging_policy->>'qaThreePerDayCohortId'");
    expect(source).toContain('u.id = ANY(cohort.roster_user_ids)');
    expect(source).toContain('now() >= cohort.period_start AND now() < cohort.period_end');
    expect(source).toContain('recent.occurred_at > now() - interval \'24 hours\'');
    expect(source).toContain('reply.occurred_at > unanswered.occurred_at');
  });
});
