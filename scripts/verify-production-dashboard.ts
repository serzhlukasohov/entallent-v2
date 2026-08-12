import type { AdminManagerTeamResponse, AdminManagerTrendsResponse } from '@entalent/contracts';

type TeamEmployee = AdminManagerTeamResponse['employees'][number];

const DEFAULT_API_BASE = 'https://api-production-bc75.up.railway.app/api/v1';
const DEFAULT_DASHBOARD_BASE = 'https://dashboard-production-a4f4.up.railway.app';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface HttpResult {
  status: number;
  headers: Headers;
  body: string;
}

interface VerificationSummary {
  apiBase: string;
  dashboardBase: string;
  tenantId: string;
  teamSize: number;
  verifiedEmployees: string[];
  trendsDays: number;
  dashboardRoutes: string[];
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
  const team = await fetchJson<AdminManagerTeamResponse>(
    `${apiBase}/admin/manager/team?tenantId=${encodeURIComponent(tenantId)}`,
    adminApiKey,
    'admin manager team',
  );
  assertTeamDisplayNames(team);

  const trendsDays = resolveTrendsDays(process.env.DASHBOARD_VERIFY_TRENDS_DAYS);
  const trends = await fetchJson<AdminManagerTrendsResponse>(
    `${apiBase}/admin/manager/trends?tenantId=${encodeURIComponent(tenantId)}&days=${trendsDays}`,
    adminApiKey,
    'admin manager trends',
  );
  assertTrends(trends);

  const verifiedRoutes: string[] = [];
  const home = await fetchHtml(`${dashboardBase}/`, 'dashboard home');
  assertDynamicDashboardRoute(home, 'dashboard home');
  assertNoDashboardFallback(home, 'dashboard home');
  assertHtmlIncludes(home.body, 'Team Q12 Pulse', 'dashboard home title');
  assertEmployeeNamesInHtml(home.body, team.employees, 'dashboard home');
  verifiedRoutes.push('/');

  const trendsPage = await fetchHtml(`${dashboardBase}/trends`, 'dashboard trends');
  assertDynamicDashboardRoute(trendsPage, 'dashboard trends');
  assertNoDashboardFallback(trendsPage, 'dashboard trends');
  assertHtmlIncludes(trendsPage.body, 'Trends', 'dashboard trends title');
  assertHtmlIncludes(trendsPage.body, trends.rangeStart, 'dashboard trends range start');
  assertHtmlIncludes(trendsPage.body, trends.rangeEnd, 'dashboard trends range end');
  verifiedRoutes.push('/trends');

  const pulse = await fetchHtml(`${dashboardBase}/pulse`, 'dashboard pulse');
  assertNoDashboardFallback(pulse, 'dashboard pulse');
  assertHtmlIncludes(pulse.body, 'Pulse Check Groups', 'dashboard pulse title');
  assertEmployeeNamesInHtml(
    pulse.body,
    team.employees.filter((employee) => employee.totalQuestions > 0),
    'dashboard pulse',
  );
  verifiedRoutes.push('/pulse');

  const employeeForInsights = team.employees.find((employee) => employee.totalQuestions > 0);
  if (employeeForInsights) {
    const insights = await fetchHtml(
      `${dashboardBase}/pulse/${encodeURIComponent(employeeForInsights.userId)}`,
      'dashboard user insights',
    );
    assertNoDashboardFallback(insights, 'dashboard user insights');
    assertHtmlIncludes(insights.body, 'Employee Insights', 'dashboard user insights title');
    assertHtmlIncludes(insights.body, employeeForInsights.userId, 'dashboard user insights user id');
    verifiedRoutes.push(`/pulse/${employeeForInsights.userId}`);
  }

  const summary: VerificationSummary = {
    apiBase,
    dashboardBase,
    tenantId,
    teamSize: team.teamSize,
    verifiedEmployees: team.employees.map((employee) => employee.displayName),
    trendsDays,
    dashboardRoutes: verifiedRoutes,
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

async function request(
  url: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    fail(`${label} request failed: ${(error as Error).message}`);
  }

  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

function assertTeamDisplayNames(team: AdminManagerTeamResponse): void {
  if (!Array.isArray(team.employees)) {
    fail('admin manager team employees must be an array');
  }
  if (team.teamSize !== team.employees.length) {
    fail(`admin manager teamSize ${team.teamSize} does not match ${team.employees.length} rows`);
  }
  if (team.employees.length === 0) {
    fail('admin manager team returned no employees');
  }

  const badNames = team.employees.filter((employee) => {
    const displayName = employee.displayName.trim();
    return !displayName || displayName === employee.userId || UUID_PATTERN.test(displayName);
  });

  if (badNames.length > 0) {
    fail(
      `admin manager team returned ID fallback display names for user(s): ${badNames
        .map((employee) => employee.userId)
        .join(', ')}`,
    );
  }
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

function assertEmployeeNamesInHtml(
  html: string,
  employees: TeamEmployee[],
  label: string,
): void {
  const missingNames = employees
    .map((employee) => employee.displayName)
    .filter((displayName) => !html.includes(displayName) && !html.includes(escapeHtml(displayName)));

  if (missingNames.length > 0) {
    fail(`${label} is missing employee display name(s): ${missingNames.join(', ')}`);
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
