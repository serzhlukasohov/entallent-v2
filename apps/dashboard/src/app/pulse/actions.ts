'use server';

import { revalidatePath } from 'next/cache';
import { devControlsEnabled } from './dev-controls-gate';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';

async function devPost(path: string, body: unknown) {
  if (!devControlsEnabled()) {
    throw new Error('Dev controls are disabled');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

/** Row counts returned by the API dev reset (kept in sync with apps/api UserResetResult). */
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

export interface DevResetResult extends UserResetResult {
  /** Onboarding v2 restart that every dev reset performs; introQueued means the intro is being re-sent now. */
  onboarding: { stateDeleted: boolean; deliveryRequeued: boolean; introQueued: boolean };
}

export async function resetUser(userId: string, tenantId: string, deep: boolean): Promise<DevResetResult> {
  const result = await devPost('/dev/reset-user', { userId, tenantId, deep });
  revalidatePath('/pulse');
  revalidatePath(`/pulse/${encodeURIComponent(userId)}`);
  return result as DevResetResult;
}

export async function forceCheckIn(userId: string, tenantId: string) {
  await devPost('/dev/force-checkin', { userIds: [userId], tenantId });
  revalidatePath('/pulse');
  revalidatePath(`/pulse/${encodeURIComponent(userId)}`);
}
