import type {
  AdminTeamHierarchyResponse,
  AdminV2PilotCycle,
  AdminV2PilotResponse,
  AdminV2PilotPeopleResponse,
  AdminV2PilotQaTeamSignalsResponse,
} from '@entalent/contracts';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';
export const TENANT_ID = process.env.TENANT_ID ?? '';
const INTERNAL_DASHBOARD_ENABLED =
  process.env.INTERNAL_DASHBOARD_ENABLED === 'true' || process.env.INTERNAL_DASHBOARD_ENABLED === '1';

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


const V2_PILOT_TENANT_ID = '7d1e0163-6d53-4713-bd24-254690cc5090';

export function fetchAdminV2Pilot(): Promise<AdminV2PilotResponse | null> {
  // Temporary QA view: only the approved Test AI Agent tenant is visible on the
  // public dashboard. The API picks its most recent V2 cohorts, so a new cycle
  // shows up without redeploying the dashboard.
  if (TENANT_ID !== V2_PILOT_TENANT_ID) return Promise.resolve(null);
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  return fetchApi<AdminV2PilotResponse>(`/admin/v2-pilot?${query}`, 0);
}

/** `cycle` is undefined when the API knows no such cohort; null means data is unavailable. */
export async function fetchAdminV2PilotCycle(
  cohortId: string,
): Promise<{ checkedAt: string; cycle: AdminV2PilotCycle | undefined } | null> {
  if (TENANT_ID !== V2_PILOT_TENANT_ID) return null;
  const query = new URLSearchParams({ tenantId: TENANT_ID, cohortIds: cohortId });
  const data = await fetchApi<AdminV2PilotResponse>(`/admin/v2-pilot?${query}`, 0);
  if (!data) return null;
  return { checkedAt: data.checkedAt, cycle: data.cycles.find((cycle) => cycle.cohortId === cohortId) };
}

/** Names and per-person records are shown only in the private QA view. */
export function qaPrivateViewEnabled(): boolean {
  return process.env.QA_PRIVATE_VIEW_ENABLED === 'true';
}

export function fetchAdminV2PilotPeople(cohortId?: string): Promise<AdminV2PilotPeopleResponse | null> {
  if (!qaPrivateViewEnabled()) return Promise.resolve(null);
  if (TENANT_ID !== V2_PILOT_TENANT_ID) return Promise.resolve(null);
  // Without cohortId the API resolves the running cohort by period and reports
  // its state, so a closed cohort is never presented as the current cycle.
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  if (cohortId) query.set('cohortId', cohortId);
  return fetchApi<AdminV2PilotPeopleResponse>(`/admin/v2-pilot/people?${query}`, 0);
}

/** QA-only: confirmed, de-identified signals with their authors; the threshold is not applied. */
export function fetchAdminV2PilotQaTeamSignals(cohortId?: string): Promise<AdminV2PilotQaTeamSignalsResponse | null> {
  if (!qaPrivateViewEnabled()) return Promise.resolve(null);
  if (TENANT_ID !== V2_PILOT_TENANT_ID) return Promise.resolve(null);
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  if (cohortId) query.set('cohortId', cohortId);
  return fetchApi<AdminV2PilotQaTeamSignalsResponse>(`/admin/v2-pilot/qa/team-signals?${query}`, 0);
}

/** Named reporting hierarchy; QA view only, like the other named views. */
export function fetchAdminTeamHierarchy(): Promise<AdminTeamHierarchyResponse | null> {
  if (!qaPrivateViewEnabled()) return Promise.resolve(null);
  if (TENANT_ID !== V2_PILOT_TENANT_ID) return Promise.resolve(null);
  const query = new URLSearchParams({ tenantId: TENANT_ID });
  return fetchApi<AdminTeamHierarchyResponse>(`/admin/team-hierarchy?${query}`, 0);
}
