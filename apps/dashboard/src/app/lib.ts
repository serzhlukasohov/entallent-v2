const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1';
const API_KEY = process.env.ADMIN_API_KEY ?? '';
export const TENANT_ID = process.env.TENANT_ID ?? '';

/** Server-side fetch to an admin API endpoint; returns null on any failure. */
export async function fetchApi<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'x-api-key': API_KEY },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
