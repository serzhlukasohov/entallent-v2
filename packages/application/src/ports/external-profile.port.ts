/** Fetches profile facts from the external channel (e.g. Slack users.info). */
export interface ExternalProfilePort {
  /** IANA timezone for the user on the given channel, or null if unavailable. */
  fetchTimezone(userId: string, tenantId: string, channelType: string): Promise<string | null>;
}
