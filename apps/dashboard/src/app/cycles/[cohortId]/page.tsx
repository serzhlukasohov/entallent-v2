import { CompanyText, CompanyLabel, CompanyDate } from '../../company-language';
import { notFound } from 'next/navigation';
import { Nav } from '../../components/Nav';
import { Badge, Notice, PageHeader, Stat, ViewBadge } from '../../components/ui';
import { fetchAdminV2PilotCycle, fetchAdminV2PilotPeople, qaPrivateViewEnabled } from '../../lib';
import {
  cycleReportBadge, cycleStateLabel, isCohortId, personStageBadge, REPORT_THRESHOLD,
} from '../../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CyclePage({ params }: { params: Promise<{ cohortId: string }> }) {
  const cohortId = (await params).cohortId.toLowerCase();
  if (!isCohortId(cohortId)) notFound();

  const [data, people] = await Promise.all([fetchAdminV2PilotCycle(cohortId), fetchAdminV2PilotPeople(cohortId)]);
  if (data && !data.cycle) notFound();
  const cycle = data?.cycle;

  if (!data || !cycle) {
    return (
      <main className="page">
        <Nav active="cycles" />
        <Notice><CompanyText k="ui.059" /></Notice>
      </main>
    );
  }

  const roster = [...(people?.people ?? [])].sort((a, b) => Number(b.inbound > 0) - Number(a.inbound > 0));
  const report = cycleReportBadge(cycle, Date.parse(data.checkedAt));

  return (
    <main className="page">
      <Nav active="cycles" />
      <PageHeader
        title={<><CompanyText k="ui.cycle_title" values={{state:''}} /><CompanyLabel label={cycleStateLabel(cycle.state)} /></>}
        subtitle={<><CompanyDate value={cycle.periodStart} /> → <CompanyDate value={cycle.periodEnd} /></>}
      >
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted"><CompanyText k="ui.066" /></span>
          <ViewBadge badge={report} />
          {!cycle.managerTargetConfigured && <Badge tone="warning"><CompanyText k="ui.067" /></Badge>}
        </div>
      </PageHeader>

      <div className="stats">
        <Stat label={<CompanyText k="ui.063" />} value={`${cycle.participants} / ${cycle.rosterSize}`} note={<CompanyText k="ui.068" />} />
        <Stat label={<CompanyText k="ui.069" />} value={`${cycle.processed} / ${cycle.inbound}`} />
        <Stat label={<CompanyText k="ui.070" />} value={cycle.readyMeanings} note={undefined} />
        <Stat label={<CompanyText k="ui.071" />} value={cycle.deliveredBundles} note={<CompanyText k="ui.072" />} />
        <Stat label={<CompanyText k="ui.064" />} value={`${cycle.autonomyScoredParticipants} / ${REPORT_THRESHOLD}`} note={<CompanyText k="ui.073" />} />
      </div>

      <h2 className="section-title"><CompanyText k="ui.074" /></h2>
      {!people ? (
        <Notice>
          {qaPrivateViewEnabled()
            ? <CompanyText k="ui.075" />
            : <CompanyText k="ui.076" />}
        </Notice>
      ) : roster.length === 0 ? (
        <Notice><CompanyText k="ui.077" /></Notice>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th><CompanyText k="ui.078" /></th><th><CompanyText k="ui.079" /></th><th><CompanyText k="ui.080" /></th><th><CompanyText k="ui.081" /></th>
            </tr></thead>
            <tbody>{roster.map((person) => (
              <tr key={person.userId}>
                <td>{person.displayName}</td>
                <td>{person.inbound}</td>
                <td>{person.inbound > 0 ? <Badge tone="success"><CompanyText k="ui.082" /></Badge> : <Badge tone="neutral"><CompanyText k="ui.083" /></Badge>}</td>
                <td><ViewBadge badge={personStageBadge(person)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
