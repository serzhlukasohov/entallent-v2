'use server';

import { revalidatePath } from 'next/cache';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';

async function devPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function resetUser(userId: string, deep: boolean) {
  const result = await devPost('/dev/reset-user', { userId, deep });
  revalidatePath('/pulse');
  return result as Record<string, number>;
}

export async function forceCheckIn(userId: string, tenantId: string) {
  await devPost('/dev/force-checkin', { userIds: [userId], tenantId });
  revalidatePath('/pulse');
}
