import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('ProactiveSchedulerRepository', () => {
  it('treats recent synthetic MAF proactive request messages as check-in cooldown evidence', () => {
    const source = readFileSync(join(__dirname, 'proactive-scheduler.repository.ts'), 'utf8');

    expect(source).toContain("m.message_type = 'proactive_check_in_request'");
    expect(source).toContain("m.sender_type = 'system'");
    expect(source).toContain("m.occurred_at > now() - make_interval(days => ${params.minCheckInGapDays})");
  });
});
