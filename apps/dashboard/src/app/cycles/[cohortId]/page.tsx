import { notFound } from 'next/navigation';
import { Nav } from '../../components/Nav';
import { Badge, Notice, PageHeader, Stat, ViewBadge } from '../../components/ui';
import { fetchAdminV2PilotCycle, fetchAdminV2PilotPeople, qaPrivateViewEnabled } from '../../lib';
import {
  cycleReportBadge, cycleStateLabel, isCohortId, personStageBadge, REPORT_THRESHOLD, warsawDateTime,
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
        <Notice>Данные недоступны. Проверьте соединение с API и настройки внутреннего дашборда.</Notice>
      </main>
    );
  }

  const roster = [...(people?.people ?? [])].sort((a, b) => Number(b.inbound > 0) - Number(a.inbound > 0));
  const report = cycleReportBadge(cycle, Date.parse(data.checkedAt));

  return (
    <main className="page">
      <Nav active="cycles" />
      <PageHeader
        title={`Цикл · ${cycleStateLabel(cycle.state)}`}
        subtitle={`${warsawDateTime(cycle.periodStart)} → ${warsawDateTime(cycle.periodEnd)} (Варшава)`}
      >
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted">Отчёт менеджеру:</span>
          <ViewBadge badge={report} />
          {!cycle.managerTargetConfigured && <Badge tone="warning">Маршрут менеджера не настроен</Badge>}
        </div>
      </PageHeader>

      <div className="stats">
        <Stat label="Участвовали" value={`${cycle.participants} / ${cycle.rosterSize}`} note="хотя бы одно сообщение в цикле" />
        <Stat label="Обработано входящих" value={`${cycle.processed} / ${cycle.inbound}`} />
        <Stat label="Смыслы готовы" value={cycle.readyMeanings} note={`темы; полных групп: ${cycle.completeGroups}`} />
        <Stat label="Bundle доставлены" value={cycle.deliveredBundles} note="группы на подтверждении" />
        <Stat label="Автономия 3/3" value={`${cycle.autonomyScoredParticipants} / ${REPORT_THRESHOLD}`} note="участники; порог отчёта" />
      </div>

      <h2 className="section-title">Состав когорты</h2>
      {!people ? (
        <Notice>
          {qaPrivateViewEnabled()
            ? 'Состав сейчас недоступен: API не ответил.'
            : 'Состав доступен только в QA-режиме.'}
        </Notice>
      ) : roster.length === 0 ? (
        <Notice>Состав когорты пуст.</Notice>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Участник</th><th>Сообщений в цикле</th><th>Участвовал</th><th>Автономия</th>
            </tr></thead>
            <tbody>{roster.map((person) => (
              <tr key={person.userId}>
                <td>{person.displayName}</td>
                <td>{person.inbound}</td>
                <td>{person.inbound > 0 ? <Badge tone="success">Да</Badge> : <Badge tone="neutral">Нет</Badge>}</td>
                <td><ViewBadge badge={personStageBadge(person)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
