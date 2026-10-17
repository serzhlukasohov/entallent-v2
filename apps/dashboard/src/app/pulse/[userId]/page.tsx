import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminV2PilotPersonQuestion } from '@entalent/contracts';
import { Nav } from '../../components/Nav';
import { Badge, Freshness, Legend, Notice, PageHeader, ViewBadge } from '../../components/ui';
import { fetchAdminV2PilotPeople, TENANT_ID } from '../../lib';
import { DevControls } from '../DevControls';
import { devControlsEnabled } from '../dev-controls-gate';
import {
  cohortLabel, draftStatusBadge, isShownWorking, lastMessageLabel, personProgress, personStageBadge, TOPIC_GROUPS,
} from '../../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function TopicCard({ question }: { question: AdminV2PilotPersonQuestion }) {
  return <article className="card topic-card">
    <h3>{question.title}</h3>
    <div className="row">
      <ViewBadge badge={draftStatusBadge(question.status)} />
      {question.ready && <Badge tone="accent">Достаточно для подтверждения</Badge>}
    </div>
    {isShownWorking(question) ? <div>
      <div className="topic-card-label">Черновик · может измениться</div>
      <p>{question.workingSummary}</p>
    </div> : question.finalSummary ? <div>
      <div className="topic-card-label">Обезличенный итог</div>
      <p>{question.finalSummary}</p>
      {/* Any other outcome is already named by the status badge above. */}
      {question.outcome === 'scored' && <div className="row" style={{ marginTop: 6 }}>
        <Badge tone="neutral">{question.score !== null ? `Оценка ${question.score}/100` : 'Оценка —'}</Badge>
      </div>}
    </div> : <p className="muted">Текста на этом этапе нет</p>}
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
      <Link href="/pulse" className="back-link">← Текущий цикл</Link>
      <PageHeader
        title={person?.displayName ?? 'Записи недоступны'}
        subtitle={<>{data ? `${cohortLabel(data)}. ` : ''}Черновик виден до подтверждения; после него остаётся обезличенный итог.</>}
      >
        {person && <p className="muted small">{lastMessageLabel(person.lastInboundAt)}</p>}
        {data && <Freshness checkedAt={[data.checkedAt]} href={`/pulse/${encodeURIComponent(userId)}`} />}
      </PageHeader>
      {person && <>
        <Legend />
        <div className="notice row">
          <ViewBadge badge={personStageBadge(person)} />
          <span>{personProgress(person).nextStep}</span>
        </div>
        {/* Local QA only: never rendered in production (see dev-controls-gate). */}
        {showDevControls && <DevControls userId={person.userId} tenantId={TENANT_ID} />}
      </>}
      {person && TOPIC_GROUPS.map(([group, label]) => {
        const questions = person.questions.filter((q) => q.group === group);
        return <section key={group}>
          <h2 className="section-title">
            {label}{' '}
            <span className="muted summary-meta">
              · итоговых {questions.filter((q) => q.outcome === 'scored').length}/{questions.length}
              {' · '}готово к подтверждению {questions.filter((q) => q.ready).length}
            </span>
          </h2>
          <div className="topic-map">
            {questions.map((q) => <TopicCard key={q.stableKey} question={q} />)}
          </div>
        </section>;
      })}
      {!data && <div style={{ marginTop: 16 }}><Notice>Записи участника доступны только в закрытом QA-режиме при работающем API.</Notice></div>}
    </main>
  );
}
