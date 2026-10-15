import Link from 'next/link';
import { Nav } from '../components/Nav';
import { Notice, PageHeader, ProgressBar, ViewBadge } from '../components/ui';
import { fetchAdminV2Pilot } from '../lib';
import { cycleReportBadge, cycleStateBadge, REPORT_THRESHOLD, warsawDateTime } from '../v2-pilot-progress';

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
        title="Циклы V2"
        subtitle="Новые сверху. Время — Варшава. Участвовал — хотя бы одно входящее сообщение в период цикла."
      />
      {!data ? (
        <Notice>Данные недоступны. Проверьте соединение с API и настройки внутреннего дашборда.</Notice>
      ) : cycles.length === 0 ? (
        <Notice>Циклов V2 пока нет.</Notice>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th>Период</th><th>Состояние</th><th>Участвовали</th><th>Автономия 3/3</th><th>Отчёт</th>
            </tr></thead>
            <tbody>{cycles.map((cycle) => (
              <tr key={cycle.cohortId}>
                <td>
                  <Link href={`/cycles/${cycle.cohortId}`}>
                    {warsawDateTime(cycle.periodStart)} → {warsawDateTime(cycle.periodEnd)}
                  </Link>
                </td>
                <td><ViewBadge badge={cycleStateBadge(cycle.state)} /></td>
                <td><ProgressBar
                  value={cycle.participants}
                  max={cycle.rosterSize}
                  label={`Участвовали · ${warsawDateTime(cycle.periodStart)} → ${warsawDateTime(cycle.periodEnd)}`}
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
