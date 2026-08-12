import type {
  AdminManagerTeamResponse,
  AdminManagerTrendsResponse,
  AdminPulseOverviewResponse,
  AdminQueuesResponse,
  AdminUserInsightsResponse,
} from '@entalent/contracts';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';
export const TENANT_ID = process.env.TENANT_ID ?? '';

/** Server-side fetch to an admin API endpoint; returns null on any failure. */
export async function fetchApi<T>(path: string, revalidate = 30): Promise<T | null> {
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

export function fetchAdminQueues(revalidate = 30): Promise<AdminQueuesResponse | null> {
  return fetchApi<AdminQueuesResponse>('/admin/queues', revalidate);
}

export function fetchAdminManagerTeam(revalidate = 30): Promise<AdminManagerTeamResponse | null> {
  return fetchApi<AdminManagerTeamResponse>(withTenant('/admin/manager/team'), revalidate);
}

export function fetchAdminPulseOverview(
  revalidate = 0,
): Promise<AdminPulseOverviewResponse | null> {
  return fetchApi<AdminPulseOverviewResponse>(withTenant('/admin/pulse/overview'), revalidate);
}

export function fetchAdminUserInsights(
  userId: string,
  revalidate = 0,
): Promise<AdminUserInsightsResponse | null> {
  return fetchApi<AdminUserInsightsResponse>(
    `/admin/users/${encodeURIComponent(userId)}/insights`,
    revalidate,
  );
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
