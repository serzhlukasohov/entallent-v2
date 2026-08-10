import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '../..');
const runbookPath = join(repoRoot, 'docs/maf-runtime-rollout-runbook.md');

function runbook(): string {
  expect(existsSync(runbookPath)).toBe(true);
  return readFileSync(runbookPath, 'utf8');
}

function section(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = content.indexOf('\n## ', start + heading.length);
  return next === -1 ? content.slice(start) : content.slice(start, next);
}

function bulletItems(content: string, startMarker: string, endMarker?: string): string[] {
  const start = content.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endMarker ? content.indexOf(endMarker, start + startMarker.length) : -1;
  const slice = end === -1 ? section(content, startMarker) : content.slice(start, end);
  return slice
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').replace(/[.;]$/, ''));
}

describe('MAF runtime rollout runbook', () => {
  it('documents rollback controls, mode precedence, gate interpretation, and emergency evidence rules', () => {
    const content = runbook();

    expect(content).toContain('# MAF Runtime Rollback And Ownership Transfer Runbook');
    expect(content).toContain('## Immediate Rollback Order');
    expect(content).toContain('1. Enable `maf_runtime_disabled`');
    expect(content).toContain('2. Add affected users to `maf_runtime_user_denylist`');
    expect(content).toContain('3. For all-MAF rollback, disable `maf_runtime_shadow`');
    expect(content).toContain('4. For canary-only rollback, disable or narrow `maf_runtime_canary`');
    expect(content).toContain(
      'global kill switch -> tenant/user denylist -> shadow flag -> primary flag -> canary flag -> TypeScript default',
    );
    expect(content).toContain('Flag evaluation failures fail closed to TypeScript-only processing.');
    expect(content).toContain('fallback is forbidden after `actions_committed` or `reply_committed`');
    expect(content).toContain('A `failed` phase is open only when no action commit marker and no reply commit marker exists');
    expect(content).toContain('gate evidence matches the rollout tenant, user/workspace/cohort scope');
    expect(content).toContain('`canaryEnabled: true`');
    expect(content).toContain('`manual_review_required`');
    expect(content).toContain('`insufficient_data`');
    expect(content).toContain('missing, unknown, unrecognized, or contradictory gate states are non-enabling');

    const emergencyEvidence = section(content, '## Immediate Rollback Order');
    expect(emergencyEvidence).toContain('must not include raw Slack/user text');
    expect(emergencyEvidence).toContain('provider errors');
    expect(emergencyEvidence).toContain('stack traces');
    expect(emergencyEvidence).toContain('Use IDs, digests, stable reason codes, and aggregate counts.');
  });

  it('requires an explicit ownership-transfer AD before Python writes protected aggregates', () => {
    const content = runbook();

    expect(content).toContain('## Ownership Transfer Rule');
    expect(content).toContain('No Python writer may be added until an explicit ownership-transfer AD exists');
    expect(
      bulletItems(
        content,
        'Protected aggregates and side-effect surfaces include:',
        'An ownership-transfer AD must define:',
      ),
    ).toEqual([
        'messages',
        'risk signals',
        'memory',
        'goals',
        'follow-ups',
        'survey evidence',
        'scheduled actions',
        'runtime ledgers and action ledgers',
        'runtime-control flags',
        'shadow diagnostics',
        'canary gate reports',
        'migration baseline evidence',
        'Slack sends',
      ]);
    expect(content).toContain('source of truth');
    expect(content).toContain('idempotency');
    expect(content).toContain('tenant authorization');
    expect(content).toContain('audit trail');
    expect(content).toContain('cutover drain');
    expect(content).toContain('writer lock');
    expect(content).toContain('reader compatibility');
    expect(content).toContain('dual-write prevention');
    expect(content).toContain('backout plan');
  });

  it('does not introduce deployment mutation, dashboard UI, Python command tools, or canary execution', () => {
    expect(existsSync(join(repoRoot, 'apps/dashboard/src/maf-rollout-runbook.tsx'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/deployment/canary-production.toml'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/src/agent_service/tools/command_tool.py'))).toBe(false);
    expect(existsSync(join(repoRoot, 'agent-service/src/agent_service/tools/write_tool.py'))).toBe(false);
  });
});
