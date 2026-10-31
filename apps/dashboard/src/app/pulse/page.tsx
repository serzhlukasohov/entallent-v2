import { CompanyText, CompanyLabel, CompanyNavigation, CompanyPlural, CompanyDefinition } from '../company-language';
import Link from 'next/link';
import type { AdminV2PilotPeopleResponse } from '@entalent/contracts';
import { Nav } from '../components/Nav';
import { Badge, Freshness, Legend, Notice, PageHeader, Stat, ViewBadge } from '../components/ui';
import { fetchAdminV2PilotPeople, fetchAdminV2PilotQaTeamSignals, qaPrivateViewEnabled } from '../lib';
import {
  buildTopicRows, cohortLabel, isShownWorking, lastMessageLabel, refreshHref, rootCauseLabel, shortName,
  signalBadge, topicGroupLabel, type TopicRow, type TopicSignal,
} from '../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function workingCount(data: AdminV2PilotPeopleResponse | null): number | string {
  if (!data) return '—';
  return data.people.reduce((sum, person) => sum + person.questions.filter(isShownWorking).length, 0);
}

function SignalItem({ signal }: { signal: TopicSignal }) {
  return <div className="topic-item">
    <blockquote>{signal.display?.status === 'translation_pending'
      ? <CompanyText k="ui.translation_pending" />
      : signal.display?.status === 'language_unavailable'
      ? <CompanyText k="ui.language_unavailable" />
      : signal.summary}</blockquote>
    <div className="topic-item-meta">
      <ViewBadge badge={signalBadge(signal)} />
      <span className="muted"><CompanyText k="ui.020" /><CompanyLabel label={rootCauseLabel(signal.rootCause)} /></span>
      <span><CompanyText k="ui.021" /><Link href={`/pulse/${encodeURIComponent(signal.author.userId)}`}>{signal.author.name}</Link></span>
    </div>
  </div>;
}

function TopicRowCard({ row, peopleAvailable, signalsAvailable }: {
  row: TopicRow; peopleAvailable: boolean; signalsAvailable: boolean;
}) {
  return <article className="topic-row">
    <h3><CompanyDefinition display={row.titleDisplay} /></h3>
    <div className="topic-columns">
      <div>
        <div className="topic-column-label"><CompanyText k="ui.022" /></div>
        {row.drafts.length === 0
          ? <div className="topic-empty">{peopleAvailable ? <CompanyText k="ui.023" /> : '—'}</div>
          : row.drafts.map((draft, index) => <div key={`${draft.userId}:${index}`} className="topic-item">
            <blockquote>{draft.summary}</blockquote>
            <div className="topic-item-meta">
              <Link href={`/pulse/${encodeURIComponent(draft.userId)}`}>{draft.name}</Link>
              <ViewBadge badge={draft.badge} />
              {draft.ready && <Badge tone="accent"><CompanyText k="ui.024" /></Badge>}
            </div>
          </div>)}
      </div>
      <div>
        <div className="topic-column-label"><CompanyText k="ui.025" /></div>
        {row.signals.length === 0
          ? <div className="topic-empty">{signalsAvailable ? <CompanyText k="ui.026" /> : '—'}</div>
          : row.signals.map((signal, index) => <SignalItem key={`${index}:${signal.summary}`} signal={signal} />)}
      </div>
    </div>
  </article>;
}

function Participants({ people }: { people: AdminV2PilotPeopleResponse['people'] }) {
  if (people.length === 0) return null;
  return <p className="participants">
    <span className="muted"><CompanyText k="ui.027" /></span>{' '}
    {people.map((person, index) => <span key={person.userId}>
      {index > 0 && ', '}
      <Link href={`/pulse/${encodeURIComponent(person.userId)}`}>{shortName(person.displayName)}</Link>
      {' '}<span className="muted small">(<CompanyLabel label={lastMessageLabel(person.lastInboundAt)} />)</span>
    </span>)}
  </p>;
}

function GroupFilter({ groups, active }: { groups: string[]; active: string | null }) {
  return <CompanyNavigation>
    <Link href="/pulse" className={active === null ? 'active' : undefined} aria-current={active === null ? 'page' : undefined}>
      <CompanyText k="ui.029" /></Link>
    {groups.map((group) => <Link
      key={group}
      href={`/pulse?group=${encodeURIComponent(group)}`}
      className={active === group ? 'active' : undefined}
      aria-current={active === group ? 'page' : undefined}
    >
      <CompanyLabel label={topicGroupLabel(group)} />
    </Link>)}
  </CompanyNavigation>;
}

export default async function PulsePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const qaEnabled = qaPrivateViewEnabled();
  const params = await searchParams;
  const group = params.group;
  // Resolve the cohort once so both sides always describe the same cycle.
  const people = await fetchAdminV2PilotPeople();
  const signals = await fetchAdminV2PilotQaTeamSignals(people?.cohortId);
  const cohort = people ?? signals;
  const topics = buildTopicRows(people?.people ?? null, signals?.signals ?? null, typeof group === 'string' ? group : undefined);
  const visibleGroups = [...new Set(topics.rows.map((row) => row.group))];
  const cycleWide = topics.group ? "ui.030" : undefined;

  return (
    <main className="page">
      <Nav active="current" />
      <PageHeader title={<CompanyText k="ui.031" />} subtitle={cohort ? <CompanyLabel label={cohortLabel(cohort)} /> : undefined}>
        {qaEnabled && <Freshness checkedAt={[people?.checkedAt, signals?.checkedAt]} href={refreshHref('/pulse', params)} />}
      </PageHeader>
      {!qaEnabled ? (
        <Notice><CompanyText k="ui.032" /></Notice>
      ) : <>
        <Legend />
        <div className="stats">
          <Stat label={<CompanyText k="ui.033" />} value={people?.people.length ?? '—'} note={cycleWide} />
          <Stat
            label={<CompanyText k="ui.034" />}
            value={workingCount(people)}
            note="ui.035"
          />
          <Stat
            label={<CompanyText k="ui.025" />}
            value={signals?.signals.length ?? '—'}
            note="ui.036"
          />
        </div>
        {people && <Participants people={people.people} />}
        <p className="muted" style={{ marginTop: 16 }}>
          <CompanyText k="ui.037" /></p>
        {!people && <div style={{ marginTop: 16 }}><Notice><CompanyText k="ui.038" /></Notice></div>}
        {!signals ? <div style={{ marginTop: 16 }}><Notice><CompanyText k="ui.039" /></Notice></div>
          : signals.signals.length === 0 && <div style={{ marginTop: 16 }}><Notice><CompanyText k="ui.040" /></Notice></div>}
        {(people || signals) && <>
          <GroupFilter groups={topics.groups} active={topics.group} />
          {topics.rows.length === 0 && topics.empty.length === 0 && (
            <p className="muted" style={{ marginTop: 16 }}><CompanyText k="ui.041" /></p>
          )}
          {visibleGroups.map((rowGroup) => <section key={rowGroup}>
            <h2 className="section-title"><CompanyLabel label={topicGroupLabel(rowGroup)} /></h2>
            <div className="stack">
              {topics.rows.filter((row) => row.group === rowGroup).map((row) => <TopicRowCard
                key={`${row.group}|${row.stableKey}`} row={row} peopleAvailable={Boolean(people)} signalsAvailable={Boolean(signals)}
              />)}
            </div>
          </section>)}
          {topics.empty.length > 0 && <details className="card" style={{ marginTop: 24 }}>
            <summary><CompanyText k="ui.042" /><CompanyPlural count={topics.empty.length} singular="ui.043" plural="ui.045" /> <CompanyText k="ui.046" /></summary>
            <ul style={{ margin: '12px 0 0', paddingLeft: 20 }}>
              {topics.empty.map((row) => <li key={`${row.group}|${row.stableKey}`}>
                <CompanyDefinition display={row.titleDisplay} /> <span className="muted small">· <CompanyLabel label={topicGroupLabel(row.group)} /></span>
              </li>)}
            </ul>
          </details>}
        </>}
      </>}
    </main>
  );
}
