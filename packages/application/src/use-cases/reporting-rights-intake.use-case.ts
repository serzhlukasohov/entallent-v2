import { createHash } from 'node:crypto';
import {
  interpolatePulseText, PULSE_SOURCE_REPORTING_RIGHTS, REPORTING_RIGHTS_BUTTON_LABEL_MAX, REPORTING_RIGHTS_MAX_APPLY_ATTEMPTS,
  REPORTING_RIGHTS_TOPICS_PER_PAGE, reportingRightsActionId, reportingRightsButtonValue,
  type OutgoingAction, type PulseLanguageResource, type ReportingRightsAction, type ReportingRightsCopyKey, type ReportingRightsJob,
  type ReportingRightsRenderView,
} from '@entalent/contracts';
import type {
  ReportingRightsAdmissionRecord, ReportingRightsAdmissionStorePort, ReportingRightsApplicationStorePort, ReportingRightsJobPort,
  ReportingRightsSettlement, VerifiedReportingRightsClick,
} from '../ports/reporting-rights.port';
import type { WithdrawReportingPermissionUseCase } from './withdraw-reporting-permission.use-case';

export type ReportingRightsDropReason =
  | 'not_dm' | 'unknown_action' | 'invalid_value' | 'unknown_workspace' | 'unlinked_user'
  | 'menu_not_found' | 'channel_mismatch' | 'menu_expired' | 'menu_cancelled' | 'menu_already_admitted'
  | 'action_menu_mismatch' | 'option_out_of_range';

export type ReportingRightsClickOutcome =
  /** `notice`: the owner was told (content-free) that nothing changed. Foreign/unverified clicks get no notice. */
  | { outcome: 'dropped'; reason: ReportingRightsDropReason; notice?: ReportingRightsRenderView; enqueued?: boolean }
  | { outcome: 'staged'; view: ReportingRightsRenderView; menuId: string; page: number; enqueued: boolean }
  | { outcome: 'admitted'; admissionId: string; created: boolean; enqueued: boolean };

/** The withdrawal request identity derives from the admission, so every retry replays the same request. */
export function reportingRightsRequestId(admissionId: string): string { return `reporting-rights:${admissionId}`; }

export function reportingRightsText(resource: PulseLanguageResource | null | undefined, key: ReportingRightsCopyKey, values?: Record<string, string>): string {
  const text = resource?.kind === 'reporting_rights' ? resource.texts[key] ?? PULSE_SOURCE_REPORTING_RIGHTS[key] : PULSE_SOURCE_REPORTING_RIGHTS[key];
  return interpolatePulseText(text, values);
}

export function reportingRightsButtonLabel(text: string): string {
  const chars = [...text.trim()];
  return chars.length <= REPORTING_RIGHTS_BUTTON_LABEL_MAX ? chars.join('') : `${chars.slice(0, REPORTING_RIGHTS_BUTTON_LABEL_MAX - 1).join('')}…`;
}

/** Every rights button goes through here: Slack label limit, and a button without a label is dropped. */
export function reportingRightsButton(action: ReportingRightsAction, label: string | null | undefined, value: string): OutgoingAction | null {
  const text = reportingRightsButtonLabel(label ?? '');
  return text ? { actionId: reportingRightsActionId(action), label: text, value } : null;
}
const buttons = (items: (OutgoingAction | null)[]): OutgoingAction[] => items.filter((item): item is OutgoingAction => item !== null);

/** Slack buttons for the reply that proposes the menu. No topics → full withdrawal only. */
export function reportingRightsRootActions(menuId: string, topicCount: number, resource?: PulseLanguageResource | null): OutgoingAction[] {
  return buttons([
    reportingRightsButton('full', reportingRightsText(resource, 'button.full'), reportingRightsButtonValue(menuId)),
    topicCount > 0 ? reportingRightsButton('topics', reportingRightsText(resource, 'button.topics'), reportingRightsButtonValue(menuId, 0)) : null,
  ]);
}

export function reportingRightsTopicPage(topicCount: number, page: number): { start: number; end: number; nextPage: number | null } | null {
  const start = page * REPORTING_RIGHTS_TOPICS_PER_PAGE;
  if (!Number.isInteger(page) || page < 0 || start >= topicCount) return null;
  const end = Math.min(topicCount, start + REPORTING_RIGHTS_TOPICS_PER_PAGE);
  return { start, end, nextPage: end < topicCount ? page + 1 : null };
}

/**
 * One page of topic buttons. Each button's index is its lineage's own position in the stored menu list; a
 * lineage whose title cannot be resolved is omitted (stale) instead of shifting the remaining indexes.
 */
export function reportingRightsTopicButtons(input: {
  menuId: string; lineageIds: readonly string[]; page: number; titles: ReadonlyMap<string, string>; resource?: PulseLanguageResource | null;
}): { titles: string[]; actions: OutgoingAction[] } | null {
  const page = reportingRightsTopicPage(input.lineageIds.length, input.page);
  if (!page) return null;
  const shown: string[] = [];
  const actions: OutgoingAction[] = [];
  for (let index = page.start; index < page.end; index++) {
    const title = input.titles.get(input.lineageIds[index]!);
    const button = title ? reportingRightsButton('topic', title, reportingRightsButtonValue(input.menuId, index)) : null;
    if (!button) continue;
    shown.push(title!);
    actions.push(button);
  }
  if (!actions.length) return null;
  const more = page.nextPage === null ? null : reportingRightsButton('topics', reportingRightsText(input.resource, 'button.more'), reportingRightsButtonValue(input.menuId, page.nextPage));
  return { titles: shown, actions: more ? [...actions, more] : actions };
}

/** Question title in the personal language from accepted resources; falls back to the source definition title. */
export function reportingRightsTopicTitle(input: {
  locale: string; stableKey: string; title: string;
  engagement?: PulseLanguageResource | null; definitions?: PulseLanguageResource | null;
}): string {
  if (input.locale === 'en') return input.title;
  const engagement = input.engagement?.texts[input.stableKey];
  if (engagement) return engagement;
  const definition = input.definitions?.texts['title.' + createHash('sha256').update(input.stableKey + '\0' + input.title).digest('hex')];
  return definition ?? input.title;
}

const ENQUEUE_TIMEOUT_MS = 1_000;
/** After a durable commit, transport is best effort and bounded so Slack's 3-second ack is not put at risk. */
async function boundedEnqueue(jobs: ReportingRightsJobPort, job: ReportingRightsJob): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      jobs.enqueue(job).then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ENQUEUE_TIMEOUT_MS); }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * API side of the employee rights protocol. Navigation clicks stage server-side menus; only a Confirm click on a
 * confirm menu owned by the verified subject commits a durable admission, before Slack is acknowledged.
 */
export class ReportingRightsIntakeUseCase {
  constructor(private readonly store: ReportingRightsAdmissionStorePort, private readonly jobs: ReportingRightsJobPort) {}

  async handleClick(click: VerifiedReportingRightsClick): Promise<ReportingRightsClickOutcome> {
    const subject = { tenantId: click.tenantId, userId: click.userId };
    const drop = (reason: ReportingRightsDropReason): ReportingRightsClickOutcome => ({ outcome: 'dropped', reason });
    // Another subject's token is indistinguishable from an unknown one, and gets no notice.
    const menu = await this.store.findMenu(subject, click.menuId);
    if (!menu) return drop('menu_not_found');
    if (menu.externalChannelId !== click.externalChannelId) return drop('channel_mismatch');
    const render = (view: ReportingRightsRenderView, menuId: string, page = 0) =>
      boundedEnqueue(this.jobs, { kind: 'render', tenantId: click.tenantId, menuId, view, page, clickTs: click.actionTs });
    const staged = async (view: ReportingRightsRenderView, menuId: string, page = 0): Promise<ReportingRightsClickOutcome> =>
      ({ outcome: 'staged', view, menuId, page, enqueued: await render(view, menuId, page) });
    // The owner of a used or stale menu is told that nothing changed.
    const notice = async (reason: ReportingRightsDropReason, view: ReportingRightsRenderView): Promise<ReportingRightsClickOutcome> =>
      ({ outcome: 'dropped', reason, notice: view, enqueued: await render(view, menu.id) });
    if (menu.kind === 'confirm' && click.action === 'confirm' && click.index === undefined && menu.admitted) return this.admit(click, menu.id);
    if (menu.kind === 'confirm' && click.action === 'cancel' && click.index === undefined && menu.admitted) return notice('menu_already_admitted', 'already_submitted');
    if (menu.expired) return notice('menu_expired', 'unavailable');
    if (menu.cancelled) return notice('menu_cancelled', 'unavailable');
    if (menu.kind === 'root') {
      if (click.action === 'full') {
        if (click.index !== undefined) return drop('invalid_value');
        const confirm = await this.store.stageConfirm({ subject, parentMenuId: menu.id, targetKind: 'full_reporting', lineageIds: [] });
        return confirm ? staged('confirm', confirm.menuId) : notice('menu_expired', 'unavailable');
      }
      if (click.action === 'topics') {
        if (!reportingRightsTopicPage(menu.lineageIds.length, click.index ?? 0)) return drop('option_out_of_range');
        return staged('topics', menu.id, click.index ?? 0);
      }
      if (click.action === 'topic') {
        const lineageId = click.index === undefined ? undefined : menu.lineageIds[click.index];
        if (!lineageId) return drop('option_out_of_range');
        const confirm = await this.store.stageConfirm({ subject, parentMenuId: menu.id, targetKind: 'partial_reporting', lineageIds: [lineageId] });
        return confirm ? staged('confirm', confirm.menuId) : notice('menu_expired', 'unavailable');
      }
      return drop('action_menu_mismatch');
    }
    if (click.index !== undefined) return drop('invalid_value');
    if (click.action === 'cancel') {
      return await this.store.cancel(subject, menu.id) ? staged('cancelled', menu.id) : notice('menu_already_admitted', 'already_submitted');
    }
    if (click.action !== 'confirm') return drop('action_menu_mismatch');
    return this.admit(click, menu.id);
  }

  private async admit(click: VerifiedReportingRightsClick, menuId: string): Promise<ReportingRightsClickOutcome> {
    const admitted = await this.store.admit({
      subject: { tenantId: click.tenantId, userId: click.userId }, menuId, channelType: click.channelType,
      externalWorkspaceId: click.externalWorkspaceId, externalUserId: click.externalUserId, actionTs: click.actionTs,
    });
    if (admitted.status !== 'admitted') {
      return { outcome: 'dropped', reason: 'menu_cancelled', notice: 'unavailable', enqueued: await boundedEnqueue(this.jobs, {
        kind: 'render', tenantId: click.tenantId, menuId, view: 'unavailable', page: 0, clickTs: click.actionTs,
      }) };
    }
    // The admission is durable; a lost or slow apply job is repaired by the sweep.
    const enqueued = await boundedEnqueue(this.jobs, { kind: 'apply', tenantId: click.tenantId, admissionId: admitted.admission.id });
    return { outcome: 'admitted', admissionId: admitted.admission.id, created: admitted.created, enqueued };
  }
}

export type ApplyReportingRightsOutcome =
  | { outcome: 'missing' }
  | { outcome: 'settled'; status: ReportingRightsAdmissionRecord['status']; confirmationMessageId: string | null; replayed?: boolean; permissionRevision?: number };

const REJECTIONS: Record<string, Extract<ReportingRightsSettlement, { status: 'rejected' | 'failed' }>> = {
  reporting_rights_lineage_subject_mismatch: { status: 'rejected', reason: 'stale_target' },
  reporting_rights_subject_mismatch: { status: 'rejected', reason: 'subject_mismatch' },
  reporting_rights_idempotency_conflict: { status: 'failed', reason: 'idempotency_conflict' },
};

/** Worker side: applies one admission through the existing withdrawal command with verified-subject provenance. */
export class ApplyReportingRightsAdmissionUseCase {
  constructor(
    private readonly store: ReportingRightsApplicationStorePort,
    private readonly withdraw: Pick<WithdrawReportingPermissionUseCase, 'execute'>,
    private readonly maxAttempts = REPORTING_RIGHTS_MAX_APPLY_ATTEMPTS,
  ) {}

  async execute(input: { tenantId: string; admissionId: string }): Promise<ApplyReportingRightsOutcome> {
    const admission = await this.store.loadAdmission(input.tenantId, input.admissionId);
    if (!admission) return { outcome: 'missing' };
    if (admission.status !== 'admitted') {
      return { outcome: 'settled', status: admission.status, confirmationMessageId: admission.confirmationMessageId };
    }
    if (admission.requestId !== reportingRightsRequestId(admission.id)) throw new Error('reporting_rights_admission_identity_invalid');
    // Counted before the attempt, so a poison admission settles instead of being re-enqueued forever.
    if (await this.store.recordApplyAttempt(admission) > this.maxAttempts) return this.settle(admission, { status: 'failed', reason: 'apply_attempts_exhausted' });
    if (!await this.store.isTargetCurrent(admission)) return this.settle(admission, { status: 'rejected', reason: 'stale_target' });
    let settlement: ReportingRightsSettlement;
    try {
      const receipt = await this.withdraw.execute({
        tenantId: admission.tenantId, userId: admission.userId, personId: admission.userId, requestId: admission.requestId,
        provenance: {
          kind: 'verified_subject', tenantId: admission.tenantId, userId: admission.userId, personId: admission.userId,
          verificationId: admission.id, receivedAt: admission.receivedAt,
        },
        target: admission.targetKind === 'full_reporting' ? { kind: 'full_reporting' } : { kind: 'partial_reporting', lineageIds: admission.lineageIds },
      });
      settlement = { status: 'applied', receipt };
    } catch (error) {
      const rejection = REJECTIONS[(error as Error)?.message ?? ''];
      if (!rejection) throw error;
      settlement = rejection;
    }
    return this.settle(admission, settlement);
  }

  private async settle(admission: ReportingRightsAdmissionRecord, settlement: ReportingRightsSettlement): Promise<ApplyReportingRightsOutcome> {
    const settled = await this.store.settle(admission, settlement);
    return {
      outcome: 'settled', ...settled,
      ...(settlement.status === 'applied' ? { replayed: settlement.receipt.replayed, permissionRevision: settlement.receipt.permissionRevision } : {}),
    };
  }
}
