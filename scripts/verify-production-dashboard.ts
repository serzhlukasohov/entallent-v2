import type { AdminManagerTrendsResponse } from '@entalent/contracts';

const DEFAULT_API_BASE = 'https://api-production-bc75.up.railway.app/api/v1';
const DEFAULT_DASHBOARD_BASE = 'https://dashboard-production-a4f4.up.railway.app';
const NONEXISTENT_USER_ID = '00000000-0000-4000-8000-000000000000';

interface HttpResult {
  status: number;
  headers: Headers;
  body: string;
}

interface VerificationSummary {
  apiBase: string;
  dashboardBase: string;
  tenantId: string;
  trendsDays: number;
  dashboardRoutes: string[];
  privateRoutesBlocked: string[];
}

async function main(): Promise<void> {
  const apiBase = normalizeBaseUrl(process.env.API_BASE ?? DEFAULT_API_BASE);
  const dashboardBase = normalizeBaseUrl(process.env.DASHBOARD_BASE ?? DEFAULT_DASHBOARD_BASE);
  const adminApiKey = requireEnv('ADMIN_API_KEY');
  const tenantId = process.env.TENANT_ID ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    fail('TENANT_ID or DEFAULT_TENANT_ID is required');
  }

  await assertHealth(apiBase);
  const trendsDays = resolveTrendsDays(process.env.DASHBOARD_VERIFY_TRENDS_DAYS);
  const trends = await fetchJson<AdminManagerTrendsResponse>(
    `${apiBase}/admin/manager/trends?tenantId=${encodeURIComponent(tenantId)}&days=${trendsDays}`,
    adminApiKey,
    'admin manager trends',
  );
  assertTrends(trends);

  const privateApiPaths = [
    '/admin/manager/team',
    '/admin/pulse/overview',
    `/admin/users/${NONEXISTENT_USER_ID}/insights`,
    '/admin/survey/coverage/windows',
    `/users/${NONEXISTENT_USER_ID}/data-export`,
    `/users/${NONEXISTENT_USER_ID}/memory`,
  ];
  for (const path of privateApiPaths) {
    await assertNotFound(`${apiBase}${path}?tenantId=${encodeURIComponent(tenantId)}`, adminApiKey, path);
  }
  await assertNotFound(`${apiBase}/internal/maf/context/read`, undefined, 'retired internal context', 'POST');

  const verifiedRoutes: string[] = [];
  const home = await fetchHtml(`${dashboardBase}/`, 'dashboard home');
  assertDynamicDashboardRoute(home, 'dashboard home');
  assertNoDashboardFallback(home, 'dashboard home');
  assertHtmlIncludes(home.body, 'Trends', 'dashboard home redirect target');
  verifiedRoutes.push('/');

  const trendsPage = await fetchHtml(`${dashboardBase}/trends`, 'dashboard trends');
  assertDynamicDashboardRoute(trendsPage, 'dashboard trends');
  assertNoDashboardFallback(trendsPage, 'dashboard trends');
  assertHtmlIncludes(trendsPage.body, 'Trends', 'dashboard trends title');
  assertHtmlIncludes(trendsPage.body, trends.rangeStart, 'dashboard trends range start');
  assertHtmlIncludes(trendsPage.body, trends.rangeEnd, 'dashboard trends range end');
  verifiedRoutes.push('/trends');

  await assertNotFound(`${dashboardBase}/pulse`, undefined, 'dashboard pulse');
  await assertNotFound(`${dashboardBase}/pulse/${NONEXISTENT_USER_ID}`, undefined, 'dashboard user insights');

  const summary: VerificationSummary = {
    apiBase,
    dashboardBase,
    tenantId,
    trendsDays,
    dashboardRoutes: verifiedRoutes,
    privateRoutesBlocked: [...privateApiPaths, '/internal/maf/context/read', '/pulse', '/pulse/[userId]'],
  };

  console.log('Production dashboard verification passed');
  console.log(JSON.stringify(summary, null, 2));
}

async function assertHealth(apiBase: string): Promise<void> {
  const result = await request(`${apiBase}/health`, 'API health');
  if (result.status !== 200) {
    fail(`API health returned HTTP ${result.status}`);
  }
}

async function fetchJson<T>(url: string, adminApiKey: string, label: string): Promise<T> {
  const result = await request(url, label, { 'x-api-key': adminApiKey });
  if (result.status !== 200) {
    fail(`${label} returned HTTP ${result.status}: ${truncate(result.body)}`);
  }

  try {
    return JSON.parse(result.body) as T;
  } catch (error) {
    fail(`${label} returned invalid JSON: ${(error as Error).message}`);
  }
}

async function fetchHtml(url: string, label: string): Promise<HttpResult> {
  const result = await request(url, label);
  if (result.status !== 200) {
    fail(`${label} returned HTTP ${result.status}: ${truncate(result.body)}`);
  }
  return result;
}

async function assertNotFound(
  url: string,
  adminApiKey: string | undefined,
  label: string,
  method = 'GET',
): Promise<void> {
  const headers = adminApiKey ? { 'x-api-key': adminApiKey } : {};
  const result = await request(url, label, headers, method);
  if (result.status !== 404) {
    fail(`${label} returned HTTP ${result.status}; expected 404`);
  }
}

async function request(
  url: string,
  label: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers, method });
  } catch (error) {
    fail(`${label} request failed: ${(error as Error).message}`);
  }

  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

function assertTrends(trends: AdminManagerTrendsResponse): void {
  if (!trends.rangeStart || !trends.rangeEnd) {
    fail('admin manager trends is missing rangeStart/rangeEnd');
  }
  if (!Array.isArray(trends.engagement) || trends.engagement.length === 0) {
    fail('admin manager trends engagement series is empty');
  }
  if (!Array.isArray(trends.signalCapture) || trends.signalCapture.length === 0) {
    fail('admin manager trends signalCapture series is empty');
  }
  if (!trends.coverageFunnel || typeof trends.coverageFunnel !== 'object') {
    fail('admin manager trends coverageFunnel is missing');
  }
  if (!Array.isArray(trends.questionSentiment)) {
    fail('admin manager trends questionSentiment must be an array');
  }
}

function assertDynamicDashboardRoute(result: HttpResult, label: string): void {
  if (result.headers.get('x-nextjs-prerender')) {
    fail(`${label} is still served with x-nextjs-prerender`);
  }

  const cacheControl = result.headers.get('cache-control') ?? '';
  if (!cacheControl.includes('no-cache') && !cacheControl.includes('no-store')) {
    fail(`${label} cache-control does not indicate dynamic/no-cache rendering: ${cacheControl}`);
  }
}

function assertNoDashboardFallback(result: HttpResult, label: string): void {
  if (result.body.includes('Failed to load data')) {
    fail(`${label} rendered the data-load fallback`);
  }
}

function assertHtmlIncludes(html: string, marker: string, label: string): void {
  if (!html.includes(marker)) {
    fail(`${label} missing marker: ${marker}`);
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveTrendsDays(raw: string | undefined): number {
  const days = Number(raw ?? '14');
  if (!Number.isInteger(days) || days < 1 || days > 120) {
    fail('DASHBOARD_VERIFY_TRENDS_DAYS must be an integer between 1 and 120');
  }
  return days;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    fail(`${name} is required`);
  }
  return value;
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

main().catch((error) => {
  fail((error as Error).message);
});
