import Link from 'next/link';
import type { AdminV2PilotPeopleResponse } from '@entalent/contracts';
import { Nav } from '../components/Nav';
import { Badge, Freshness, Legend, Notice, PageHeader, Stat, ViewBadge } from '../components/ui';
import { fetchAdminV2PilotPeople, fetchAdminV2PilotQaTeamSignals, qaPrivateViewEnabled } from '../lib';
import {
  buildTopicRows, cohortLabel, isShownWorking, lastMessageLabel, refreshHref, rootCauseLabel, ruPlural, shortName,
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
    <blockquote>{signal.summary}</blockquote>
    <div className="topic-item-meta">
      <ViewBadge badge={signalBadge(signal)} />
      <span className="muted">Причина: {rootCauseLabel(signal.rootCause)}</span>
      <span>Автор: <Link href={`/pulse/${encodeURIComponent(signal.author.userId)}`}>{signal.author.name}</Link></span>
    </div>
  </div>;
}

function TopicRowCard({ row, peopleAvailable, signalsAvailable }: {
  row: TopicRow; peopleAvailable: boolean; signalsAvailable: boolean;
}) {
  return <article className="topic-row">
    <h3>{row.title}</h3>
    <div className="topic-columns">
      <div>
        <div className="topic-column-label">Черновики · не подтверждены</div>
        {row.drafts.length === 0
          ? <div className="topic-empty">{peopleAvailable ? 'Нет черновиков' : '—'}</div>
          : row.drafts.map((draft, index) => <div key={`${draft.userId}:${index}`} className="topic-item">
            <blockquote>{draft.summary}</blockquote>
            <div className="topic-item-meta">
              <Link href={`/pulse/${encodeURIComponent(draft.userId)}`}>{draft.name}</Link>
              <ViewBadge badge={draft.badge} />
              {draft.ready && <Badge tone="accent">Достаточно для подтверждения</Badge>}
            </div>
          </div>)}
      </div>
      <div>
        <div className="topic-column-label">Team Signals · обезличено</div>
        {row.signals.length === 0
          ? <div className="topic-empty">{signalsAvailable ? 'Пока нет сигналов' : '—'}</div>
          : row.signals.map((signal, index) => <SignalItem key={`${index}:${signal.summary}`} signal={signal} />)}
      </div>
    </div>
  </article>;
}

function Participants({ people }: { people: AdminV2PilotPeopleResponse['people'] }) {
  if (people.length === 0) return null;
  return <p className="participants">
    <span className="muted">Участники:</span>{' '}
    {people.map((person, index) => <span key={person.userId}>
      {index > 0 && ', '}
      <Link href={`/pulse/${encodeURIComponent(person.userId)}`}>{shortName(person.displayName)}</Link>
      {' '}<span className="muted small">({lastMessageLabel(person.lastInboundAt)})</span>
    </span>)}
  </p>;
}

function GroupFilter({ groups, active }: { groups: string[]; active: string | null }) {
  return <nav className="filters" aria-label="Группа тем">
    <Link href="/pulse" className={active === null ? 'active' : undefined} aria-current={active === null ? 'page' : undefined}>
      Все группы
    </Link>
    {groups.map((group) => <Link
      key={group}
      href={`/pulse?group=${encodeURIComponent(group)}`}
      className={active === group ? 'active' : undefined}
      aria-current={active === group ? 'page' : undefined}
    >
      {topicGroupLabel(group)}
    </Link>)}
  </nav>;
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
  const cycleWide = topics.group ? 'по всему циклу' : undefined;

  return (
    <main className="page">
      <Nav active="current" />
      <PageHeader title="Текущий цикл" subtitle={cohort ? cohortLabel(cohort) : undefined}>
        {qaEnabled && <Freshness checkedAt={[people?.checkedAt, signals?.checkedAt]} href={refreshHref('/pulse', params)} />}
      </PageHeader>
      {!qaEnabled ? (
        <Notice>Черновики и Team Signals доступны только в закрытом QA-режиме.</Notice>
      ) : <>
        <Legend />
        <div className="stats">
          <Stat label="Участников" value={people?.people.length ?? '—'} note={cycleWide} />
          <Stat
            label="Черновиков"
            value={workingCount(people)}
            note={cycleWide ? `ещё не подтверждены участником · ${cycleWide}` : 'ещё не подтверждены участником'}
          />
          <Stat
            label="Team Signals"
            value={signals?.signals.length ?? '—'}
            note={cycleWide ? `подтверждено и обезличено · ${cycleWide}` : 'подтверждено и обезличено'}
          />
        </div>
        {people && <Participants people={people.people} />}
        <p className="muted" style={{ marginTop: 16 }}>
          Слева — черновики участников, они могут измениться. Справа — подтверждённые итоги без имён.
          Строки совпадают только по теме. Порог в 5 участников в QA-режиме не применяется.
        </p>
        {!people && <div style={{ marginTop: 16 }}><Notice>Черновики участников сейчас недоступны.</Notice></div>}
        {!signals ? <div style={{ marginTop: 16 }}><Notice>Team Signals сейчас недоступны.</Notice></div>
          : signals.signals.length === 0 && <div style={{ marginTop: 16 }}><Notice>Подтверждённых сигналов пока нет.</Notice></div>}
        {(people || signals) && <>
          <GroupFilter groups={topics.groups} active={topics.group} />
          {topics.rows.length === 0 && topics.empty.length === 0 && (
            <p className="muted" style={{ marginTop: 16 }}>Тем в этом цикле пока нет.</p>
          )}
          {visibleGroups.map((rowGroup) => <section key={rowGroup}>
            <h2 className="section-title">{topicGroupLabel(rowGroup)}</h2>
            <div className="stack">
              {topics.rows.filter((row) => row.group === rowGroup).map((row) => <TopicRowCard
                key={`${row.group}|${row.stableKey}`} row={row} peopleAvailable={Boolean(people)} signalsAvailable={Boolean(signals)}
              />)}
            </div>
          </section>)}
          {topics.empty.length > 0 && <details className="card" style={{ marginTop: 24 }}>
            <summary>Ещё {topics.empty.length} {ruPlural(topics.empty.length, 'тема', 'темы', 'тем')} без данных</summary>
            <ul style={{ margin: '12px 0 0', paddingLeft: 20 }}>
              {topics.empty.map((row) => <li key={`${row.group}|${row.stableKey}`}>
                {row.title} <span className="muted small">· {topicGroupLabel(row.group)}</span>
              </li>)}
            </ul>
          </details>}
        </>}
      </>}
    </main>
  );
}
