'use server';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';

/** Kept in sync with apps/api AdminOnboardingRestartResult. */
export interface OnboardingRestartResult {
  stateDeleted: boolean;
  deliveryRequeued: boolean;
  introQueued: boolean;
}

/**
 * Admin (production) onboarding restart; unlike the dev reset it leaves conversations and pulse data alone.
 * Failures are returned, not thrown: production Next.js masks thrown server action errors.
 */
export async function restartOnboarding(
  userId: string,
  tenantId: string,
): Promise<{ ok: true; result: OnboardingRestartResult } | { ok: false; error: string }> {
  const query = new URLSearchParams({ tenantId });
  try {
    const res = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(userId)}/onboarding/restart?${query}`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
    return { ok: true, result: await res.json() as OnboardingRestartResult };
  } catch (e) {
    return { ok: false, error: `API unreachable: ${String(e)}` };
  }
}
