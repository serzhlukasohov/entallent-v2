import type { ExternalUserProfile } from '@entalent/contracts';

/** Fetches profile facts from the external channel (e.g. Slack users.info). */
export interface ExternalProfilePort {
  /** Full external profile for the user on the given channel, or null if unavailable. */
  fetchProfile(
    userId: string,
    tenantId: string,
    channelType: string,
  ): Promise<ExternalUserProfile | null>;

  /** IANA timezone for the user on the given channel, or null if unavailable. */
  fetchTimezone(userId: string, tenantId: string, channelType: string): Promise<string | null>;
}
