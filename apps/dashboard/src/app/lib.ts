import type {
  AdminManagerTrendsResponse,
  AdminQueuesResponse,
  AdminV2PilotResponse,
  AdminV2PilotPeopleResponse,
} from '@entalent/contracts';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';
export const TENANT_ID = process.env.TENANT_ID ?? '';
const INTERNAL_DASHBOARD_ENABLED =
  process.env.INTERNAL_DASHBOARD_ENABLED === 'true' || process.env.INTERNAL_DASHBOARD_ENABLED === '1';

export interface UserResetResult {
  conversations: number;
  messages: number;
  memoryItems: number;
  userGoals: number;
  scheduledActions: number;
  riskSignals: number;
  surveyWindows: number;
  surveyAssessments: number;
  surveyEvidence: number;
  surveyGroupStates: number;
  pulseBacklog: number;
  userStyleProfiles: number;
  llmRuns: number;
}

/** Server-side fetch to an admin API endpoint; returns null on any failure. */
export async function fetchApi<T>(path: string, revalidate = 30): Promise<T | null> {
  if (!INTERNAL_DASHBOARD_ENABLED) return null;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'x-api-key': API_KEY },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}


export async function postApi<T>(path: string, body: unknown): Promise<T> {
  if (!INTERNAL_DASHBOARD_ENABLED) throw new Error('Internal dashboard is disabled');

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function fetchAdminQueues(revalidate = 30): Promise<AdminQueuesResponse | null> {
  return fetchApi<AdminQueuesResponse>('/admin/queues', revalidate);
}

export function fetchAdminV2Pilot(): Promise<AdminV2PilotResponse | null> {
  // Temporary QA view: only the approved Test AI Agent tenant is visible on the
  // public dashboard. The API picks its most recent V2 cohorts, so a new cycle
  // shows up without redeploying the dashboard.
  if (TENANT_ID !== '7d1e0163-6d53-4713-bd24-254690cc5090') return Promise.resolve(null);
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  return fetchApi<AdminV2PilotResponse>(`/admin/v2-pilot?${query}`, 0);
}

export function fetchAdminV2PilotPeople(): Promise<AdminV2PilotPeopleResponse | null> {
  if (process.env.QA_PRIVATE_VIEW_ENABLED !== 'true') return Promise.resolve(null);
  if (TENANT_ID !== '7d1e0163-6d53-4713-bd24-254690cc5090') return Promise.resolve(null);
  // No cohortId: the API resolves the running cohort by period and reports
  // its state, so a closed cohort is never presented as the current cycle.
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  return fetchApi<AdminV2PilotPeopleResponse>(`/admin/v2-pilot/people?${query}`, 0);
}

export function postAdminUserReset(userId: string): Promise<UserResetResult> {
  return postApi<UserResetResult>(withTenant(`/admin/users/${encodeURIComponent(userId)}/reset`), {});
}

export function fetchAdminManagerTrends(
  days = 14,
  revalidate = 30,
): Promise<AdminManagerTrendsResponse | null> {
  const query = new URLSearchParams({ tenantId: TENANT_ID, days: String(days) });
  return fetchApi<AdminManagerTrendsResponse>(`/admin/manager/trends?${query}`, revalidate);
}

function withTenant(path: string): string {
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  return `${path}?${query}`;
}
