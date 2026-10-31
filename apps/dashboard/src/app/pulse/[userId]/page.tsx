import { CompanyText, CompanyLabel, CompanyDefinition } from '../../company-language';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminV2PilotPersonQuestion } from '@entalent/contracts';
import { Nav } from '../../components/Nav';
import { Badge, Freshness, Legend, Notice, PageHeader, ViewBadge } from '../../components/ui';
import { fetchAdminV2PilotPeople, TENANT_ID } from '../../lib';
import { DevControls } from '../DevControls';
import { devControlsEnabled } from '../dev-controls-gate';
import { RestartOnboardingButton } from '../RestartOnboardingButton';
import {
  cohortLabel, draftStatusBadge, isShownWorking, lastMessageLabel, personProgress, personStageBadge, TOPIC_GROUPS,
} from '../../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function TopicCard({ question }: { question: AdminV2PilotPersonQuestion }) {
  return <article className="card topic-card">
    <h3><CompanyDefinition display={question.titleDisplay} /></h3>
    <div className="row">
      <ViewBadge badge={draftStatusBadge(question.status)} />
      {question.ready && <Badge tone="accent"><CompanyText k="ui.024" /></Badge>}
    </div>
    {isShownWorking(question) ? <div>
      <div className="topic-card-label"><CompanyText k="ui.047" /></div>
      <p>{question.workingSummary}</p>
    </div> : question.finalSummary ? <div>
      <div className="topic-card-label"><CompanyText k="ui.048" /></div>
      <p>{question.finalSummary}</p>
      {/* Any other outcome is already named by the status badge above. */}
      {question.outcome === 'scored' && <div className="row" style={{ marginTop: 6 }}>
        <Badge tone="neutral">{question.score !== null ? <CompanyText k="ui.score" values={{score:question.score}} /> : <CompanyText k="ui.049" />}</Badge>
      </div>}
    </div> : <p className="muted"><CompanyText k={question.display?.status === 'translation_pending' ? 'ui.translation_pending' : 'ui.050'} /></p>}
  </article>;
}

export default async function UserInsightsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const showDevControls = devControlsEnabled();
  const data = await fetchAdminV2PilotPeople();
  const person = data?.people.find((candidate) => candidate.userId === userId);
  if (data && !person) notFound();

  return (
    <main className="page">
      <Nav active="current" />
      <Link href="/pulse" className="back-link"><CompanyText k="ui.051" /></Link>
      <PageHeader
        title={person?.displayName ?? <CompanyText k="ui.052" />}
        subtitle={<>{data && <CompanyLabel label={cohortLabel(data)} />}<CompanyText k="ui.053" /></>}
      >
        {person && <p className="muted small"><CompanyLabel label={lastMessageLabel(person.lastInboundAt)} /></p>}
        {data && <Freshness checkedAt={[data.checkedAt]} href={`/pulse/${encodeURIComponent(userId)}`} />}
      </PageHeader>
      {person && <>
        <Legend />
        <div className="notice row">
          <ViewBadge badge={personStageBadge(person)} />
          <span><CompanyLabel label={personProgress(person).nextStep} /></span>
        </div>
        <RestartOnboardingButton userId={person.userId} tenantId={TENANT_ID} displayName={person.displayName} />
        {/* Local QA only: never rendered in production (see dev-controls-gate). */}
        {showDevControls && <DevControls userId={person.userId} tenantId={TENANT_ID} />}
      </>}
      {person && TOPIC_GROUPS.map(([group, label]) => {
        const questions = person.questions.filter((q) => q.group === group);
        return <section key={group}>
          <h2 className="section-title">
            <CompanyLabel label={label} />{' '}
            <span className="muted summary-meta">
              <CompanyText k="ui.054" />{questions.filter((q) => q.outcome === 'scored').length}/{questions.length}
              {' · '}<CompanyText k="ui.055" />{questions.filter((q) => q.ready).length}
            </span>
          </h2>
          <div className="topic-map">
            {questions.map((q) => <TopicCard key={q.stableKey} question={q} />)}
          </div>
        </section>;
      })}
      {!data && <div style={{ marginTop: 16 }}><Notice><CompanyText k="ui.056" /></Notice></div>}
    </main>
  );
}
