import { Nav } from '../components/Nav';
import { fetchAdminManagerTrends, fetchAdminV2Pilot } from '../lib';
import { EngagementChart, SignalChart, CoverageFunnel, QuestionSentimentChart } from './charts';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TrendsPage() {
  const [data, pilot] = await Promise.all([fetchAdminManagerTrends(14, 0), fetchAdminV2Pilot()]);

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="trends" />
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>Trends</h1>

      <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>V2 · ход пилота по циклам</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
          Каждый цикл и его участники считаются отдельно. «Готовые смыслы» показывают текущее состояние и могут уменьшиться после подтверждения; остальные этапы имеют свои единицы счёта. Личных записей и оценок здесь нет.
        </p>
        {!pilot ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Данные V2 сейчас недоступны.</p>
        ) : pilot.cycles.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Циклы V2 не найдены.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 8 }}>Цикл (Варшава)</th>
                  <th style={{ padding: 8 }}>Начали</th>
                  <th style={{ padding: 8 }}>Обработано</th>
                  <th style={{ padding: 8 }}>Готовые смыслы</th>
                  <th style={{ padding: 8 }}>Bundle доставлены</th>
                  <th style={{ padding: 8 }}>Автономия 3/3</th>
                  <th style={{ padding: 8 }}>Отчёты</th>
                </tr>
              </thead>
              <tbody>
                {pilot.cycles.map((cycle) => (
                  <tr key={cycle.cohortId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                      {new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(cycle.periodStart))}
                      {' → '}
                      {new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(cycle.periodEnd))}
                    </td>
                    <td style={{ padding: 8 }}>{cycle.participants}/{cycle.rosterSize}</td>
                    <td style={{ padding: 8 }}>{cycle.processed}/{cycle.inbound}</td>
                    <td style={{ padding: 8 }}>{cycle.readyMeanings}</td>
                    <td style={{ padding: 8 }}>{cycle.deliveredBundles}</td>
                    <td style={{ padding: 8 }}>{cycle.autonomyScoredParticipants}/5</td>
                    <td style={{ padding: 8 }}>{cycle.sentReports}/{cycle.reportSnapshots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Прежние данные Pulse</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Это отдельная прежняя аналитика, её ограничение по размеру группы не относится к таблице V2 выше.
        {data && ` Период: ${data.rangeStart} → ${data.rangeEnd}.`}
      </p>

      {!data ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          Прежние данные Pulse сейчас недоступны.
        </div>
      ) : data.suppressed ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          Прежние тренды скрыты: в одной из групп менее пяти участников.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
            gap: 16,
          }}
        >
          <EngagementChart data={data.engagement} />
          <SignalChart data={data.signalCapture} />
          <CoverageFunnel data={data.coverageFunnel} />
          <QuestionSentimentChart data={data.questionSentiment} />
        </div>
      )}
    </main>
  );
}
