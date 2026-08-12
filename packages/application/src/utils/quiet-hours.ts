export interface QuietHours {
  enabled: boolean;
  startHour?: number;
  endHour?: number;
}

export const DEFAULT_QUIET_HOURS: Required<QuietHours> = { enabled: true, startHour: 22, endHour: 8 };

/** Current hour (0–23) in the given IANA timezone. */
export function getLocalHour(timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(
      new Date(),
    ),
  );
}

/** Whether it is currently quiet hours for a user in their timezone. */
export function isInQuietHours(timezone: string, quietHours: QuietHours): boolean {
  if (!quietHours.enabled) return false;

  const effective: Required<QuietHours> =
    quietHours.startHour != null && quietHours.endHour != null
      ? (quietHours as Required<QuietHours>)
      : DEFAULT_QUIET_HOURS;
  const localHour = getLocalHour(timezone);
  const { startHour, endHour } = effective;
  if (startHour <= endHour) return localHour >= startHour && localHour < endHour;
  return localHour >= startHour || localHour < endHour;
}
