import { Nav } from '../components/Nav';
import { fetchApi, TENANT_ID } from '../lib';
import type { TrendsResult } from '../types';
import { EngagementChart, SignalChart, CoverageFunnel, QuestionSentimentChart } from './charts';

const WINDOW_DAYS = 14;

export default async function TrendsPage() {
  const data = await fetchApi<TrendsResult>(
    `/admin/manager/trends?tenantId=${TENANT_ID}&days=${WINDOW_DAYS}`,
  );

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="trends" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Тренды</h1>
        {data && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {data.rangeStart} → {data.rangeEnd}
          </span>
        )}
      </div>

      {!data ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          Не удалось загрузить данные. Проверьте TENANT_ID и ADMIN_API_KEY.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 16 }}>
          <EngagementChart data={data.engagement} />
          <SignalChart data={data.signalCapture} />
          <CoverageFunnel data={data.coverageFunnel} />
          <QuestionSentimentChart data={data.questionSentiment} />
        </div>
      )}
    </main>
  );
}
