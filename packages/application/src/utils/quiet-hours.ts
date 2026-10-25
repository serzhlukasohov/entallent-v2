export interface QuietHours {
  enabled: boolean;
  startHour?: number;
  endHour?: number;
}

export const DEFAULT_QUIET_HOURS: Required<QuietHours> = { enabled: true, startHour: 22, endHour: 8 };

/** Hour (0–23) of the given instant in the given IANA timezone. */
export function getLocalHour(now: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(now),
  );
}

/** Whether the given instant falls in quiet hours for a user in their timezone. */
export function isInQuietHours(now: Date, timezone: string, quietHours: QuietHours): boolean {
  if (!quietHours.enabled) return false;

  const effective: Required<QuietHours> =
    quietHours.startHour != null && quietHours.endHour != null
      ? (quietHours as Required<QuietHours>)
      : DEFAULT_QUIET_HOURS;
  const localHour = getLocalHour(now, timezone);
  const { startHour, endHour } = effective;
  if (startHour <= endHour) return localHour >= startHour && localHour < endHour;
  return localHour >= startHour || localHour < endHour;
}
