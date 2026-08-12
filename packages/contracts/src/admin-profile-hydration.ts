export const ADMIN_PROFILE_HYDRATION_STATUSES = [
  'success',
  'missing_profile',
  'failed',
  'unknown',
] as const;

export type AdminProfileHydrationStatus = (typeof ADMIN_PROFILE_HYDRATION_STATUSES)[number];

export interface AdminProfileHydrationSummary {
  channelAccounts: number;
  missingDisplayNames: number;
  neverAttempted: number;
  missingProfile: number;
  failed: number;
  failedJobs: number;
}

export interface AdminProfileHydrationMissingDisplayName {
  userId: string;
  channelType: string;
  externalWorkspaceId: string;
  externalUserId: string;
  preferredName: string | null;
  channelDisplayName: string | null;
  status: AdminProfileHydrationStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  reason: string | null;
}

export interface AdminProfileHydrationFailedJob {
  id: string | number | null;
  name: string;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: number;
  finishedOn: number | null;
  data: {
    userId?: string;
    tenantId?: string;
    channelType?: string;
    traceId?: string;
  };
}

export interface AdminProfileHydrationStatusResponse {
  tenantId: string;
  generatedAt: string;
  summary: AdminProfileHydrationSummary;
  missingDisplayNames: AdminProfileHydrationMissingDisplayName[];
  failedJobs: AdminProfileHydrationFailedJob[];
}
