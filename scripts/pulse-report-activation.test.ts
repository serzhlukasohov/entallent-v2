import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDbClient, orgUnits, tenants } from '@entalent/database';
import { eq } from 'drizzle-orm';
import { assertDatabaseTarget, parsePulseReportActivationArgs, parseScope, runPulseReportActivation } from './pulse-report-activation';

const T = '11111111-1111-4111-8111-111111111111', U = '22222222-2222-4222-8222-222222222222', P = '33333333-3333-4333-8333-333333333333';
const local = { DATABASE_URL: 'postgresql://postgres@127.0.0.1:5434/x' };
const setArgs = ['set', '--tenant', T, '--mode', 'observe', '--expected-revision', '0', '--approval-reference', 'CHG-1', '--operator', 'ops', '--scope', `kind=manager_overall,unit=${U}`];

const show = parsePulseReportActivationArgs(['show', '--tenant', T], local);
assert.deepEqual(show, { kind: 'show', tenantId: T, databaseUrl: local.DATABASE_URL });
const set = parsePulseReportActivationArgs(setArgs, local);
assert.equal(set.kind === 'set' && set.confirm, false, 'set is a dry run by default');
assert.equal(set.kind === 'set' && set.change.scopes[0]!.orgTeamId, null);
assert.equal((parsePulseReportActivationArgs([...setArgs, '--confirm'], local) as { confirm: boolean }).confirm, true);
assert.deepEqual(parseScope(`kind=team,unit=${U},team=${T},recipient=${P}`), { kind: 'team', orgUnitId: U, orgTeamId: T, approvedRecipientPersonId: P });

assert.throws(() => parsePulseReportActivationArgs(['show', '--tenant', T], {}), /explicit DATABASE_URL/);
assert.throws(() => parsePulseReportActivationArgs(['show', '--tenant', T], { DATABASE_URL: 'postgresql://u@db.example.com/x' }), /non-local database/);
assert.equal(parsePulseReportActivationArgs(['show', '--tenant', T, '--allow-remote-host', 'db.example.com'], { DATABASE_URL: 'postgresql://u@db.example.com/x' }).kind, 'show');
assert.throws(() => parsePulseReportActivationArgs(['show', '--tenant', T, '--confirm'], local), /read-only/);
assert.throws(() => parsePulseReportActivationArgs(setArgs.filter((_, i) => i !== 7 && i !== 8), local), /--approval-reference is required/);
assert.throws(() => parsePulseReportActivationArgs(setArgs.filter((_, i) => i !== 5 && i !== 6), local), /--expected-revision is required/);
assert.throws(() => parsePulseReportActivationArgs([...setArgs, '--expires-at', '2026-12-01'], local), /explicit offset/);
assert.throws(() => parsePulseReportActivationArgs(['set', '--tenant', T, '--mode', 'send'], local), /--mode/);
assert.throws(() => parsePulseReportActivationArgs([...setArgs, '--feature-flag', 'x'], local), /unknown flag/);
assert.throws(() => parseScope(`kind=team,unit=${U},unit=${U}`), /invalid --scope/);
// Q15: empty host and host/hostaddr query overrides cannot bypass the remote-host guard.
assert.throws(() => assertDatabaseTarget('postgresql:///x'), /explicit host/);
assert.throws(() => assertDatabaseTarget('postgresql://127.0.0.1/x?host=db.example.com'), /non-local database/);
assert.throws(() => assertDatabaseTarget('postgresql://127.0.0.1/x?hostaddr=10.0.0.5'), /non-local database/);
assert.throws(() => assertDatabaseTarget('postgresql://127.0.0.1/x?host=127.0.0.1,db.example.com'), /non-local database/);
assert.throws(() => assertDatabaseTarget('postgresql://127.0.0.1/x?host='), /explicit host/);
assertDatabaseTarget('postgresql://127.0.0.1/x?host=db.example.com', 'db.example.com');
assertDatabaseTarget('postgresql://127.0.0.1/x?host=localhost');

async function database(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.log('Pulse report activation script DB checks skipped: DATABASE_URL is absent');
    return;
  }
  const client = createDbClient(databaseUrl);
  const [tenant] = await client.db.insert(tenants).values({ name: 'RPT10 script ' + randomUUID() }).returning();
  const tenantId = tenant!.id, env = { DATABASE_URL: databaseUrl };
  const [unit] = await client.db.insert(orgUnits).values({ tenantId, customerUnitKey: 'rpt10-unit', name: 'RPT10 unit' }).returning();
  const unitId = unit!.id;
  const args = (extra: string[]) => parsePulseReportActivationArgs(['set', '--tenant', tenantId, '--approval-reference', 'CHG-1', '--operator', 'ops', ...extra], env);
  try {
    const observe = ['--mode', 'observe', '--expected-revision', '0', '--scope', `kind=manager_overall,unit=${unitId.toUpperCase()}`];
    const dry = await runPulseReportActivation(args(observe));
    assert.equal(dry['status'], 'dry_run');
    assert.equal((await runPulseReportActivation(parsePulseReportActivationArgs(['show', '--tenant', tenantId], env)))['control'], null, 'dry run writes nothing');
    const refused = await runPulseReportActivation(args(['--mode', 'deliver', '--expected-revision', '0', '--scope', `kind=manager_overall,unit=${unitId}`, '--confirm']));
    assert.equal(refused['status'], 'invalid');
    assert.deepEqual(refused['errors'], ['deliver_requires_expiry', 'deliver_requires_approved_recipient']);
    // Q9: unknown unit/team/recipient are refused in dry run and confirm; Q11: expiry checked on the DB clock.
    const unknown = await runPulseReportActivation(args(['--mode', 'observe', '--expected-revision', '0', '--scope', `kind=team,unit=${unitId},team=${T},recipient=${P}`, '--scope', `kind=manager_overall,unit=${U}`]));
    assert.equal(unknown['status'], 'invalid');
    assert.deepEqual((unknown['errors'] as string[]).map((e) => e.split(':')[0]).sort(), ['scope_org_team_unknown', 'scope_org_unit_unknown', 'scope_recipient_unknown']);
    const unknownConfirm = await runPulseReportActivation(args(['--mode', 'observe', '--expected-revision', '0', '--scope', `kind=manager_overall,unit=${U}`, '--confirm']));
    assert.equal(unknownConfirm['status'], 'invalid');
    const [{ now }] = await client.sql`select clock_timestamp() now`;
    const past = new Date(new Date(now).getTime() - 1000).toISOString();
    const pastExpiry = await runPulseReportActivation(args([...observe, '--expires-at', past]));
    assert.deepEqual(pastExpiry['errors'], ['expiry_not_in_future']);
    const applied = await runPulseReportActivation(args([...observe, '--confirm']));
    assert.equal(applied['status'], 'applied');
    const stored = await client.sql`select org_unit_id from pulse_report_activation_scopes where tenant_id=${tenantId}`;
    assert.deepEqual(stored.map((r) => r.org_unit_id), [unitId], 'Q14: UUIDs stored lowercase');
    const stale = await runPulseReportActivation(args([...observe, '--confirm']));
    assert.deepEqual([stale['status'], stale['currentRevision']], ['revision_conflict', 1]);
    assert.equal((await runPulseReportActivation(args(['--mode', 'off', '--expected-revision', '1', '--confirm'])))['status'], 'applied');
    const shown = await runPulseReportActivation(parsePulseReportActivationArgs(['show', '--tenant', tenantId], env));
    assert.deepEqual([(shown['control'] as { mode: string; revision: number }).mode, (shown['control'] as { revision: number }).revision, shown['held'], shown['partialDeliveryHeld']], ['off', 2, [], []]);
    const events = await client.sql`select revision,operator,approval_reference,before,after from pulse_report_activation_events where tenant_id=${tenantId} order by revision`;
    assert.deepEqual(events.map((e) => [e.revision, e.operator, e.approval_reference, e.before?.mode ?? null, e.after.mode]), [[1, 'ops', 'CHG-1', null, 'observe'], [2, 'ops', 'CHG-1', 'observe', 'off']]);
  } finally {
    await client.db.delete(tenants).where(eq(tenants.id, tenantId));
    await client.sql.end({ timeout: 2 });
  }
}

database()
  .then(() => console.log('Pulse report activation script tests passed'))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
