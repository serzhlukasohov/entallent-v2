import { ensureDevCompanyCalendar } from '../../../../apps/api/scripts/dev-company-calendar';
import { LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY } from '@entalent/application';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDbClient } from '../client';
import * as schema from '../schema';
import { lockPulseReportCycleExact } from '../pulse-report-state';
import { ReportConfigurationConflict, readReportCycleExact } from '../pulse-report-configuration';
import { ReportConfigurationService } from '../../../../apps/api/src/report-configuration/report-configuration.service';
import { CompanyCalendarService } from '../../../../apps/api/src/onboarding/company-calendar.service';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import type { DatabaseService } from '../../../../apps/api/src/database/database.service';

const url = process.env['DATABASE_URL'];
const calendar = {
  timezone: 'Europe/Warsaw',
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
};
describe.runIf(Boolean(url))('RPT-04 configuration and formation (actual PostgreSQL)', () => {
  const client = createDbClient(url!),
    db = client.db,
    raw = client.sql;
  const database = { client: db } as DatabaseService;
  const configs = new ReportConfigurationService(database),
    timings = new PulseReportFinalScheduleRepository(database as never);
  const created: string[] = [];
  afterAll(async () => {
    if (created.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id, created));
    await raw.end();
  });
  async function fixture(
    options: {
      calendar?: boolean;
      locale?: string;
      future?: boolean;
      micro?: boolean;
      opening?: boolean;
    } = {},
  ) {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: `rpt04-${randomUUID()}`,
        locale: options.locale ?? 'en',
        timezone: 'Asia/Tokyo',
      })
      .returning();
    created.push(tenant.id);
    const tenantId = tenant.id;
    if (options.calendar !== false) await configs.saveCalendar(tenantId, calendar, 'fixture', 0);
    const [definition] = await db
      .insert(schema.surveyDefinitions)
      .values({ tenantId, name: 'RPT04 fixture', version: `rpt04-${randomUUID()}`, active: true })
      .returning();
    const questions = await db
      .insert(schema.surveyQuestions)
      .values(
        Object.entries(LEGACY_V2_QUESTION_GROUP_BY_STABLE_KEY).map(
          ([stableKey, questionGroup], displayOrder) => ({
            surveyDefinitionId: definition.id,
            stableKey,
            title: stableKey,
            canonicalMeaning: stableKey,
            dimension: 'engagement',
            questionGroup,
            version: 'fixture',
            displayOrder,
          }),
        ),
      )
      .returning();
    const [policy] = await db
      .insert(schema.surveyScoringPolicies)
      .values({
        tenantId,
        version: 'rpt04-fixture',
        rubrics: Object.fromEntries(
          questions.map((q) => [
            q.stableKey,
            {
              version: 'fixture',
              instructions: 'Synthetic rubric',
              anchors: [
                { score: 0, description: 'low' },
                { score: 100, description: 'high' },
              ],
            },
          ]),
        ),
        approvedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .returning();
    const cycleId = randomUUID();
    if (options.future) {
      await raw`insert into survey_cycle_scoring_policies(id,tenant_id,survey_definition_id,scoring_policy_id,period_start,period_end) values (${cycleId},${tenantId},${definition.id},${policy.id},date_trunc('milliseconds',clock_timestamp())+interval '30 milliseconds',date_trunc('milliseconds',clock_timestamp())+interval '8 days')`;
      await raw`select pg_sleep(0.04)`;
      if (options.opening !== false)
        await raw`insert into survey_report_cycle_openings(tenant_id,cycle_scoring_policy_id) values (${tenantId},${cycleId})`;
    } else {
      // Synthetic already-existing historical cycle: seed only immutable history with triggers
      // bypassed locally, then restore every guard before exercising configuration/formation.
      await raw.begin(async (seed) => {
        await seed`set local session_replication_role=replica`;
        await seed`insert into survey_cycle_scoring_policies(id,tenant_id,survey_definition_id,scoring_policy_id,period_start,period_end,activated_at) values (${cycleId},${tenantId},${definition.id},${policy.id},${options.micro ? '2026-10-19T00:00:00.000001Z' : '2026-10-19T00:00:00Z'},'2026-10-25T23:00:00.000001Z','2026-10-01')`;
        if (options.opening !== false)
          await seed`insert into survey_report_cycle_openings(tenant_id,cycle_scoring_policy_id,opened_at) values (${tenantId},${cycleId},'2026-10-19T00:00:01Z')`;
        await seed`set local session_replication_role=origin`;
      });
    }
    return { tenantId, cycleId, definitionId: definition.id };
  }
  async function count(tenantId: string, table: 'tenant_report_config_revisions' | 'audit_logs') {
    const rows = await raw.unsafe(`select count(*)::int n from ${table} where tenant_id=$1`, [
      tenantId,
    ]);
    return rows[0]!.n;
  }
  it('stale operator conflicts carry an actionable stable diagnostic', () => {
    const error = new ReportConfigurationConflict();
    expect(error.message).toBe('stale_config_revision');
  });
  it('sanctioned dev initialization reconciles prior missing-calendar capture and refreshes its native plan', async () => {
    const f = await fixture({ calendar: false });
    expect(await configs.current(f.tenantId)).toMatchObject({
      revision: 1,
      unavailableReason: 'missing_calendar',
    });
    await timings.refresh(f.tenantId, f.cycleId);
    await ensureDevCompanyCalendar(database, f.tenantId);
    expect(await configs.current(f.tenantId)).toMatchObject({
      revision: 2,
      unavailableReason: null,
    });
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      status: 'scheduled',
      configRevision: 2,
    });
    expect(await count(f.tenantId, 'audit_logs')).toBe(1);
  });
  it('concurrent sanctioned dev initialization creates once and preserves existing extras/locale', async () => {
    const f = await fixture({ calendar: false, locale: 'de' });
    await configs.current(f.tenantId);
    await Promise.all([
      ensureDevCompanyCalendar(database, f.tenantId),
      ensureDevCompanyCalendar(database, f.tenantId),
    ]);
    expect(await count(f.tenantId, 'tenant_report_config_revisions')).toBe(2);
    expect(await count(f.tenantId, 'audit_logs')).toBe(1);
    await configs.saveCalendar(
      f.tenantId,
      {
        ...calendar,
        holidays: ['2026-12-25'],
        dateOverrides: [{ date: '2026-12-24', kind: 'closed' }],
      },
      'fixture',
      2,
    );
    const before = await configs.current(f.tenantId);
    await ensureDevCompanyCalendar(database, f.tenantId);
    expect(await configs.current(f.tenantId)).toEqual(before);
    expect(before).toMatchObject({
      locale: 'de',
      calendar: {
        holidays: ['2026-12-25'],
        dateOverrides: [{ date: '2026-12-24', kind: 'closed' }],
      },
    });
  });
  it('captures actual legacy source now; missing calendar is blocked; base reader stays unchanged', async () => {
    const f = await fixture({ calendar: false, locale: 'de-de' });
    const config = await configs.current(f.tenantId);
    expect(config).toMatchObject({
      revision: 1,
      locale: 'de-DE',
      calendar: null,
      unavailableReason: 'missing_calendar',
    });
    const plan = await timings.refresh(f.tenantId, f.cycleId);
    expect(plan).toMatchObject({
      status: 'blocked',
      blockedReason: 'missing_calendar',
      finalDueAt: null,
    });
    const result = await configs.saveCalendar(f.tenantId, calendar, 'op', 1);
    expect(result.configuration).toMatchObject({ revision: 2, unavailableReason: null });
    expect(await new CompanyCalendarService(database).get(f.tenantId)).toEqual(calendar);
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      configRevision: 2,
      status: 'scheduled',
      finalDueAt: '2026-10-23T16:00:00.000000Z',
    });
  });
  it('preserves omitted extras, explicit clears, current-revision no-op and stale CAS rollback', async () => {
    const f = await fixture();
    await configs.saveCalendar(
      f.tenantId,
      {
        ...calendar,
        holidays: ['2026-10-23'],
        dateOverrides: [
          { date: '2026-10-24', kind: 'working', workStart: '09:00', workEnd: '13:00' },
        ],
      },
      'op',
      1,
    );
    const r = await configs.saveCalendar(f.tenantId, { ...calendar, workEnd: '17:00' }, 'op', 2);
    expect(r.calendar).toMatchObject({
      holidays: ['2026-10-23'],
      dateOverrides: [{ date: '2026-10-24', kind: 'working' }],
    });
    const auditCount = await count(f.tenantId, 'audit_logs');
    const same = await configs.saveCalendar(f.tenantId, { ...calendar, workEnd: '17:00' }, 'op', 3);
    expect(same.changed).toBe(false);
    expect(same.configuration.revision).toBe(3);
    expect(await count(f.tenantId, 'audit_logs')).toBe(auditCount);
    await expect(
      configs.saveCalendar(f.tenantId, { ...calendar, holidays: [] }, 'op', 2),
    ).rejects.toMatchObject({ code: 'stale_config_revision' });
    expect(await count(f.tenantId, 'tenant_report_config_revisions')).toBe(3);
    const clear = await configs.saveCalendar(
      f.tenantId,
      { ...calendar, holidays: [], dateOverrides: [] },
      'op',
      3,
    );
    expect(clear.calendar).toMatchObject({ holidays: [], dateOverrides: [] });
  });
  it('first-save and edit races admit one CAS winner with one audit', async () => {
    for (const initial of [false, true]) {
      const f = await fixture({ calendar: initial });
      const expected = initial ? 1 : 0;
      const results = await Promise.allSettled([
        configs.saveCalendar(f.tenantId, { ...calendar, workEnd: '17:00' }, 'a', expected),
        configs.saveCalendar(f.tenantId, { ...calendar, workEnd: '16:00' }, 'b', expected),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'stale_config_revision' },
      });
      expect(await count(f.tenantId, 'tenant_report_config_revisions')).toBe(expected + 1);
      expect(await count(f.tenantId, 'audit_logs')).toBe(expected + 1);
    }
  });
  it('reconciles a bypassed source on an identical authorized save and blocks starts before repair', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    await raw`update tenant_work_calendars set work_end='17:00' where tenant_id=${f.tenantId}`;
    expect(await timings.begin(f.tenantId, f.cycleId, 1)).toEqual({
      status: 'blocked',
      reason: 'source_out_of_sync',
    });
    const repaired = await configs.saveCalendar(
      f.tenantId,
      { ...calendar, workEnd: '17:00' },
      'op',
      1,
    );
    expect(repaired.configuration.revision).toBe(2);
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      configRevision: 2,
      finalDueAt: '2026-10-23T15:00:00.000000Z',
    });
  });
  it('repairs valid language while retaining invalid calendar and vice versa', async () => {
    const f = await fixture();
    await raw`update tenant_work_calendars set timezone='invalid/timezone' where tenant_id=${f.tenantId}`;
    const language = await configs.saveLanguage(f.tenantId, 'de-de', 1, {
      type: 'internal_operator',
      operatorId: 'op',
    });
    expect(language.configuration).toMatchObject({
      locale: 'de-DE',
      calendar: null,
      unavailableReason: 'invalid_calendar',
    });
    await raw`update tenants set locale='not_a_locale' where id=${f.tenantId}`;
    const cal = await configs.saveCalendar(f.tenantId, calendar, 'op', 2);
    expect(cal.configuration).toMatchObject({ locale: null, unavailableReason: 'invalid_locale' });
    expect(cal.configuration.calendar).toMatchObject(calendar);
    const repaired = await configs.saveLanguage(f.tenantId, 'en', 3, {
      type: 'internal_operator',
      operatorId: 'op',
    });
    expect(repaired.configuration.unavailableReason).toBeNull();
  });
  it('language can be saved first; unsupported explicit locale never falls back', async () => {
    const f = await fixture({ calendar: false, locale: 'zz-ZZ' });
    expect(await configs.current(f.tenantId)).toMatchObject({
      locale: null,
      unavailableReason: 'invalid_locale',
    });
    await expect(
      configs.saveLanguage(f.tenantId, 'zz-ZZ', 1, { type: 'internal_operator', operatorId: 'op' }),
    ).rejects.toMatchObject({ code: 'invalid_locale' });
    const r = await configs.saveLanguage(f.tenantId, 'de', 1, {
      type: 'internal_operator',
      operatorId: 'op',
    });
    expect(r.configuration).toMatchObject({ locale: 'de', unavailableReason: 'missing_calendar' });
  });
  it('refreshes overdue pending plans to blocked rather than rejecting valid company settings', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    const holidays = Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i}`);
    await configs.saveCalendar(f.tenantId, { ...calendar, holidays }, 'op', 1);
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      status: 'blocked',
      configRevision: 2,
      blockedReason: 'no_working_close_in_cycle',
      finalDueAt: null,
    });
  });
  it('atomically starts once with a late DB cutoff after period end, then recovers pinned context before stale/current source checks', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    expect(await timings.begin(f.tenantId, f.cycleId, 0)).toEqual({ status: 'stale_plan' });
    await raw`select pg_sleep(0.15)`;
    const [cycleBound] =
      await raw`select period_end::text as ending from survey_cycle_scoring_policies where id=${f.cycleId}`;
    const both = await Promise.all([
      timings.begin(f.tenantId, f.cycleId, 1),
      timings.begin(f.tenantId, f.cycleId, 1),
    ]);
    expect(both[0]).toEqual(both[1]);
    expect(both[0].status).toBe('started');
    if (both[0].status !== 'started') throw new Error('expected start');
    const context = both[0].context;
    expect(context.formationStartedAt).toBe(context.reportDataCutoff);
    expect(Date.parse(context.reportDataCutoff!)).toBeGreaterThan(Date.parse(cycleBound!.ending));
    expect(context.observedDelayMs).toBeGreaterThan(0);
    await configs.saveLanguage(f.tenantId, 'de', 1, {
      type: 'internal_operator',
      operatorId: 'op',
    });
    await raw`update tenants set locale='bad_locale' where id=${f.tenantId}`;
    expect(await timings.begin(f.tenantId, f.cycleId, 0)).toEqual({ status: 'started', context });
    expect(await timings.read(f.tenantId, f.cycleId)).toEqual(context);
  });
  it('audience B recovers revision 4 even after revision 5 with an expected revision of 3', async () => {
    const f = await fixture();
    for (const [index, locale] of ['fr', 'en', 'de'].entries())
      await configs.saveLanguage(f.tenantId, locale, index + 1, {
        type: 'internal_operator',
        operatorId: 'op',
      });
    const [person] = await db
      .insert(schema.users)
      .values({ tenantId: f.tenantId, locale: 'uk' })
      .returning();
    await timings.refresh(f.tenantId, f.cycleId);
    const a = await timings.begin(f.tenantId, f.cycleId, 4);
    expect(a).toMatchObject({ status: 'started', context: { configRevision: 4, locale: 'de' } });
    await configs.saveLanguage(f.tenantId, 'fr', 4, {
      type: 'internal_operator',
      operatorId: 'op',
    });
    expect(await timings.begin(f.tenantId, f.cycleId, 3)).toEqual(a);
    expect(
      (await db.select().from(schema.users).where(eq(schema.users.id, person.id)))[0].locale,
    ).toBe('uk');
  });
  it('selected DST fold persists as a typed blocked plan and cannot start', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    await configs.saveCalendar(
      f.tenantId,
      { ...calendar, workingDays: [7], workStart: '00:00', workEnd: '02:30' },
      'op',
      1,
    );
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      status: 'blocked',
      blockedReason: 'ambiguous_work_end',
      localDate: '2026-10-25',
      localWorkEnd: '02:30',
    });
    expect(await timings.begin(f.tenantId, f.cycleId, 2)).toEqual({
      status: 'blocked',
      reason: 'ambiguous_work_end',
    });
  });
  it('configuration-edit versus first-start races yield one internally consistent frozen revision', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    const results = await Promise.all([
      timings.begin(f.tenantId, f.cycleId, 1),
      configs.saveLanguage(f.tenantId, 'de', 1, { type: 'internal_operator', operatorId: 'op' }),
    ]);
    const plan = await timings.read(f.tenantId, f.cycleId);
    if (results[0].status === 'started')
      expect(plan).toMatchObject({ status: 'started', configRevision: 1, locale: 'en' });
    else {
      expect(results[0]).toEqual({ status: 'stale_plan' });
      expect(plan).toMatchObject({ status: 'scheduled', configRevision: 2, locale: 'de' });
    }
  });
  it('early calls are not_due and legacy cycles cannot form a context', async () => {
    const f = await fixture({ future: true });
    await timings.refresh(f.tenantId, f.cycleId);
    expect(await timings.begin(f.tenantId, f.cycleId, 1)).toEqual({ status: 'not_due' });
    const legacy = await fixture({ opening: false });
    expect(await timings.refresh(legacy.tenantId, legacy.cycleId)).toBeNull();
    expect(await timings.begin(legacy.tenantId, legacy.cycleId, 1)).toEqual({
      status: 'missing_native_cycle',
    });
  });
  it('rolls back source/revision/plan/audit when a pending-plan write fails', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    // The trigger deliberately rejects an unsupported algorithm independently of the service.
    await raw`create function rpt04_fixture_fail() returns trigger language plpgsql as $$ begin if new.local_work_end='17:00' then raise exception 'synthetic plan failure'; end if; return new; end $$`;
    await raw`create trigger rpt04_fixture_fail before update on survey_report_final_timings for each row execute function rpt04_fixture_fail()`;
    try {
      await expect(
        configs.saveCalendar(f.tenantId, { ...calendar, workEnd: '17:00' }, 'op', 1),
      ).rejects.toThrow();
    } finally {
      await raw`drop trigger rpt04_fixture_fail on survey_report_final_timings`;
      await raw`drop function rpt04_fixture_fail()`;
    }
    expect(await count(f.tenantId, 'tenant_report_config_revisions')).toBe(1);
    expect(await count(f.tenantId, 'audit_logs')).toBe(1);
    expect(await new CompanyCalendarService(database).get(f.tenantId)).toEqual(calendar);
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      configRevision: 1,
      localWorkEnd: '18:00',
    });
  });
  it('independent SQL guards reject invalid shape, tenant/revision mismatch, clocks, early start and changes after start', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    const other = await fixture();
    const updates = [
      sql`status='blocked',blocked_reason=null,final_due_at=null`,
      sql`status='started',report_data_cutoff=null,formation_started_at='2000-01-01'`,
      sql`config_revision=999`,
      sql`final_due_at='2027-01-01'`,
      sql`algorithm_version='made-up'`,
      sql`tenant_id=${other.tenantId}::uuid`,
    ];
    for (const set of updates)
      await expect(
        db.execute(
          sql`update survey_report_final_timings set ${set} where tenant_id=${f.tenantId}::uuid and cycle_scoring_policy_id=${f.cycleId}::uuid`,
        ),
      ).rejects.toThrow();
    const future = await fixture({ future: true });
    await timings.refresh(future.tenantId, future.cycleId);
    await expect(
      raw`update survey_report_final_timings set status='started' where tenant_id=${future.tenantId}`,
    ).rejects.toThrow();
    await expect(
      raw`insert into tenant_report_config_revisions(tenant_id,revision,source_fingerprint,actor_type) values (${other.tenantId},2,'x','fixture')`,
    ).rejects.toThrow();
    await timings.begin(f.tenantId, f.cycleId, 1);
    for (const set of [
      sql`local_work_end='17:00'`,
      sql`formation_started_at=clock_timestamp(),report_data_cutoff=clock_timestamp()`,
      sql`config_revision=2`,
      sql`status='scheduled',formation_started_at=null,report_data_cutoff=null`,
    ])
      await expect(
        db.execute(
          sql`update survey_report_final_timings set ${set} where tenant_id=${f.tenantId}::uuid and cycle_scoring_policy_id=${f.cycleId}::uuid`,
        ),
      ).rejects.toThrow();
    await expect(
      raw`delete from survey_report_final_timings where tenant_id=${f.tenantId}`,
    ).rejects.toThrow();
    await expect(
      raw`update tenant_report_config_revisions set locale='de' where tenant_id=${f.tenantId}`,
    ).rejects.toThrow();
  });
  it('raw calendar SQL takes the tenant lock; exact helper contends with the microsecond cycle trigger key', async () => {
    const f = await fixture({ micro: true });
    await timings.refresh(f.tenantId, f.cycleId);
    await raw.begin(async (hold) => {
      await hold`select id from tenants where id=${f.tenantId} for no key update`;
      await expect(
        raw.begin(async (contender) => {
          await contender`set local lock_timeout='50ms'`;
          await contender`update tenant_work_calendars set work_end='17:00' where tenant_id=${f.tenantId}`;
        }),
      ).rejects.toMatchObject({ code: '55P03' });
    });
    const cycle = await readReportCycleExact(db, f.tenantId, f.cycleId);
    expect(cycle?.periodStart).toBe('2026-10-19T00:00:00.000001Z');
    await db.transaction(async (hold) => {
      await lockPulseReportCycleExact(hold, cycle!);
      await expect(
        raw.begin(async (contender) => {
          await contender`set local lock_timeout='50ms'`;
          await contender`update survey_report_final_timings set local_work_end='17:00' where tenant_id=${f.tenantId}`;
        }),
      ).rejects.toMatchObject({ code: '55P03' });
    });
  });
  it('in-transaction admin authorization rejects revoked and cross-tenant actors without mutation', async () => {
    const f = await fixture();
    const [user] = await db.insert(schema.users).values({ tenantId: f.tenantId }).returning();
    await db.insert(schema.people).values({
      id: user.id,
      tenantId: f.tenantId,
      customerEmployeeId: 'admin',
      workEmail: 'admin@fixture.invalid',
      displayName: 'Admin',
      primaryRole: 'hr',
      pulseParticipant: false,
      lifecycleStatus: 'active',
    });
    await db.insert(schema.orgPersonCapabilities).values({
      tenantId: f.tenantId,
      personId: user.id,
      capability: 'company_admin',
      lifecycleStatus: 'active',
    });
    expect(
      (
        await configs.saveLanguage(f.tenantId, 'de', 1, {
          type: 'company_admin',
          personId: user.id,
        })
      ).configuration.revision,
    ).toBe(2);
    await db
      .update(schema.orgPersonCapabilities)
      .set({ lifecycleStatus: 'inactive' })
      .where(eq(schema.orgPersonCapabilities.personId, user.id));
    await expect(
      configs.saveLanguage(f.tenantId, 'en', 2, { type: 'company_admin', personId: user.id }),
    ).rejects.toThrow('Company Admin');
    const other = await fixture();
    await expect(
      configs.saveLanguage(other.tenantId, 'de', 1, { type: 'company_admin', personId: user.id }),
    ).rejects.toThrow('Company Admin');
    expect(await count(f.tenantId, 'tenant_report_config_revisions')).toBe(2);
  });
  it('native opening and replay initialize plans without changing hierarchy or openedAt', async () => {
    const f = await fixture({ future: true, opening: false });
    const [cycle] = await db
      .select()
      .from(schema.surveyCycleScoringPolicies)
      .where(eq(schema.surveyCycleScoringPolicies.id, f.cycleId));
    const repo = new PulseReportScopeRepository(database as never),
      input = {
        tenantId: f.tenantId,
        surveyDefinitionId: f.definitionId,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
      };
    const first = await repo.openOrgNativeCycle(input);
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({ status: 'scheduled' });
    await configs.saveLanguage(f.tenantId, 'de', 1, {
      type: 'internal_operator',
      operatorId: 'op',
    });
    expect(await repo.openOrgNativeCycle(input)).toEqual(first);
    expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
      locale: 'de',
      configRevision: 2,
    });
  });
  it('new opening and replay both acquire the tenant lock before the cycle lock, and missing configuration blocks only the plan', async () => {
    const f = await fixture({ future: true, opening: false, calendar: false });
    const [cycle] = await db
      .select()
      .from(schema.surveyCycleScoringPolicies)
      .where(eq(schema.surveyCycleScoringPolicies.id, f.cycleId));
    const input = {
      tenantId: f.tenantId,
      surveyDefinitionId: f.definitionId,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
    };
    const timeoutDb = {
      client: {
        transaction: (
          run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<unknown>,
          options: Parameters<typeof db.transaction>[1],
        ) =>
          db.transaction(async (tx) => {
            await tx.execute(sql`set local lock_timeout='50ms'`);
            return run(tx);
          }, options),
      },
    };
    const timedRepo = new PulseReportScopeRepository(timeoutDb as never);
    for (const replay of [false, true]) {
      await raw.begin(async (hold) => {
        await hold`select id from tenants where id=${f.tenantId} for no key update`;
        await expect(timedRepo.openOrgNativeCycle(input)).rejects.toMatchObject({ code: '55P03' });
      });
      if (!replay) {
        await new PulseReportScopeRepository(database as never).openOrgNativeCycle(input);
        expect(await timings.read(f.tenantId, f.cycleId)).toMatchObject({
          status: 'blocked',
          blockedReason: 'missing_calendar',
          finalDueAt: null,
        });
      }
    }
  });
  it('tenant erasure cascades configuration and started timing, while personal state is not part of configuration', async () => {
    const f = await fixture();
    await timings.refresh(f.tenantId, f.cycleId);
    await timings.begin(f.tenantId, f.cycleId, 1);
    await db.delete(schema.tenants).where(eq(schema.tenants.id, f.tenantId));
    expect(
      await raw`select 1 from tenant_report_config_revisions where tenant_id=${f.tenantId}`,
    ).toHaveLength(0);
    expect(
      await raw`select 1 from survey_report_final_timings where tenant_id=${f.tenantId}`,
    ).toHaveLength(0);
  });
});
