export interface QuietHours {
  enabled: boolean;
  startHour?: number;
  endHour?: number;
}

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
  if (!quietHours.enabled || quietHours.startHour == null || quietHours.endHour == null) {
    return false;
  }
  const localHour = getLocalHour(timezone);
  const { startHour, endHour } = quietHours;
  // Handle wrap-around midnight (e.g. 22–8)
  if (startHour <= endHour) {
    return localHour >= startHour && localHour < endHour;
  }
  return localHour >= startHour || localHour < endHour;
}
