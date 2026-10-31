import type { OutgoingAction, ReportingRightsAction, ReportingRightsAdmissionStatus, ReportingRightsJob, ReportingRightsTargetKind } from '@entalent/contracts';
import type { ReportingWithdrawalReceipt } from './reporting-permission.repository.port';

/** Subject derived only from the signed workspace/user and the linked-person lookup (people.id = users.id). */
export interface ReportingRightsSubject { tenantId: string; userId: string }

/** A click the API verified: signed body, DM channel, known workspace, linked person. Values are menu tokens only. */
export interface VerifiedReportingRightsClick extends ReportingRightsSubject {
  channelType: 'slack';
  externalWorkspaceId: string;
  externalUserId: string;
  externalChannelId: string;
  action: ReportingRightsAction;
  menuId: string;
  index?: number;
  actionTs: string;
}

export interface ReportingRightsMenuRecord extends ReportingRightsSubject {
  id: string;
  conversationId: string;
  externalChannelId: string;
  kind: 'root' | 'confirm';
  targetKind: ReportingRightsTargetKind | null;
  lineageIds: string[];
  /** Evaluated against the DB clock. */
  expired: boolean;
  cancelled: boolean;
  admitted: boolean;
}

export interface ReportingRightsAdmissionRecord extends ReportingRightsSubject {
  id: string;
  menuId: string;
  requestId: string;
  targetKind: ReportingRightsTargetKind;
  lineageIds: string[];
  /** DB-clock admission time; the trusted `receivedAt` of the withdrawal. */
  receivedAt: Date;
  status: ReportingRightsAdmissionStatus;
  confirmationMessageId: string | null;
}

export type ReportingRightsAdmitResult =
  | { status: 'admitted'; admission: ReportingRightsAdmissionRecord; created: boolean }
  | { status: 'menu_unavailable' };

/** API-side durable store. Every read and write is scoped by the verified subject. */
export interface ReportingRightsAdmissionStorePort {
  findMenu(subject: ReportingRightsSubject, menuId: string): Promise<ReportingRightsMenuRecord | null>;
  stageConfirm(input: { subject: ReportingRightsSubject; parentMenuId: string; targetKind: ReportingRightsTargetKind; lineageIds: string[] }): Promise<{ menuId: string } | null>;
  cancel(subject: ReportingRightsSubject, menuId: string): Promise<boolean>;
  /** Commits the admission (or returns the existing one for the same confirm menu or Slack action). */
  admit(input: { subject: ReportingRightsSubject; menuId: string; channelType: 'slack'; externalWorkspaceId: string; externalUserId: string; actionTs: string }): Promise<ReportingRightsAdmitResult>;
}

/** Redis transport only; losing a job is repaired from PostgreSQL by the sweep. */
export interface ReportingRightsJobPort {
  enqueue(job: ReportingRightsJob): Promise<void>;
}

export type ReportingRightsSettlement =
  | { status: 'applied'; receipt: ReportingWithdrawalReceipt }
  | { status: 'rejected' | 'failed'; reason: 'stale_target' | 'subject_mismatch' | 'idempotency_conflict' | 'apply_attempts_exhausted' };

/** Worker-side store for applying admissions. */
export interface ReportingRightsApplicationStorePort {
  loadAdmission(tenantId: string, admissionId: string): Promise<ReportingRightsAdmissionRecord | null>;
  /** Durably counts one application attempt (committed before the attempt) and returns the new count. */
  recordApplyAttempt(admission: ReportingRightsAdmissionRecord): Promise<number>;
  /** Target lineages still belong to the subject in open or not-yet-final cycles, or were excluded by this request. */
  isTargetCurrent(admission: ReportingRightsAdmissionRecord): Promise<boolean>;
  /** Atomically records the terminal status and persists the confirmation/notice DM; idempotent per admission. */
  settle(admission: ReportingRightsAdmissionRecord, settlement: ReportingRightsSettlement): Promise<{ status: ReportingRightsAdmissionStatus; confirmationMessageId: string | null }>;
}

/** Conversation path: the model proposed opening the menu. Idempotent per turn (`turnKey` = inbound message id). */
export type ReportingRightsMenuOpening =
  | { status: 'menu'; menuId: string; actions: OutgoingAction[] }
  /** Full reporting permission is already withdrawn: a status reply without commit buttons. */
  | { status: 'already_withdrawn' };
export interface ReportingRightsMenuPort {
  openMenu(input: {
    tenantId: string; userId: string; conversationId: string; channelType: string;
    externalWorkspaceId: string; externalChannelId: string; locale: string; turnKey: string;
  }): Promise<ReportingRightsMenuOpening | null>;
}
