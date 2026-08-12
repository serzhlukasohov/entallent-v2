import { Nav } from '../components/Nav';
import { fetchAdminManagerTrends } from '../lib';
import { EngagementChart, SignalChart, CoverageFunnel, QuestionSentimentChart } from './charts';

export default async function TrendsPage() {
  const data = await fetchAdminManagerTrends();

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="trends" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Trends</h1>
        {data && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {data.rangeStart} → {data.rangeEnd}
          </span>
        )}
      </div>

      {!data ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          Failed to load data. Check TENANT_ID and ADMIN_API_KEY.
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
