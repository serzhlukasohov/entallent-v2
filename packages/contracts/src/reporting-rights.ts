import { z } from 'zod';

/** Slack action ids of the employee reporting-rights protocol (RPT-09). Values carry only a server menu token. */
export const REPORTING_RIGHTS_ACTION_PREFIX = 'reporting_rights:' as const;
export const ReportingRightsActionSchema = z.enum(['full', 'topics', 'topic', 'confirm', 'cancel']);
export type ReportingRightsAction = z.infer<typeof ReportingRightsActionSchema>;
export const REPORTING_RIGHTS_PROTOCOL_VERSION = 'reporting-rights-v1' as const;
/** Slack allows five buttons per message: four topics plus a "more" button. */
export const REPORTING_RIGHTS_TOPICS_PER_PAGE = 4;
export const REPORTING_RIGHTS_ROOT_MENU_TTL_SECONDS = 7 * 86_400;
export const REPORTING_RIGHTS_CONFIRM_MENU_TTL_SECONDS = 86_400;
/** An admission whose application keeps failing settles as `failed` after this many attempts. */
export const REPORTING_RIGHTS_MAX_APPLY_ATTEMPTS = 5;
/** Bounded retention of completed/failed rights jobs; DB state stays authoritative. */
export const REPORTING_RIGHTS_JOB_RETENTION = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } } as const;
/** Slack's maximum button label length. */
export const REPORTING_RIGHTS_BUTTON_LABEL_MAX = 75;

export function reportingRightsActionId(action: ReportingRightsAction): string {
  return REPORTING_RIGHTS_ACTION_PREFIX + action;
}
export function parseReportingRightsActionId(actionId: unknown): ReportingRightsAction | null {
  if (typeof actionId !== 'string' || !actionId.startsWith(REPORTING_RIGHTS_ACTION_PREFIX)) return null;
  const parsed = ReportingRightsActionSchema.safeParse(actionId.slice(REPORTING_RIGHTS_ACTION_PREFIX.length));
  return parsed.success ? parsed.data : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Button value: `<menu uuid>` or `<menu uuid>:<option index>`. Never a lineage, tenant or user identity. */
export function reportingRightsButtonValue(menuId: string, index?: number): string {
  return index === undefined ? menuId : `${menuId}:${index}`;
}
export function parseReportingRightsButtonValue(value: unknown): { menuId: string; index?: number } | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const [menuId, index, extra] = value.split(':');
  if (extra !== undefined || !menuId || !UUID.test(menuId)) return null;
  if (index === undefined) return { menuId };
  if (!/^(0|[1-9][0-9]{0,2})$/.test(index)) return null;
  return { menuId, index: Number(index) };
}

export const ReportingRightsTargetKindSchema = z.enum(['full_reporting', 'partial_reporting']);
export type ReportingRightsTargetKind = z.infer<typeof ReportingRightsTargetKindSchema>;
export const ReportingRightsAdmissionStatusSchema = z.enum(['admitted', 'applied', 'rejected', 'failed']);
export type ReportingRightsAdmissionStatus = z.infer<typeof ReportingRightsAdmissionStatusSchema>;
export const ReportingRightsRenderViewSchema = z.enum(['topics', 'confirm', 'cancelled', 'unavailable', 'already_submitted']);
export type ReportingRightsRenderView = z.infer<typeof ReportingRightsRenderViewSchema>;

export const ReportingRightsJobSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('apply'), tenantId: z.string().uuid(), admissionId: z.string().uuid() }).strict(),
  z.object({
    kind: z.literal('render'), tenantId: z.string().uuid(), menuId: z.string().uuid(),
    view: ReportingRightsRenderViewSchema, page: z.number().int().min(0).max(999).default(0),
    /** Slack action_ts of the click; one rendered message per click. */
    clickTs: z.string().min(1).max(64),
  }).strict(),
  z.object({ kind: z.literal('sweep') }).strict(),
]);
export type ReportingRightsJob = z.input<typeof ReportingRightsJobSchema>;

export function reportingRightsApplyJobId(admissionId: string): string { return `reporting-rights-apply-${admissionId}`; }
export function reportingRightsRenderJobId(menuId: string, view: ReportingRightsRenderView, page: number, clickTs: string): string {
  return `reporting-rights-render-${menuId}-${view}-${page}-${clickTs.replace(/[^0-9.]/g, '')}`;
}

/** Approved English source for the rights protocol; other locales use accepted `reporting_rights` resources. */
export const PULSE_SOURCE_REPORTING_RIGHTS = {
  'button.full': 'Withdraw all',
  'button.topics': 'Choose topics',
  'button.more': 'More topics',
  'button.confirm': 'Confirm',
  'button.cancel': 'Cancel',
  'topics.prompt': 'Which topic should no longer be used in reports? Choose one; you can repeat this for other topics.\n{topics}',
  'topics.empty': 'There are no topics in the current cycle that can be withdrawn separately. You can still withdraw all reporting permission.',
  'confirm.full': 'Please confirm: none of your pulse insights will be used in reports from now on. Reports that were already delivered do not change.',
  'confirm.partial': 'Please confirm: your insight on "{topic}" will no longer be used in reports. Reports that were already delivered do not change.',
  'done.full': 'Done. Your pulse insights will no longer be used in reports.',
  'done.partial': 'Done. Your insight on "{topic}" will no longer be used in reports.',
  'done.topic': 'Done. That insight will no longer be used in reports.',
  'not_applied': 'Your request could not be completed, so nothing was changed. Please ask me again later.',
  'already_submitted': 'This request was already submitted, so it can no longer be cancelled here.',
  'cancelled': 'Okay, nothing was changed.',
  'stale': 'This option is no longer available, so nothing was changed. You can ask me again to see the current options.',
} as const;
export type ReportingRightsCopyKey = keyof typeof PULSE_SOURCE_REPORTING_RIGHTS;
