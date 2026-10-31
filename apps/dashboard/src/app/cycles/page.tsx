import { CompanyText, CompanyDate } from '../company-language';
import Link from 'next/link';
import { Nav } from '../components/Nav';
import { Notice, PageHeader, ProgressBar, ViewBadge } from '../components/ui';
import { fetchAdminV2Pilot } from '../lib';
import { cycleReportBadge, cycleStateBadge, REPORT_THRESHOLD } from '../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CyclesPage() {
  const data = await fetchAdminV2Pilot();
  const now = data ? Date.parse(data.checkedAt) : Date.now();
  const cycles = [...(data?.cycles ?? [])].sort((a, b) => Date.parse(b.periodStart) - Date.parse(a.periodStart));

  return (
    <main className="page">
      <Nav active="cycles" />
      <PageHeader
        title={<CompanyText k="ui.057" />}
        subtitle={<CompanyText k="ui.058" />}
      />
      {!data ? (
        <Notice><CompanyText k="ui.059" /></Notice>
      ) : cycles.length === 0 ? (
        <Notice><CompanyText k="ui.060" /></Notice>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th><CompanyText k="ui.061" /></th><th><CompanyText k="ui.062" /></th><th><CompanyText k="ui.063" /></th><th><CompanyText k="ui.064" /></th><th><CompanyText k="ui.065" /></th>
            </tr></thead>
            <tbody>{cycles.map((cycle) => (
              <tr key={cycle.cohortId}>
                <td>
                  <Link href={`/cycles/${cycle.cohortId}`}>
                    <CompanyDate value={cycle.periodStart} /> → <CompanyDate value={cycle.periodEnd} />
                  </Link>
                </td>
                <td><ViewBadge badge={cycleStateBadge(cycle.state)} /></td>
                <td><ProgressBar
                  value={cycle.participants}
                  max={cycle.rosterSize}
                  label={`Участвовали · $<CompanyDate value={cycle.periodStart} /> → $<CompanyDate value={cycle.periodEnd} />`}
                /></td>
                <td>{cycle.autonomyScoredParticipants} / {REPORT_THRESHOLD}</td>
                <td><ViewBadge badge={cycleReportBadge(cycle, now)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
