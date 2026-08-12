export interface ExternalProfileFactsInput {
  externalUserId?: string | null;
  displayName?: string | null;
  timezone?: string | null;
}

export interface CurrentUserProfileFacts {
  preferredName?: string | null;
}

export interface ProfileFactsWriteDecision {
  displayName?: string;
  preferredName?: string;
  timezone?: string;
}

export function normalizeProfileDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveExternalProfileFacts(
  profile: ExternalProfileFactsInput,
  current: CurrentUserProfileFacts = {},
): ProfileFactsWriteDecision {
  const displayName = resolveUsableExternalDisplayName(profile.displayName, profile.externalUserId);
  const timezone = normalizeOptionalString(profile.timezone);
  const decision: ProfileFactsWriteDecision = {};

  if (displayName) {
    decision.displayName = displayName;
    if (!normalizeProfileDisplayName(current.preferredName)) {
      decision.preferredName = displayName;
    }
  }

  if (timezone) {
    decision.timezone = timezone;
  }

  return decision;
}

export function resolveUsableExternalDisplayName(
  displayName: string | null | undefined,
  externalUserId?: string | null,
): string | null {
  const normalized = normalizeProfileDisplayName(displayName);
  if (!normalized) return null;

  const normalizedExternalUserId = normalizeProfileDisplayName(externalUserId);
  if (
    normalizedExternalUserId &&
    normalized.toLowerCase() === normalizedExternalUserId.toLowerCase()
  ) {
    return null;
  }

  return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  return normalizeProfileDisplayName(value) ?? undefined;
}
