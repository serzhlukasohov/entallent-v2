import { TeamTable } from './components/TeamTable';
import { Nav } from './components/Nav';
import { fetchAdminManagerTeam } from './lib';
import type { AdminManagerTeamResponse } from '@entalent/contracts';

export default async function DashboardPage() {
  const data = await fetchAdminManagerTeam();

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="team" />
      <Header data={data} />
      {!data ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          Failed to load data. Check TENANT_ID and ADMIN_API_KEY in .env.
        </div>
      ) : data.employees.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          No employees in this tenant.
        </div>
      ) : (
        <TeamTable employees={data.employees} />
      )}
    </main>
  );
}

function Header({ data }: { data: AdminManagerTeamResponse | null }) {
  const scored = data?.employees.filter((e) => e.scoredCount > 0).length ?? 0;
  const total = data?.teamSize ?? 0;
  const risks = data?.employees.filter((e) => e.hasActiveRisk).length ?? 0;
  const updated = data
    ? new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Team Q12 Pulse</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>updated at {updated}</span>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <Stat label="Total" value={String(total)} />
        <Stat label="Has data" value={String(scored)} accent="var(--green)" />
        {risks > 0 && <Stat label="Risk signals" value={String(risks)} accent="var(--risk)" />}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '12px 20px',
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
