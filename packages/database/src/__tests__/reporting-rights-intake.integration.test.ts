import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { Queue, type Job } from 'bullmq';
import * as schema from '../schema';
import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import { encryptField } from '../../../crypto-utils/src/aes-gcm';
import { ApplyReportingRightsAdmissionUseCase, WithdrawReportingPermissionUseCase, reportingRightsRequestId } from '@entalent/application';
import { IngestionService } from '../../../../apps/api/src/channel/ingestion.service';
import { SlackIngestService } from '../../../../apps/api/src/channel/slack-ingest.service';
import { SlackEventsController } from '../../../../apps/api/src/channel/slack-events.controller';
import { ReportingRightsAdmissionRepository } from '../../../../apps/api/src/channel/reporting-rights-interaction';
import { ReportingPermissionRepository } from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import { ReportingRightsRepository } from '../../../../apps/worker/src/survey/repositories/reporting-rights.repository';
import { ReportingRightsProcessor } from '../../../../apps/worker/src/survey/reporting-rights.processor';

/**
 * RPT-09 real ingress: signed Slack interaction body -> API controller/normalizer/ingest -> PostgreSQL admission
 * -> Redis job -> worker processor -> existing withdrawal command -> DB state. Synthetic data, no Slack/model calls.
 */
describe.runIf(Boolean(process.env.DATABASE_URL && process.env.REDIS_URL))('RPT-09 employee reporting-rights intake (PostgreSQL + Redis)', () => {
  const s = rpt05FixtureSuite();
  const secret = 'rpt09-signing-' + randomUUID(), fieldKey = randomBytes(32).toString('hex'), team = 'T' + randomUUID().slice(0, 8).toUpperCase();
  const config = { get: (key: string) => (key === 'FIELD_ENCRYPTION_KEY' ? fieldKey : undefined) };
  const permissions = new ReportingPermissionRepository(s.database);
  const rightsRepo = new ReportingRightsRepository(s.database);
  const withdraw = new WithdrawReportingPermissionUseCase(permissions);
  const apply = new ApplyReportingRightsAdmissionUseCase(rightsRepo, withdraw);
  // Redis-backed pieces are created in beforeAll so a skipped collection never opens connections.
  let rightsQueue: Queue, sendQueue: Queue, controller: SlackEventsController, processor: ReportingRightsProcessor;
  type Fixture = Awaited<ReturnType<typeof s.fixture>>;
  let f: Fixture;
  const slack = new Map<string, { slackUser: string; channel: string; conversationId: string }>();
  let tick = 1_800_000_000;

  async function link(userId: string, conversationId?: string) {
    const slackUser = 'U' + randomUUID().slice(0, 8).toUpperCase(), channel = 'D' + randomUUID().slice(0, 8).toUpperCase();
    await s.db.insert(schema.channelAccounts).values({ tenantId: f.tenantId, userId, channelType: 'slack', externalWorkspaceId: team, externalUserId: slackUser });
    let id = conversationId;
    if (id) await s.db.update(schema.conversations).set({ channelType: 'slack', externalConversationId: channel }).where(eq(schema.conversations.id, id));
    else id = (await s.db.insert(schema.conversations).values({ tenantId: f.tenantId, userId, channelType: 'slack', externalConversationId: channel }).returning())[0]!.id;
    slack.set(userId, { slackUser, channel, conversationId: id });
  }
  const openRaw = (userId: string, turnKey: string = randomUUID(), locale = 'en') => {
    const route = slack.get(userId)!;
    return rightsRepo.openMenu({ tenantId: f.tenantId, userId, conversationId: route.conversationId, channelType: 'slack', externalWorkspaceId: team, externalChannelId: route.channel, locale, turnKey });
  };
  const openMenu = async (userId: string, turnKey?: string, locale?: string) => {
    const opening = await openRaw(userId, turnKey, locale);
    if (opening?.status !== 'menu') throw Error('expected menu');
    return opening;
  };
  const rightsMessages = (userId: string) => s.db.select().from(schema.messages).where(and(eq(schema.messages.userId, userId), eq(schema.messages.messageType, 'reporting_rights')));
  function signed(body: unknown, signingSecret = secret) {
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
    return { req: { rawBody, headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature } }, form: { payload: JSON.stringify(body) } };
  }
  /** One Slack block_actions click through the signed HTTP interaction endpoint. */
  async function click(userId: string, action: string, value: string, over: { channel?: string; slackUser?: string; actionTs?: string; signingSecret?: string } = {}) {
    const route = slack.get(userId)!;
    const body = {
      type: 'block_actions', team: { id: team }, user: { id: over.slackUser ?? route.slackUser }, channel: { id: over.channel ?? route.channel },
      container: { message_ts: '1700000000.000100' }, actions: [{ action_id: `reporting_rights:${action}`, value, action_ts: over.actionTs ?? `${tick++}.000200` }],
    };
    const r = signed(body, over.signingSecret);
    return controller.handleInteraction(r.req as never, r.form);
  }
  /** Worker: consume Redis-transported rights jobs through the processor. */
  async function drain(): Promise<unknown[]> {
    const results: unknown[] = [];
    for (;;) {
      const jobs = (await rightsQueue.getJobs(['waiting', 'delayed', 'prioritized'])).filter(Boolean) as Job[];
      if (!jobs.length) return results;
      for (const job of jobs) { results.push(await processor.process(job as never)); await job.remove(); }
    }
  }
  const latestConfirmMenu = async (userId: string) => (await s.db.select().from(schema.surveyReportingRightsMenus)
    .where(and(eq(schema.surveyReportingRightsMenus.userId, userId), eq(schema.surveyReportingRightsMenus.kind, 'confirm'))))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
  const admissions = (userId: string) => s.db.select().from(schema.surveyReportingRightsAdmissions).where(eq(schema.surveyReportingRightsAdmissions.userId, userId));
  const requests = (userId: string) => s.db.select().from(schema.surveyReportingWithdrawalRequests).where(eq(schema.surveyReportingWithdrawalRequests.userId, userId));
  const permission = async (userId: string) => (await s.db.select().from(schema.surveyReportingPermissions).where(eq(schema.surveyReportingPermissions.userId, userId)))[0];
  const intermediate = () => s.inputs.execute({ ...s.request(f, 'intermediate'), scopeId: f.teamScopeId, projection: 'team_lead_overall' as const });
  const requiredCount = async () => { const r = await intermediate(); return r.status === 'prepared' ? r.metrics.find((m) => m.metricKey === 'autonomy')?.requiredCount : r.status; };

  beforeAll(async () => {
    const redis = new URL(process.env.REDIS_URL!);
    const connection = { host: redis.hostname, port: Number(redis.port) || 6379, db: Number(redis.pathname.slice(1) || 0) };
    rightsQueue = new Queue('rpt09-rights-' + randomUUID(), { connection });
    sendQueue = new Queue('rpt09-send-' + randomUUID(), { connection });
    const ingestion = new IngestionService(s.database, config as never);
    const pipeline = new SlackIngestService(ingestion, { isNew: async () => true } as never, { add: async () => undefined } as never,
      { add: async () => { throw Error('onboarding queue must not receive rights clicks'); } } as never,
      new ReportingRightsAdmissionRepository(s.database), rightsQueue as never);
    controller = new SlackEventsController(ingestion, pipeline, config as never);
    processor = new ReportingRightsProcessor(rightsRepo, apply, rightsQueue as never, sendQueue as never);
    f = await s.fixture(10);
    await s.db.insert(schema.workspaceConnections).values({ tenantId: f.tenantId, channelType: 'slack', externalWorkspaceId: team, encryptedCredentials: encryptField(JSON.stringify({ signingSecret: secret, botToken: 'xoxb-synthetic' }), fieldKey) });
    for (const userId of f.users) await link(userId, f.conversations.get(userId));
  });
  afterAll(async () => {
    for (const queue of [rightsQueue, sendQueue]) if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    await s.cleanup();
  });

  it('full withdrawal: proposal withdraws nothing; Withdraw all + Confirm admits once, applies once, confirms; 10 -> 8 denominator, delivered bytes intact', async () => {
    const [u0, u1] = [f.users[0]!, f.users[1]!];
    expect(await requiredCount()).toBe(8);
    const [legacyTeam] = await s.db.insert(schema.teams).values({ tenantId: f.tenantId, name: 'RPT09 historical pilot team' }).returning();
    const [cohort] = await s.db.insert(schema.surveyReportingCohorts).values({ tenantId: f.tenantId, teamId: legacyTeam!.id, surveyDefinitionId: f.definitionId,
      periodStart: new Date(f.cycle.periodStart.getTime() - 172_800_000), periodEnd: new Date(f.cycle.periodStart.getTime() - 86_400_000), rosterUserIds: f.users, openedAt: new Date(f.cycle.periodStart.getTime() - 172_800_000) }).returning();
    const snapshots = await s.db.insert(schema.surveyV2ReportSnapshots).values([
      { status: 'delivered', deliveryAttemptedAt: new Date(), slackExternalMessageId: 'synthetic-delivered' }, { status: 'pending' },
    ].map((state, i) => ({ tenantId: f.tenantId, teamId: legacyTeam!.id, reportingCohortId: cohort!.id, questionGroup: 'autonomy', reportKind: 'intermediate', snapshotVersion: i + 1,
      managerPayload: { synthetic: i }, contributorUserIds: [u0], sourceQuestionInsightIds: [], policyVersion: 'fixture-v1', calculationVersion: 'fixture-v1', ...state }))).returning();

    const menu = await openMenu(u0);
    expect(menu!.actions.map((a) => a.actionId)).toEqual(['reporting_rights:full', 'reporting_rights:topics']);
    expect(await requests(u0)).toHaveLength(0);
    expect(await permission(u0)).toBeUndefined();

    await click(u0, 'full', menu!.menuId);
    expect(await admissions(u0)).toHaveLength(0);
    await drain();
    const confirm = await latestConfirmMenu(u0);
    expect(confirm).toMatchObject({ targetKind: 'full_reporting', lineageIds: [], parentMenuId: menu!.menuId });
    const [prompt] = await s.db.select().from(schema.messages).where(and(eq(schema.messages.userId, u0), eq(schema.messages.messageType, 'reporting_rights')));
    expect((prompt!.metadata as Record<string, unknown>)['reportingRightsActions']).toEqual([
      { actionId: 'reporting_rights:confirm', label: 'Confirm', value: confirm.id }, { actionId: 'reporting_rights:cancel', label: 'Cancel', value: confirm.id },
    ]);
    expect(await permission(u0)).toBeUndefined();

    // Duplicate and concurrent Confirm clicks: one admission, one withdrawal request, one revision.
    const ts = `${tick++}.000300`;
    await Promise.all([click(u0, 'confirm', confirm.id, { actionTs: ts }), click(u0, 'confirm', confirm.id, { actionTs: ts }), click(u0, 'confirm', confirm.id)]);
    const [admission] = await admissions(u0);
    expect(await admissions(u0)).toHaveLength(1);
    expect(admission).toMatchObject({ status: 'admitted', requestId: reportingRightsRequestId(admission!.id), menuId: confirm.id });
    const applyJobs = (await rightsQueue.getJobs(['waiting'])).filter((j) => j?.name === 'apply');
    expect(applyJobs.map((j) => j!.id)).toEqual([`reporting-rights-apply-${admission!.id}`]);
    await Promise.all([apply.execute({ tenantId: f.tenantId, admissionId: admission!.id }), apply.execute({ tenantId: f.tenantId, admissionId: admission!.id }), drain()]);
    expect(await requests(u0)).toHaveLength(1);
    expect(await permission(u0)).toMatchObject({ revision: 1, fullReportingDenied: true });
    const [request] = await requests(u0);
    expect(request).toMatchObject({ requestId: admission!.requestId, verificationId: admission!.id, provenanceKind: 'verified_subject', personId: u0, receivedAt: admission!.receivedAt });
    const [settled] = await admissions(u0);
    expect(settled).toMatchObject({ status: 'applied', permissionRevision: 1, failureReason: null });
    const [done] = await s.db.select().from(schema.messages).where(eq(schema.messages.id, settled!.confirmationMessageId!));
    expect(done!.text).toBe('Done. Your pulse insights will no longer be used in reports.');
    expect((await sendQueue.getJobs(['waiting'])).map((j) => j!.data.messageId)).toContain(done!.id);

    // The same admission-derived command replays rather than creating a second request or revision.
    const derived = { tenantId: f.tenantId, userId: u0, personId: u0, requestId: admission!.requestId, target: { kind: 'full_reporting' as const },
      provenance: { kind: 'verified_subject' as const, tenantId: f.tenantId, userId: u0, personId: u0, verificationId: admission!.id, receivedAt: admission!.receivedAt } };
    const replays = await Promise.all([withdraw.execute(derived), withdraw.execute(derived)]);
    expect(replays.every((r) => r.replayed && r.permissionRevision === 1)).toBe(true);
    expect(await permission(u0)).toMatchObject({ revision: 1 });
    // P6: a fully withdrawn subject is not offered Withdraw all again, and no menu row is created.
    const menusBefore = (await s.db.select().from(schema.surveyReportingRightsMenus).where(eq(schema.surveyReportingRightsMenus.userId, u0))).length;
    expect(await openRaw(u0)).toEqual({ status: 'already_withdrawn' });
    expect(await s.db.select().from(schema.surveyReportingRightsMenus).where(eq(schema.surveyReportingRightsMenus.userId, u0))).toHaveLength(menusBefore);

    const second = await openMenu(u1);
    await click(u1, 'full', second!.menuId); await drain();
    await click(u1, 'confirm', (await latestConfirmMenu(u1)).id); await drain();
    expect(await requiredCount()).toBe(7);
    const after = await s.db.select().from(schema.surveyV2ReportSnapshots).where(inArray(schema.surveyV2ReportSnapshots.id, snapshots.map((x) => x.id)));
    expect(JSON.stringify(after.find((row) => row.id === snapshots[0]!.id))).toBe(JSON.stringify(snapshots[0]));
    expect(after.find((row) => row.id === snapshots[1]!.id)?.status).toBe('cancelled');
  });

  it('partial: Choose topics pages, one topic + Confirm excludes only that lineage; stale repeat is rejected content-free; nothing-to-withdraw offers full only', async () => {
    const u2 = f.users[2]!;
    const before = await requiredCount();
    const menu = await openMenu(u2);
    const [root] = await s.db.select().from(schema.surveyReportingRightsMenus).where(eq(schema.surveyReportingRightsMenus.id, menu!.menuId));
    expect(root!.lineageIds.length).toBeGreaterThan(1);
    await click(u2, 'topics', `${menu!.menuId}:0`); await drain();
    const [topicsMessage] = await s.db.select().from(schema.messages).where(and(eq(schema.messages.userId, u2), eq(schema.messages.messageType, 'reporting_rights')));
    const topicButtons = (topicsMessage!.metadata as { reportingRightsActions: { actionId: string; value: string }[] }).reportingRightsActions;
    expect(topicButtons.length).toBeLessThanOrEqual(5);
    expect(topicButtons.filter((b) => b.actionId === 'reporting_rights:topic').map((b) => b.value)).toEqual(
      root!.lineageIds.slice(0, 4).map((_, i) => `${menu!.menuId}:${i}`));
    expect(topicButtons.some((b) => b.value.includes(root!.lineageIds[0]!))).toBe(false);

    await click(u2, 'topic', `${menu!.menuId}:1`); await drain();
    const confirm = await latestConfirmMenu(u2);
    expect(confirm).toMatchObject({ targetKind: 'partial_reporting', lineageIds: [root!.lineageIds[1]] });
    await click(u2, 'confirm', confirm.id); await drain();
    const excluded = await s.db.select().from(schema.surveyReportingLineageExclusions).where(eq(schema.surveyReportingLineageExclusions.userId, u2));
    expect(excluded.map((e) => e.lineageId)).toEqual([root!.lineageIds[1]]);
    expect(await permission(u2)).toMatchObject({ revision: 1, fullReportingDenied: false });
    expect(await requiredCount()).toBe(before);

    await click(u2, 'topic', `${menu!.menuId}:1`); await drain();
    const stale = await latestConfirmMenu(u2);
    await click(u2, 'confirm', stale.id); await drain();
    const rejected = (await admissions(u2)).find((a) => a.menuId === stale.id)!;
    expect(rejected).toMatchObject({ status: 'rejected', failureReason: 'stale_target', permissionRevision: null });
    const [notice] = await s.db.select().from(schema.messages).where(eq(schema.messages.id, rejected.confirmationMessageId!));
    expect(notice!.text).toBe('This option is no longer available, so nothing was changed. You can ask me again to see the current options.');
    expect(await requests(u2)).toHaveLength(1);
    expect(await permission(u2)).toMatchObject({ revision: 1 });
    expect((await openMenu(u2)).actions).toHaveLength(2);

    const [outsider] = await s.db.insert(schema.users).values({ tenantId: f.tenantId }).returning();
    await s.db.insert(schema.people).values({ id: outsider!.id, tenantId: f.tenantId, customerEmployeeId: outsider!.id, workEmail: outsider!.id + '@fixture.invalid', displayName: 'outsider', primaryRole: 'employee', pulseParticipant: true, lifecycleStatus: 'active' });
    await link(outsider!.id);
    expect((await openMenu(outsider!.id)).actions.map((a) => a.actionId)).toEqual(['reporting_rights:full']);
  });

  it('forged or foreign clicks never create an admission or job; the owner of a stale menu gets a no-change notice', async () => {
    const [u3, u4] = [f.users[3]!, f.users[4]!];
    const menu = await openMenu(u3);
    await click(u3, 'full', menu!.menuId); await drain();
    const confirm = await latestConfirmMenu(u3);
    const total = async () => (await s.db.select().from(schema.surveyReportingRightsAdmissions).where(eq(schema.surveyReportingRightsAdmissions.tenantId, f.tenantId))).length;
    const baseline = await total();
    await expect(click(u3, 'confirm', confirm.id, { signingSecret: 'forged-secret' })).rejects.toThrow('Invalid Slack signature');
    await click(u3, 'confirm', confirm.id, { channel: 'C' + randomUUID().slice(0, 8) });
    await click(u3, 'confirm', confirm.id, { slackUser: 'UUNLINKED' + randomUUID().slice(0, 4) });
    await click(u4, 'confirm', confirm.id);
    await click(u3, 'confirm', confirm.id, { channel: slack.get(u4)!.channel });
    await click(u3, 'confirm', `${confirm.id}:0`);
    await click(u3, 'confirm', '00000000-0000-4000-8000-0000000000ff');
    expect((await rightsQueue.getJobs(['waiting', 'delayed'])).filter(Boolean)).toHaveLength(0);
    const noticesBefore = (await rightsMessages(u3)).length;
    await s.raw`update survey_reporting_rights_menus set created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' where id = ${confirm.id}`;
    await click(u3, 'confirm', confirm.id);
    expect(await total()).toBe(baseline);
    expect((await rightsQueue.getJobs(['waiting', 'delayed'])).filter((j) => j?.name === 'apply')).toHaveLength(0);
    await drain();
    const expiredNotice = (await rightsMessages(u3)).filter((m) => (m.metadata as Record<string, unknown>)['reportingRightsView'] === 'unavailable');
    expect(expiredNotice).toHaveLength(1);
    expect(expiredNotice[0]!.text).toBe('This option is no longer available, so nothing was changed. You can ask me again to see the current options.');
    expect((expiredNotice[0]!.metadata as Record<string, unknown>)['reportingRightsActions']).toBeUndefined();
    expect((await rightsMessages(u3)).length).toBe(noticesBefore + 1);
    expect(await permission(u3)).toBeUndefined();
    // Cancel then Confirm on the same menu: nothing changes.
    const fresh = await openMenu(u3);
    await click(u3, 'full', fresh!.menuId); await drain();
    const cancelled = await latestConfirmMenu(u3);
    await click(u3, 'cancel', cancelled.id); await drain();
    await click(u3, 'confirm', cancelled.id); await drain();
    expect(await total()).toBe(baseline);
    expect((await rightsMessages(u3)).filter((m) => (m.metadata as Record<string, unknown>)['reportingRightsView'] === 'unavailable')).toHaveLength(2);
    expect(await permission(u3)).toBeUndefined();
  });

  it('lost Redis job: the DB sweep re-enqueues the admission and it applies once; an idempotency conflict settles typed with no partial state', async () => {
    const [u5, u6] = [f.users[5]!, f.users[6]!];
    const menu = await openMenu(u5);
    await click(u5, 'full', menu!.menuId); await drain();
    await click(u5, 'confirm', (await latestConfirmMenu(u5)).id);
    const [admission] = await admissions(u5);
    await rightsQueue.obliterate({ force: true });
    expect(await requests(u5)).toHaveLength(0);
    await s.raw`update survey_reporting_rights_admissions set received_at = received_at - interval '1 minute' where id = ${admission!.id}`;
    expect(await processor.sweep()).toMatchObject({ admissions: 1 });
    await drain();
    expect(await requests(u5)).toHaveLength(1);
    expect((await admissions(u5))[0]).toMatchObject({ status: 'applied', permissionRevision: 1 });
    expect(await processor.sweep()).toMatchObject({ admissions: 0 });
    await drain();
    expect(await requests(u5)).toHaveLength(1);

    const conflictMenu = await openMenu(u6);
    await click(u6, 'full', conflictMenu!.menuId); await drain();
    await click(u6, 'confirm', (await latestConfirmMenu(u6)).id);
    const [conflict] = await admissions(u6);
    await permissions.withdraw({ tenantId: f.tenantId, userId: u6, personId: u6, requestId: conflict!.requestId, target: { kind: 'full_reporting' },
      provenance: { kind: 'authorized_internal_rights_request', tenantId: f.tenantId, userId: u6, personId: u6, verificationId: randomUUID(), receivedAt: new Date() } });
    await drain();
    const [failed] = await admissions(u6);
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'idempotency_conflict', permissionRevision: null });
    const [notApplied] = await s.db.select().from(schema.messages).where(eq(schema.messages.id, failed!.confirmationMessageId!));
    expect(notApplied!.text).toBe('Your request could not be completed, so nothing was changed. Please ask me again later.');
    expect(await requests(u6)).toHaveLength(1);
    expect(await permission(u6)).toMatchObject({ revision: 1 });
  });

  it('poison admission: attempts are persisted and it settles failed with a notice instead of being re-enqueued forever', async () => {
    const u7 = f.users[7]!;
    const menu = await openMenu(u7);
    await click(u7, 'full', menu.menuId); await drain();
    await click(u7, 'confirm', (await latestConfirmMenu(u7)).id);
    await rightsQueue.obliterate({ force: true });
    const [admission] = await admissions(u7);
    const poison = new ApplyReportingRightsAdmissionUseCase(rightsRepo, { execute: async () => { throw Error('synthetic_transient_failure'); } });
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(poison.execute({ tenantId: f.tenantId, admissionId: admission!.id })).rejects.toThrow('synthetic_transient_failure');
      expect((await admissions(u7))[0]).toMatchObject({ status: 'admitted', applyAttempts: attempt });
    }
    expect(await poison.execute({ tenantId: f.tenantId, admissionId: admission!.id })).toMatchObject({ outcome: 'settled', status: 'failed' });
    const [settled] = await admissions(u7);
    expect(settled).toMatchObject({ status: 'failed', failureReason: 'apply_attempts_exhausted', applyAttempts: 6 });
    expect((await s.db.select().from(schema.messages).where(eq(schema.messages.id, settled!.confirmationMessageId!)))[0]!.text)
      .toBe('Your request could not be completed, so nothing was changed. Please ask me again later.');
    expect(await requests(u7)).toHaveLength(0);
    await s.raw`update survey_reporting_rights_admissions set received_at = received_at - interval '5 minutes' where id = ${admission!.id}`;
    expect(await processor.sweep()).toMatchObject({ admissions: 0 });
  });

  it('root menus are idempotent per turn, steps reuse the root locale, and topic indexes survive a missing title', async () => {
    const u8 = f.users[8]!, u9 = f.users[9]!;
    const turn = randomUUID();
    const first = await openMenu(u8, turn, 'de');
    const again = await openMenu(u8, turn, 'en');
    expect(again.menuId).toBe(first.menuId);
    expect(await s.db.select().from(schema.surveyReportingRightsMenus).where(eq(schema.surveyReportingRightsMenus.userId, u8))).toHaveLength(1);
    await click(u8, 'full', first.menuId); await drain();
    const confirm = await latestConfirmMenu(u8);
    expect(confirm.locale).toBe('de');
    await click(u8, 'confirm', confirm.id); await drain();
    expect((await rightsMessages(u8)).map((m) => (m.metadata as Record<string, unknown>)['reportingRightsLocale'])).toEqual(['de', 'de']);

    const menu = await openMenu(u9);
    const [root] = await s.db.select().from(schema.surveyReportingRightsMenus).where(eq(schema.surveyReportingRightsMenus.id, menu.menuId));
    expect(root!.lineageIds.length).toBeGreaterThan(4);
    // Synthetic corruption (immutability trigger bypassed for setup only): the lineage's definition no longer resolves.
    await s.raw.begin(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update survey_report_question_lineages set survey_question_id = ${randomUUID()} where id = ${root!.lineageIds[1]!}`;
    });
    await click(u9, 'topics', `${menu.menuId}:0`); await drain();
    const [page] = await rightsMessages(u9);
    const values = (page!.metadata as { reportingRightsActions: { actionId: string; value: string }[] }).reportingRightsActions
      .filter((a) => a.actionId === 'reporting_rights:topic').map((a) => a.value);
    expect(values).toEqual([0, 2, 3].map((i) => `${menu.menuId}:${i}`));
    await click(u9, 'topic', `${menu.menuId}:2`); await drain();
    expect(await latestConfirmMenu(u9)).toMatchObject({ lineageIds: [root!.lineageIds[2]] });
  });
});
