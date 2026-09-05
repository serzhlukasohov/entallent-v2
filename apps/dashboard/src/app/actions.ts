'use server';

import { revalidatePath } from 'next/cache';
import { postAdminUserReset, type UserResetResult } from './lib';

export async function resetTeamUser(userId: string): Promise<UserResetResult> {
  const result = await postAdminUserReset(userId);
  revalidatePath('/');
  revalidatePath('/pulse');
  revalidatePath(`/pulse/${userId}`);
  return result;
}
