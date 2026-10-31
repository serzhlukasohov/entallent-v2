import { describe, expect, it, vi } from 'vitest';
import { REPORTING_RIGHTS_TOPICS_PER_PAGE, SituationClassificationSchema, type PulseLanguageResource } from '@entalent/contracts';
import {
  ApplyReportingRightsAdmissionUseCase, ReportingRightsIntakeUseCase, reportingRightsButton, reportingRightsRequestId, reportingRightsRootActions,
  reportingRightsText, reportingRightsTopicButtons, reportingRightsTopicPage, reportingRightsTopicTitle,
} from './reporting-rights-intake.use-case';
import { WithdrawReportingPermissionUseCase } from './withdraw-reporting-permission.use-case';
import { buildReplyPlan, withReportingRights } from '../utils/reply-plan';
import type { ReportingRightsAdmissionRecord, ReportingRightsMenuRecord, VerifiedReportingRightsClick } from '../ports/reporting-rights.port';

const T = '00000000-0000-4000-8000-000000000001', U = '00000000-0000-4000-8000-000000000002';
const ROOT = '00000000-0000-4000-8000-0000000000a1', CONFIRM = '00000000-0000-4000-8000-0000000000a2';
const L = ['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b3'];
const menu = (over: Partial<ReportingRightsMenuRecord> = {}): ReportingRightsMenuRecord => ({
  id: ROOT, tenantId: T, userId: U, conversationId: 'c', externalChannelId: 'D1', kind: 'root', targetKind: null,
  lineageIds: L, expired: false, cancelled: false, admitted: false, ...over,
});
const click = (over: Partial<VerifiedReportingRightsClick> = {}): VerifiedReportingRightsClick => ({
  tenantId: T, userId: U, channelType: 'slack', externalWorkspaceId: 'W', externalUserId: 'S', externalChannelId: 'D1',
  action: 'full', menuId: ROOT, actionTs: '1.1', ...over,
});
const admission = (over: Partial<ReportingRightsAdmissionRecord> = {}): ReportingRightsAdmissionRecord => ({
  id: 'ad-1', tenantId: T, userId: U, menuId: CONFIRM, requestId: reportingRightsRequestId('ad-1'), targetKind: 'full_reporting',
  lineageIds: [], receivedAt: new Date('2026-10-31T10:00:00.123Z'), status: 'admitted', confirmationMessageId: null, ...over,
});
function intake(found: ReportingRightsMenuRecord | null) {
  const store = {
    findMenu: vi.fn().mockResolvedValue(found),
    stageConfirm: vi.fn().mockResolvedValue({ menuId: CONFIRM }),
    cancel: vi.fn().mockResolvedValue(true),
    admit: vi.fn().mockResolvedValue({ status: 'admitted', admission: admission(), created: true }),
  };
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
  return { store, jobs, useCase: new ReportingRightsIntakeUseCase(store, jobs) };
}

describe('RPT-09 reporting-rights intake (API side)', () => {
  it('Withdraw all stages a confirm menu and withdraws nothing', async () => {
    const t = intake(menu());
    expect(await t.useCase.handleClick(click())).toEqual({ outcome: 'staged', view: 'confirm', menuId: CONFIRM, page: 0, enqueued: true });
    expect(t.store.stageConfirm).toHaveBeenCalledWith({ subject: { tenantId: T, userId: U }, parentMenuId: ROOT, targetKind: 'full_reporting', lineageIds: [] });
    expect(t.store.admit).not.toHaveBeenCalled();
    expect(t.jobs.enqueue).toHaveBeenCalledWith({ kind: 'render', tenantId: T, menuId: CONFIRM, view: 'confirm', page: 0, clickTs: '1.1' });
  });

  it('Choose topics pages over the stored lineage set; a topic resolves server-side by index', async () => {
    const t = intake(menu());
    expect(await t.useCase.handleClick(click({ action: 'topics', index: 0 }))).toMatchObject({ outcome: 'staged', view: 'topics', menuId: ROOT });
    expect(await t.useCase.handleClick(click({ action: 'topics', index: 1 }))).toEqual({ outcome: 'dropped', reason: 'option_out_of_range' });
    expect(await t.useCase.handleClick(click({ action: 'topic', index: 1 }))).toMatchObject({ outcome: 'staged', view: 'confirm' });
    expect(t.store.stageConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ targetKind: 'partial_reporting', lineageIds: [L[1]] }));
    expect(await t.useCase.handleClick(click({ action: 'topic', index: 3 }))).toEqual({ outcome: 'dropped', reason: 'option_out_of_range' });
    expect(await t.useCase.handleClick(click({ action: 'topic' }))).toEqual({ outcome: 'dropped', reason: 'option_out_of_range' });
  });

  it('Confirm commits one admission and enqueues the apply job', async () => {
    const t = intake(menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', lineageIds: [] }));
    expect(await t.useCase.handleClick(click({ action: 'confirm', menuId: CONFIRM }))).toEqual({ outcome: 'admitted', admissionId: 'ad-1', created: true, enqueued: true });
    expect(t.store.admit).toHaveBeenCalledWith(expect.objectContaining({ subject: { tenantId: T, userId: U }, menuId: CONFIRM, actionTs: '1.1', externalUserId: 'S' }));
    expect(t.jobs.enqueue).toHaveBeenCalledWith({ kind: 'apply', tenantId: T, admissionId: 'ad-1' });
  });

  it('a lost queue after admission still reports admitted; the sweep repairs it', async () => {
    const t = intake(menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', lineageIds: [] }));
    t.jobs.enqueue.mockRejectedValueOnce(new Error('redis down'));
    expect(await t.useCase.handleClick(click({ action: 'confirm', menuId: CONFIRM }))).toEqual({ outcome: 'admitted', admissionId: 'ad-1', created: true, enqueued: false });
  });

  it('a duplicate click returns the existing admission (same requestId)', async () => {
    const t = intake(menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', lineageIds: [], admitted: true }));
    t.store.admit.mockResolvedValue({ status: 'admitted', admission: admission(), created: false });
    expect(await t.useCase.handleClick(click({ action: 'confirm', menuId: CONFIRM, actionTs: '2.2' }))).toMatchObject({ outcome: 'admitted', admissionId: 'ad-1', created: false });
  });

  it.each([
    ['other subject token or unknown menu', null, click(), 'menu_not_found'],
    ['menu rendered in another channel', menu({ externalChannelId: 'D2' }), click(), 'channel_mismatch'],
    ['confirm on a root menu', menu(), click({ action: 'confirm' }), 'action_menu_mismatch'],
    ['topic on a confirm menu', menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting' }), click({ action: 'topic', menuId: CONFIRM, index: 0 }), 'invalid_value'],
  ] as const)('drops %s silently: no admission, no job, no notice', async (_label, found, input, reason) => {
    const t = intake(found as ReportingRightsMenuRecord | null);
    expect(await t.useCase.handleClick(input)).toEqual({ outcome: 'dropped', reason });
    expect(t.store.admit).not.toHaveBeenCalled();
    expect(t.jobs.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['expired root token', menu({ expired: true }), click(), 'menu_expired', 'unavailable', ROOT],
    ['cancelled confirm', menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', cancelled: true }), click({ action: 'confirm', menuId: CONFIRM }), 'menu_cancelled', 'unavailable', CONFIRM],
    ['expired confirm', menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', expired: true }), click({ action: 'confirm', menuId: CONFIRM }), 'menu_expired', 'unavailable', CONFIRM],
    ['cancel after admission', menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', admitted: true }), click({ action: 'cancel', menuId: CONFIRM }), 'menu_already_admitted', 'already_submitted', CONFIRM],
  ] as const)('tells the owner of a %s that nothing changed, without admission', async (_label, found, input, reason, view, menuId) => {
    const t = intake(found);
    expect(await t.useCase.handleClick(input)).toEqual({ outcome: 'dropped', reason, notice: view, enqueued: true });
    expect(t.store.admit).not.toHaveBeenCalled();
    expect(t.jobs.enqueue).toHaveBeenCalledWith({ kind: 'render', tenantId: T, menuId, view, page: 0, clickTs: '1.1' });
  });

  it('a duplicate Confirm on an admitted but now expired menu replays instead of claiming nothing changed', async () => {
    const t = intake(menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', expired: true, admitted: true }));
    t.store.admit.mockResolvedValue({ status: 'admitted', admission: admission(), created: false });
    expect(await t.useCase.handleClick(click({ action: 'confirm', menuId: CONFIRM }))).toMatchObject({ outcome: 'admitted', admissionId: 'ad-1', created: false });
  });

  it('a hung queue after a committed admission does not hold the Slack ack', async () => {
    vi.useFakeTimers();
    try {
      const t = intake(menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', lineageIds: [] }));
      t.jobs.enqueue.mockReturnValue(new Promise(() => undefined));
      const pending = t.useCase.handleClick(click({ action: 'confirm', menuId: CONFIRM }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ outcome: 'admitted', admissionId: 'ad-1', created: true, enqueued: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Cancel marks the confirm menu cancelled and renders a no-change notice', async () => {
    const t = intake(menu({ id: CONFIRM, kind: 'confirm', targetKind: 'full_reporting', lineageIds: [] }));
    expect(await t.useCase.handleClick(click({ action: 'cancel', menuId: CONFIRM }))).toMatchObject({ outcome: 'staged', view: 'cancelled' });
    expect(t.store.cancel).toHaveBeenCalledWith({ tenantId: T, userId: U }, CONFIRM);
    expect(t.store.admit).not.toHaveBeenCalled();
  });
});

describe('RPT-09 apply admission (worker side)', () => {
  const setup = (record: ReportingRightsAdmissionRecord | null, current = true) => {
    const store = {
      loadAdmission: vi.fn().mockResolvedValue(record),
      recordApplyAttempt: vi.fn().mockResolvedValue(1),
      isTargetCurrent: vi.fn().mockResolvedValue(current),
      settle: vi.fn().mockImplementation(async (_a, s) => ({ status: s.status, confirmationMessageId: 'msg-1' })),
    };
    const repo = { withdraw: vi.fn().mockResolvedValue({ requestId: 'x', permissionRevision: 1, replayed: false }) };
    return { store, repo, useCase: new ApplyReportingRightsAdmissionUseCase(store, new WithdrawReportingPermissionUseCase(repo)) };
  };

  it('applies full withdrawal with verified_subject provenance from the admission', async () => {
    const t = setup(admission());
    expect(await t.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).toEqual({ outcome: 'settled', status: 'applied', confirmationMessageId: 'msg-1', replayed: false, permissionRevision: 1 });
    expect(t.repo.withdraw).toHaveBeenCalledWith({
      tenantId: T, userId: U, personId: U, requestId: 'reporting-rights:ad-1',
      provenance: { kind: 'verified_subject', tenantId: T, userId: U, personId: U, verificationId: 'ad-1', receivedAt: new Date('2026-10-31T10:00:00.123Z') },
      target: { kind: 'full_reporting' },
    });
  });

  it('applies a partial withdrawal for exactly the confirmed lineage', async () => {
    const t = setup(admission({ targetKind: 'partial_reporting', lineageIds: [L[0]!] }));
    await t.useCase.execute({ tenantId: T, admissionId: 'ad-1' });
    expect(t.repo.withdraw.mock.calls[0]![0].target).toEqual({ kind: 'partial_reporting', lineageIds: [L[0]] });
  });

  it('rejects a stale lineage with a content-free notice and no withdrawal', async () => {
    const t = setup(admission({ targetKind: 'partial_reporting', lineageIds: [L[0]!] }), false);
    expect(await t.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).toMatchObject({ status: 'rejected', confirmationMessageId: 'msg-1' });
    expect(t.store.settle).toHaveBeenCalledWith(expect.anything(), { status: 'rejected', reason: 'stale_target' });
    expect(t.repo.withdraw).not.toHaveBeenCalled();
  });

  it.each([
    ['reporting_rights_lineage_subject_mismatch', { status: 'rejected', reason: 'stale_target' }],
    ['reporting_rights_subject_mismatch', { status: 'rejected', reason: 'subject_mismatch' }],
    ['reporting_rights_idempotency_conflict', { status: 'failed', reason: 'idempotency_conflict' }],
  ])('maps repository %s to a typed settlement', async (code, settlement) => {
    const t = setup(admission());
    t.repo.withdraw.mockRejectedValue(new Error(code));
    await t.useCase.execute({ tenantId: T, admissionId: 'ad-1' });
    expect(t.store.settle).toHaveBeenCalledWith(expect.anything(), settlement);
  });

  it('rethrows unknown failures for retry and leaves the admission admitted', async () => {
    const t = setup(admission());
    t.repo.withdraw.mockRejectedValue(new Error('connection reset'));
    await expect(t.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).rejects.toThrow('connection reset');
    expect(t.store.settle).not.toHaveBeenCalled();
  });

  it('does not re-apply a settled admission and reports a missing one', async () => {
    const t = setup(admission({ status: 'applied', confirmationMessageId: 'msg-1' }));
    expect(await t.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).toEqual({ outcome: 'settled', status: 'applied', confirmationMessageId: 'msg-1' });
    expect(t.repo.withdraw).not.toHaveBeenCalled();
    expect(await setup(null).useCase.execute({ tenantId: T, admissionId: 'ad-1' })).toEqual({ outcome: 'missing' });
  });

  it('settles a poison admission as failed with a notice once its attempts are exhausted', async () => {
    const t = setup(admission());
    t.store.recordApplyAttempt.mockResolvedValue(6);
    expect(await t.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).toEqual({ outcome: 'settled', status: 'failed', confirmationMessageId: 'msg-1' });
    expect(t.store.settle).toHaveBeenCalledWith(expect.anything(), { status: 'failed', reason: 'apply_attempts_exhausted' });
    expect(t.repo.withdraw).not.toHaveBeenCalled();
    const last = setup(admission());
    last.store.recordApplyAttempt.mockResolvedValue(5);
    expect(await last.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).toMatchObject({ status: 'applied' });
  });

  it('refuses an admission whose requestId is not derived from its id', async () => {
    const t = setup(admission({ requestId: 'forged' }));
    await expect(t.useCase.execute({ tenantId: T, admissionId: 'ad-1' })).rejects.toThrow('reporting_rights_admission_identity_invalid');
    expect(t.repo.withdraw).not.toHaveBeenCalled();
  });
});

describe('RPT-09 rights copy and menu helpers', () => {
  const de = { kind: 'reporting_rights', locale: 'de', texts: { 'button.full': 'Alles zurückziehen', 'button.topics': 'Themen wählen' } } as unknown as PulseLanguageResource;
  it('offers full withdrawal only when nothing can be chosen', () => {
    expect(reportingRightsRootActions(ROOT, 0).map((a) => a.actionId)).toEqual(['reporting_rights:full']);
    expect(reportingRightsRootActions(ROOT, 2).map((a) => [a.actionId, a.label, a.value])).toEqual([
      ['reporting_rights:full', 'Withdraw all', ROOT], ['reporting_rights:topics', 'Choose topics', `${ROOT}:0`],
    ]);
    expect(reportingRightsRootActions(ROOT, 2, de).map((a) => a.label)).toEqual(['Alles zurückziehen', 'Themen wählen']);
  });
  it('topic button indexes come from each lineage\'s own position even when a title is missing', () => {
    const lineages = ['l0', 'l1', 'l2', 'l3', 'l4'];
    const titles = new Map([['l0', 'Zero'], ['l2', 'Two'], ['l3', 'Three'], ['l4', 'Four']]);
    const page = reportingRightsTopicButtons({ menuId: ROOT, lineageIds: lineages, page: 0, titles });
    expect(page!.titles).toEqual(['Zero', 'Two', 'Three']);
    expect(page!.actions.map((a) => [a.label, a.value])).toEqual([['Zero', `${ROOT}:0`], ['Two', `${ROOT}:2`], ['Three', `${ROOT}:3`], ['More topics', `${ROOT}:1`]]);
    expect(reportingRightsTopicButtons({ menuId: ROOT, lineageIds: ['l1'], page: 0, titles })).toBeNull();
  });
  it('every rights button label respects the Slack limit and empty labels are dropped', () => {
    expect([...reportingRightsButton('confirm', 'x'.repeat(200), ROOT)!.label]).toHaveLength(75);
    expect(reportingRightsButton('confirm', '   ', ROOT)).toBeNull();
    const long = { kind: 'reporting_rights', texts: { 'button.full': 'y'.repeat(90), 'button.topics': ' ' } } as unknown as PulseLanguageResource;
    expect(reportingRightsRootActions(ROOT, 3, long).map((a) => [a.actionId, [...a.label].length])).toEqual([['reporting_rights:full', 75]]);
  });
  it('pages topics within the five-button limit', () => {
    expect(reportingRightsTopicPage(REPORTING_RIGHTS_TOPICS_PER_PAGE + 1, 0)).toEqual({ start: 0, end: 4, nextPage: 1 });
    expect(reportingRightsTopicPage(5, 1)).toEqual({ start: 4, end: 5, nextPage: null });
    expect(reportingRightsTopicPage(5, 2)).toBeNull();
    expect(reportingRightsTopicPage(0, 0)).toBeNull();
  });
  it('localizes text with English fallback and titles from accepted resources', () => {
    expect(reportingRightsText(null, 'done.partial', { topic: 'Growth' })).toBe('Done. Your insight on "Growth" will no longer be used in reports.');
    expect(reportingRightsText(de, 'cancelled')).toBe('Okay, nothing was changed.');
    expect(reportingRightsTopicTitle({ locale: 'en', stableKey: 'k', title: 'Source' })).toBe('Source');
    expect(reportingRightsTopicTitle({ locale: 'de', stableKey: 'k', title: 'Source', engagement: { texts: { k: 'Quelle' } } as never })).toBe('Quelle');
    expect(reportingRightsTopicTitle({ locale: 'de', stableKey: 'k', title: 'Source' })).toBe('Source');
  });
});

describe('RPT-09 typed reply-plan field', () => {
  const base = {
    primaryIntent: 'support', secondaryIntents: [], emotionalState: [], urgency: 'low', confidence: 0.9,
    requiresSafetyCheck: false, surveyAllowed: true, reasoningSummary: 'x',
  };
  it('the reply plan carries the field only from the adapter result; invalid model values fail closed', () => {
    const open = SituationClassificationSchema.parse({ ...base, reportingRightsRequest: 'open_menu' });
    const plan = buildReplyPlan({ classification: open, includeFollowUpQuestion: false });
    expect(plan).not.toHaveProperty('reportingRightsRequest');
    expect(withReportingRights(plan, { status: 'menu' }).reportingRightsRequest).toBe('open_menu');
    expect(withReportingRights(plan, { status: 'already_withdrawn' }).reportingRightsRequest).toBe('already_withdrawn');
    expect(withReportingRights(plan, null)).not.toHaveProperty('reportingRightsRequest');
    for (const value of ['withdraw_now', true, null, 42]) {
      expect(SituationClassificationSchema.parse({ ...base, reportingRightsRequest: value }).reportingRightsRequest).toBe('none');
    }
    expect(SituationClassificationSchema.parse(base).reportingRightsRequest).toBeUndefined();
  });
});
