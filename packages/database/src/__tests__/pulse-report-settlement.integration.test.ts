import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createDbClient } from '../client';
import * as schema from '../schema';
const url = process.env.DATABASE_URL;
describe.runIf(Boolean(url))('RPT05 all-writer receipt fence', () => {
  const { db, sql: raw } = createDbClient(url!);
  const tenants: string[] = [];
  afterAll(async () => {
    if (tenants.length) await db.delete(schema.tenants).where(inArray(schema.tenants.id, tenants));
    await raw.end();
  });
  async function subject() {
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: 'rpt05-' + randomUUID() })
      .returning();
    tenants.push(t.id);
    const [u] = await db.insert(schema.users).values({ tenantId: t.id }).returning();
    const [c] = await db
      .insert(schema.conversations)
      .values({
        tenantId: t.id,
        userId: u.id,
        channelType: 'dev',
        externalConversationId: randomUUID(),
      })
      .returning();
    return { tenantId: t.id, userId: u.id, conversationId: c.id };
  }
  it('DB authors receipt for admissionless raw writers', async () => {
    const f = await subject();
    const [m] =
      await raw`insert into messages(tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at) values(${f.tenantId},${f.userId},${f.conversationId},'inbound','user','fixture',clock_timestamp()) returning received_at`;
    expect(m.received_at).not.toBeNull();
  });
});

import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportProgressRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-progress.repository';
describe.runIf(Boolean(url))('RPT05 receipt frontier races and independent stages', () => {
  const s = rpt05FixtureSuite();
  afterAll(s.cleanup);
  function gate() {
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    return { wait, release };
  }
  it('SHARE-held ingress commits before first start; reverse lock order stamps after frozen cutoff', async () => {
    const f = await s.fixture();
    const ready = gate(),
      release = gate();
    let id = '';
    const ingress = s.raw.begin(async (tx) => {
      const [row] =
        await tx`insert into messages(tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at) values(${f.tenantId},${f.users[0]},${f.conversations.get(f.users[0])!},'inbound','user','fixture',clock_timestamp()) returning id`;
      id = row.id;
      ready.release();
      await release.wait;
    });
    await ready.wait;
    let finished = false;
    const starting = s.start(f).then((v) => {
      finished = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 25));
    expect(finished).toBe(false);
    release.release();
    await ingress;
    expect((await starting).status).toBe('started');
    expect(
      (
        await s.raw`select m.received_at<f.report_data_cutoff as before from messages m join survey_report_final_timings f on f.tenant_id=m.tenant_id where m.id=${id}`
      )[0].before,
    ).toBe(true);
    const next = await s.fixture();
    const formed = gate(),
      commit = gate();
    const first = s.db.transaction(async (tx) => {
      const result = await new PulseReportFinalScheduleRepository({ client: tx } as never).begin(
        next.tenantId,
        next.cycleId,
        1,
      );
      formed.release();
      await commit.wait;
      return result;
    });
    await formed.wait;
    let admitted = false;
    const later = s.inbound(next, next.users[0]).then((v) => {
      admitted = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 25));
    expect(admitted).toBe(false);
    commit.release();
    await first;
    const input = await later;
    expect(
      (
        await s.raw`select m.received_at>f.report_data_cutoff as after from messages m join survey_report_final_timings f on f.tenant_id=m.tenant_id where m.id=${input.inboundMessageId}`
      )[0].after,
    ).toBe(true);
  });
  it('same subject ingress serializes receipt assignment while different subjects admit concurrently', async () => {
    const f = await s.fixture();
    const ready = gate(),
      release = gate();
    let firstId = '';
    const hold = s.raw.begin(async (tx) => {
      const [row] =
        await tx`insert into messages(tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at)values(${f.tenantId},${f.users[0]},${f.conversations.get(f.users[0])!},'inbound','user','fixture',clock_timestamp())returning id`;
      firstId = row.id;
      ready.release();
      await release.wait;
    });
    await ready.wait;
    let sameDone = false;
    const same = s.inbound(f, f.users[0]).then((v) => {
      sameDone = true;
      return v;
    });
    const different = await s.inbound(f, f.users[1]);
    expect(different.inboundMessageId).toBeTruthy();
    expect(sameDone).toBe(false);
    release.release();
    await hold;
    const second = await same;
    expect(
      (
        await s.raw`select a.received_at<b.received_at before from messages a join messages b on b.id=${second.inboundMessageId} where a.id=${firstId}`
      )[0].before,
    ).toBe(true);
  });
  it('receipt identity freezes, rollback leaves no work, historical explicit native receipts preserve coaching compatibility', async () => {
    const f = await s.fixture();
    const input = await s.inbound(f, f.users[0]);
    await expect(
      s.raw`update messages set received_at=received_at-interval '1 microsecond' where id=${input.inboundMessageId}`,
    ).rejects.toThrow('pulse_receipt_identity_immutable');
    const id = randomUUID();
    await expect(
      s.raw.begin(async (tx) => {
        await tx`insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at) values(${id},${f.tenantId},${f.users[1]},${f.conversations.get(f.users[1])!},'inbound','user','fixture',clock_timestamp())`;
        throw Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(
      await s.raw`select 1 from survey_report_inbound_work where inbound_receipt_id=${id}`,
    ).toHaveLength(0);
    const legacy = await s.inbound(f, f.users[1], 'fixture', new Date().toISOString());
    expect(
      await s.conversation.claimNativeInput({ ...legacy, messageId: legacy.inboundMessageId }),
    ).toBeNull();
    expect(
      (
        await s.raw`select trust from survey_report_inbound_work where inbound_receipt_id=${legacy.inboundMessageId}`
      )[0].trust,
    ).toBe('unverified_explicit_receipt');
  });
  it('A-to-B evidence dependency never holds the native claim order and rejects cyclic or cross-subject dependencies', async () => {
    const f = await s.fixture();
    const a = await s.inbound(f, f.users[0]),
      b = await s.inbound(f, f.users[0]),
      other = await s.inbound(f, f.users[1]);
    await s.capture.capture(a);
    await s.capture.capture(b);
    await s.conversation.deferNativeInput(
      { ...a, messageId: a.inboundMessageId },
      b.inboundMessageId,
    );
    const token = await s.conversation.claimNativeInput({ ...b, messageId: b.inboundMessageId });
    expect(token).toBeTruthy();
    await s.commit(b, { token: token! });
    await s.start(f);
    expect(await s.settlement.observe(s.request(f))).toEqual({
      status: 'pending',
      reason: 'unresolved_stage',
    }); // other is independently pending
    await expect(
      s.raw`insert into survey_report_work_dependencies(tenant_id,user_id,inbound_receipt_id,depends_on_receipt_id)values(${f.tenantId},${f.users[0]},${b.inboundMessageId},${a.inboundMessageId})`,
    ).rejects.toThrow('pulse_input_dependency_cycle');
    await expect(
      s.raw`insert into survey_report_work_dependencies(tenant_id,user_id,inbound_receipt_id,depends_on_receipt_id)values(${f.tenantId},${f.users[0]},${a.inboundMessageId},${other.inboundMessageId})`,
    ).rejects.toThrow();
    await s.capture.capture(other);
    await s.commit(other);
    expect((await s.settlement.observe(s.request(f))).status).toBe('settled');
  });
  it('reclaimed native claim rejects obsolete effects, and recovery rotates past more than100 stuck rows', async () => {
    const f = await s.fixture();
    const a = await s.inbound(f, f.users[0]);
    const first = await s.conversation.claimNativeInput({ ...a, messageId: a.inboundMessageId });
    await s.raw`update survey_report_inbound_work set lease_until=clock_timestamp()-interval '1 second' where inbound_receipt_id=${a.inboundMessageId}`;
    const second = await s.conversation.claimNativeInput({ ...a, messageId: a.inboundMessageId });
    expect(first).not.toBe(second);
    await expect(s.commit(a, { token: first! })).rejects.toThrow('pulse_input_stale_native_claim');
    await s.capture.capture(a);
    await s.commit(a, { token: second! });
    for (let i = 0; i < 105; i++) await s.inbound(f, f.users[1]);
    await s.start(f);
    const repo = new PulseReportProgressRepository(s.database);
    const firstBatch = await repo.recoveryBatch(100),
      secondBatch = await repo.recoveryBatch(100);
    const own = new Set(
      [...firstBatch, ...secondBatch]
        .filter((r) => r.tenant_id === f.tenantId)
        .map((r) => String(r.inbound_receipt_id)),
    );
    expect(own.size).toBe(105);
  });
  it('shared production SQL predicate preserves exact opening/cutoff/end/unlock/stop microseconds', async () => {
    const f = await s.fixture(6, 28);
    const [clock] =
      await s.raw`select o.opened_at::text opening,c.period_end::text ending,(c.period_end-interval '14 days')::text unlock from survey_report_cycle_openings o join survey_cycle_scoring_policies c on c.id=o.cycle_scoring_policy_id where c.id=${f.cycleId}`;
    const [opening] =
      await s.raw`select pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.opening}::timestamptz-interval '1 microsecond',${clock.ending},false) before,pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.opening},${clock.ending},false) equal,pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.ending},'infinity',false) ending`;
    expect(opening).toMatchObject({ before: false, equal: true, ending: false });
    const [cutoff] =
      await s.raw`select pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.opening}::timestamptz+interval '99 microseconds',${clock.opening}::timestamptz+interval '100 microseconds',false) before,pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.opening}::timestamptz+interval '100 microseconds',${clock.opening}::timestamptz+interval '100 microseconds',false) equal,pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.unlock}::timestamptz-interval '1 microsecond','infinity',true) locked,pulse_input_receipt_in_scope(${f.tenantId},${f.users[0]},${f.cycleId},${clock.unlock},'infinity',true) unlocked`;
    expect(cutoff).toMatchObject({ before: true, equal: false, locked: false, unlocked: true });
    const { HierarchyMutationService } =
      await import('../../../../apps/api/src/hierarchy/hierarchy-mutation.service');
    await new HierarchyMutationService(s.database).moveEmployee(
      f.tenantId,
      f.users[0],
      f.unit.id,
      null,
      { type: 'internal_operator', operatorId: 'fixture' } as never,
    );
    const [stopped] =
      await s.raw`select pulse_input_receipt_in_scope(p.tenant_id,p.user_id,p.cycle_scoring_policy_id,p.collection_stopped_at-interval '1 microsecond','infinity',false) before,pulse_input_receipt_in_scope(p.tenant_id,p.user_id,p.cycle_scoring_policy_id,p.collection_stopped_at,'infinity',false) equal from survey_report_participants p where p.tenant_id=${f.tenantId} and p.user_id=${f.users[0]}`;
    expect(stopped).toMatchObject({ before: true, equal: false });
  });

  it('coverage horizon cannot be backdated or removed to certify uninstrumented history', async () => {
    const f = await s.fixture();
    await expect(
      s.raw`update survey_report_input_coverage set supported_from=supported_from-interval '1 day' where tenant_id=${f.tenantId}`,
    ).rejects.toThrow('pulse_coverage_cannot_upgrade_history');
    await expect(
      s.raw`delete from survey_report_input_coverage where tenant_id=${f.tenantId}`,
    ).rejects.toThrow('pulse_coverage_deletion_forbidden');
    await s.raw`update survey_report_input_coverage set supported_from=clock_timestamp() where tenant_id=${f.tenantId}`;
    await s.start(f);
    expect(await s.settlement.observe(s.request(f))).toEqual({
      status: 'blocked',
      reason: 'unverified_receipt',
    });
  });
});
