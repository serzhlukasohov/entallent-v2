'use server';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';

/** Kept in sync with apps/api AdminOnboardingRestartResult. */
export interface OnboardingRestartResult {
  stateDeleted: boolean;
  deliveryRequeued: boolean;
  introQueued: boolean;
}

/** Admin (production) onboarding restart; unlike the dev reset it leaves conversations and pulse data alone. */
export async function restartOnboarding(userId: string, tenantId: string): Promise<OnboardingRestartResult> {
  const query = new URLSearchParams({ tenantId });
  const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/onboarding/restart?${query}`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<OnboardingRestartResult>;
}
