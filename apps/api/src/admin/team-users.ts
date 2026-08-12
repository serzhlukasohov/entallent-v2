export interface UserIdentityInput {
  id: string;
  preferredName: string | null;
}

export interface ChannelAccountDisplayNameInput {
  userId: string;
  displayName: string | null;
}

export interface TeamUserDisplay {
  id: string;
  displayName: string | null;
}

export function normalizeDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function attachTeamDisplayNames(
  users: UserIdentityInput[],
  channelAccounts: ChannelAccountDisplayNameInput[],
): TeamUserDisplay[] {
  const channelDisplayNameByUser = new Map<string, string>();

  for (const account of channelAccounts) {
    const displayName = normalizeDisplayName(account.displayName);
    if (displayName && !channelDisplayNameByUser.has(account.userId)) {
      channelDisplayNameByUser.set(account.userId, displayName);
    }
  }

  return users.map((user) => ({
    id: user.id,
    displayName:
      normalizeDisplayName(user.preferredName) ?? channelDisplayNameByUser.get(user.id) ?? null,
  }));
}
