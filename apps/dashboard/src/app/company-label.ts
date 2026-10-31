export function companyLabelKey(key: string, values: Record<string, string | number> = {}, labelValues: string[] = [], dateValues: string[] = []): string {
  return '\u001epulse-copy:'+JSON.stringify({ key, values, labelValues, dateValues });
}
