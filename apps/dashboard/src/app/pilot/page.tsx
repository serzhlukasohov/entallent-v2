import type { AdminV2PilotCycle } from '@entalent/contracts';
import { Nav } from '../components/Nav';
import { fetchAdminV2Pilot } from '../lib';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GROUPS = [
  ['autonomy', 'Автономия'],
  ['growth', 'Развитие'],
  ['purpose', 'Смысл'],
  ['belonging', 'Принадлежность'],
] as const;

function warsaw(instant: string | null): string {
  if (!instant) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(instant));
}

function cycleStage(cycle: AdminV2PilotCycle, now: number): string {
  const start = Date.parse(cycle.periodStart);
  const end = Date.parse(cycle.periodEnd);
  if (now < start) return 'Ожидает начала';
  if (now < end) return 'Сбор идёт';
  if (now < end + 15 * 60_000) return 'Ожидание обработки';
  return 'Цикл завершён';
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 650, marginTop: 4 }}>{value}</div>
    </div>
  );
}

export default async function PilotPage() {
  const data = await fetchAdminV2Pilot();
  const now = data ? Date.parse(data.checkedAt) : Date.now();

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 80px' }}>
      <Nav active="pilot" />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 650 }}>Insight Analysis V2 · пилот</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 5 }}>
            Только статусы обработки. Тексты бесед, имена и персональные оценки здесь не отображаются.
          </p>
        </div>
        <a href="/pilot" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>Обновить</a>
      </div>

      {!data ? (
        <div style={{ padding: 24, marginTop: 24, background: 'var(--surface)', borderRadius: 10 }}>
          Данные недоступны. Проверьте соединение с API и настройки внутреннего дашборда.
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>
            Проверено: {warsaw(data.checkedAt)} (Варшава). Циклы и отчёты считаются отдельно.
          </p>
          {data.cycles.length === 0 && <p style={{ marginTop: 28 }}>Для этого тенанта нет циклов V2.</p>}
          {data.cycles.map((cycle) => (
            <section key={cycle.cohortId} style={{ marginTop: 30, padding: 24, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 19 }}>{cycleStage(cycle, now)}</h2>
                  <p style={{ color: 'var(--text-muted)', marginTop: 5 }}>
                    {warsaw(cycle.periodStart)} → {warsaw(cycle.periodEnd)} · политика {cycle.scoringPolicyVersion}
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Когорта: {cycle.cohortId}</p>
                </div>
                <span style={{ color: cycle.managerTargetConfigured ? 'var(--green)' : 'var(--yellow)', fontSize: 13 }}>
                  {cycle.managerTargetConfigured ? 'Маршрут менеджера настроен' : 'Маршрут менеджера не настроен'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginTop: 22 }}>
                <Metric label="Участники" value={`${cycle.participants} / ${cycle.rosterSize}`} />
                <Metric label="Сообщения обработаны" value={`${cycle.processed} / ${cycle.inbound}`} />
                <Metric label="Окна V2" value={cycle.windows} />
                <Metric label="Смыслы готовы" value={cycle.readyMeanings} />
                <Metric label="Полные группы 3/3" value={cycle.completeGroups} />
                <Metric label="Подтверждения" value={`${cycle.resolvedBundles} / ${cycle.bundles}`} />
                <Metric label="Финальные оценки" value={cycle.finalScored} />
                <Metric label="Отчёты отправлены" value={`${cycle.sentReports} / ${cycle.reportSnapshots}`} />
              </div>
              <p style={{ color: 'var(--text-muted)', marginTop: 16, fontSize: 13 }}>
                Последнее входящее: {warsaw(cycle.lastInboundAt)} · ожидают ответа: {cycle.awaitingBundles}
                {' · '}без данных после отсечки: {cycle.noDataMeanings}
                {' · '}недостаточно подтверждённых данных для оценки: {cycle.finalInsufficient}
              </p>

              <h3 style={{ fontSize: 16, marginTop: 28, marginBottom: 10 }}>Темы и этапы сбора</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: 8 }}>Группа</th><th style={{ padding: 8 }}>Тема</th>
                      <th style={{ padding: 8 }}>В работе</th><th style={{ padding: 8 }}>Готово</th>
                      <th style={{ padding: 8 }}>Без данных</th><th style={{ padding: 8 }}>Подтверждено</th>
                      <th style={{ padding: 8 }}>Оценено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GROUPS.flatMap(([group, label]) => cycle.questions
                      .filter((question) => question.group === group)
                      .map((question) => (
                        <tr key={question.stableKey} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 8 }}>{label}</td><td style={{ padding: 8 }}>{question.title}</td>
                          <td style={{ padding: 8 }}>{question.working}</td><td style={{ padding: 8 }}>{question.ready}</td>
                          <td style={{ padding: 8 }}>{question.noData}</td><td style={{ padding: 8 }}>{question.confirmed}</td>
                          <td style={{ padding: 8 }}>{question.finalScored}</td>
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
