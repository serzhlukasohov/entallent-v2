/**
 * RPT-10 operator control for native pulse report activation. `show` is read-only; `set` is a dry run unless
 * `--confirm`. Never loads .env, never calls Slack or a model. Non-local databases need an explicit host match.
 */
import { createDbClient } from '@entalent/database';
import {
  PULSE_REPORT_ACTIVATION_MODES,
  validatePulseReportActivationChange,
  type PulseReportActivationChange,
  type PulseReportActivationMode,
  type PulseReportActivationScope,
} from '@entalent/application';
import { PulseReportActivationRepository } from '../apps/worker/src/survey/repositories/pulse-report-activation.repository';

export type PulseReportActivationCommand =
  | { kind: 'show'; tenantId: string; databaseUrl: string }
  | { kind: 'set'; databaseUrl: string; confirm: boolean; change: PulseReportActivationChange };

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const OFFSET_INSTANT = /T.*(?:Z|[+-]\d{2}:\d{2})$/;

export function parsePulseReportActivationArgs(
  args: string[],
  env: Record<string, string | undefined>,
): PulseReportActivationCommand {
  const [kind, ...rest] = args;
  if (kind !== 'show' && kind !== 'set') throw new Error('usage: pulse-report-activation <show|set> --tenant <uuid> ...');
  const flags = new Map<string, string[]>();
  let confirm = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--confirm') {
      confirm = true;
      continue;
    }
    if (!flag.startsWith('--') || rest[i + 1] === undefined || rest[i + 1]!.startsWith('--'))
      throw new Error(`invalid argument ${flag}`);
    flags.set(flag.slice(2), [...(flags.get(flag.slice(2)) ?? []), rest[++i]!]);
  }
  const allowed = kind === 'show' ? ['tenant', 'allow-remote-host'] : ['tenant', 'allow-remote-host', 'mode', 'expected-revision', 'approval-reference', 'operator', 'expires-at', 'scope'];
  for (const key of flags.keys()) if (!allowed.includes(key)) throw new Error(`unknown flag --${key}`);
  const one = (key: string, required = true) => {
    const values = flags.get(key) ?? [];
    if (values.length > 1) throw new Error(`--${key} given more than once`);
    if (required && !values[0]?.trim()) throw new Error(`--${key} is required`);
    return values[0]?.trim();
  };
  const databaseUrl = env['DATABASE_URL']?.trim();
  if (!databaseUrl) throw new Error('explicit DATABASE_URL is required');
  assertDatabaseTarget(databaseUrl, one('allow-remote-host', false));
  const tenantId = one('tenant')!;
  if (kind === 'show') {
    if (confirm) throw new Error('show is read-only; --confirm is not accepted');
    return { kind, tenantId, databaseUrl };
  }
  const mode = one('mode')! as PulseReportActivationMode;
  if (!(PULSE_REPORT_ACTIVATION_MODES as readonly string[]).includes(mode)) throw new Error('--mode must be off, observe or deliver');
  const revision = one('expected-revision')!;
  if (!/^\d+$/.test(revision)) throw new Error('--expected-revision must be a non-negative integer');
  const expires = one('expires-at', false);
  if (expires !== undefined && (!OFFSET_INSTANT.test(expires) || !Number.isFinite(Date.parse(expires))))
    throw new Error('--expires-at must be an ISO-8601 instant with an explicit offset');
  return {
    kind,
    databaseUrl,
    confirm,
    change: {
      tenantId,
      mode,
      expectedRevision: Number(revision),
      approvalReference: one('approval-reference')!,
      operator: one('operator')!,
      expiresAt: expires ? new Date(expires) : null,
      scopes: (flags.get('scope') ?? []).map(parseScope),
    },
  };
}

/** Every connection target (URL host and any host/hostaddr query parameter) must be local or the named host. */
export function assertDatabaseTarget(databaseUrl: string, allowRemoteHost?: string): void {
  const url = new URL(databaseUrl);
  const targets = [url.hostname, ...['host', 'hostaddr'].flatMap((k) => url.searchParams.getAll(k).flatMap((v) => v.split(',')))]
    .map((h) => h.trim());
  if (!url.hostname || targets.some((h) => !h))
    throw new Error('DATABASE_URL must name an explicit host');
  if (targets.some((h) => !LOCAL_HOSTS.includes(h) && h !== allowRemoteHost))
    throw new Error('non-local database requires --allow-remote-host matching the DATABASE_URL host and separate human approval');
}

/** `kind=team,unit=<uuid>,team=<uuid>[,recipient=<person uuid>]` or `kind=manager_overall,unit=<uuid>[,recipient=...]`. */
export function parseScope(value: string): PulseReportActivationScope {
  const parts = new Map<string, string>();
  for (const pair of value.split(',')) {
    const [key, item, extra] = pair.split('=');
    if (!key || !item || extra !== undefined || parts.has(key) || !['kind', 'unit', 'team', 'recipient'].includes(key))
      throw new Error(`invalid --scope ${value}`);
    parts.set(key, item.trim());
  }
  const kind = parts.get('kind');
  if (kind !== 'team' && kind !== 'manager_overall') throw new Error('--scope kind must be team or manager_overall');
  return {
    kind,
    orgUnitId: parts.get('unit') ?? '',
    orgTeamId: parts.get('team') ?? null,
    approvedRecipientPersonId: parts.get('recipient') ?? null,
  };
}

export async function runPulseReportActivation(command: PulseReportActivationCommand): Promise<Record<string, unknown>> {
  const client = createDbClient(command.databaseUrl);
  try {
    const repository = new PulseReportActivationRepository({ client: client.db } as never);
    if (command.kind === 'show') {
      const state = await repository.read(command.tenantId);
      const held = await repository.held(command.tenantId);
      return {
        command: 'show',
        tenantId: command.tenantId,
        ...state,
        held: held.filter((h) => h.holdReason !== 'partial_delivery_held'),
        // Truncated reports: some parts were received; re-enabling resumes strictly after the existing receipts.
        partialDeliveryHeld: held.filter((h) => h.holdReason === 'partial_delivery_held'),
      };
    }
    const before = await repository.read(command.change.tenantId);
    // Dry run and confirm both validate against the database clock and the tenant's actual org/people rows.
    const inspected = await repository.inspect(command.change);
    const errors = [...validatePulseReportActivationChange(command.change, await repository.now()), ...inspected.errors];
    const currentRevision = before.control?.revision ?? 0;
    const plan = {
      command: 'set',
      tenantId: command.change.tenantId,
      before,
      after: { mode: command.change.mode, expiresAt: command.change.expiresAt, scopes: command.change.scopes },
      expectedRevision: command.change.expectedRevision,
      currentRevision,
      warnings: inspected.warnings,
    };
    if (errors.length) return { ...plan, status: 'invalid', errors };
    if (!command.confirm)
      return { ...plan, status: currentRevision === command.change.expectedRevision ? 'dry_run' : 'dry_run_revision_conflict' };
    return { ...plan, ...(await repository.change(command.change)) };
  } finally {
    await client.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const result = await runPulseReportActivation(parsePulseReportActivationArgs(process.argv.slice(2), process.env));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (['invalid', 'revision_conflict', 'dry_run_revision_conflict'].includes(String(result['status']))) process.exitCode = 2;
}

if (process.argv[1]?.endsWith('pulse-report-activation.ts'))
  main().catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ status: 'rejected', error: error instanceof Error ? error.message : 'unknown' }) + '\n');
    process.exitCode = 1;
  });
