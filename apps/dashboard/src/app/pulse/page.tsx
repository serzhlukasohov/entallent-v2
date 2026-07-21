import { Nav } from '../components/Nav';
import { fetchApi, TENANT_ID } from '../lib';
import type { PulseOverviewResponse } from '../types';

const GROUP_LABELS: Record<string, string> = {
  autonomy: 'Автономия',
  belonging: 'Принадлежность',
  engagement: 'Вовлечённость',
  growth: 'Рост',
  purpose: 'Смысл',
};

const STATUS_LABELS: Record<string, string> = {
  pending_confirmation: 'Ожидает',
  confirmed: 'Подтверждено',
};

const ASSESSMENT_LABELS: Record<string, string> = {
  scored: 'Оценено',
  partially_covered: 'Частично',
  insufficient_evidence: 'Мало данных',
  unknown: '—',
};

function statusColor(status: string | null): string {
  if (status === 'confirmed') return 'var(--green)';
  if (status === 'pending_confirmation') return '#f59e0b';
  return 'var(--text-muted)';
}

function assessmentColor(status: string | null): string {
  if (status === 'scored') return 'var(--green)';
  if (status === 'partially_covered') return '#f59e0b';
  if (status === 'insufficient_evidence') return 'var(--text-muted)';
  return 'var(--border)';
}

export default async function PulsePage() {
  const data = await fetchApi<PulseOverviewResponse>(
    `/admin/pulse/overview?tenantId=${TENANT_ID}`,
    0,
  );

  const updated = data
    ? new Date(data.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="pulse" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Pulse Check Groups</h1>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>обновлено в {updated}</span>
      </div>

      {!data || data.employees.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', marginTop: 48, textAlign: 'center' }}>
          Нет данных. Убедитесь, что TENANT_ID настроен и сотрудники прошли хотя бы одну оценку.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.employees.map((emp) => (
            <div
              key={emp.userId}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '20px 24px',
              }}
            >
              {/* Employee header */}
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
                {emp.displayName ?? emp.userId.slice(0, 8) + '…'}
              </div>

              {/* Groups grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 12,
                }}
              >
                {emp.groups.map((g) => (
                  <div
                    key={g.questionGroup}
                    style={{
                      background: 'var(--surface2)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    {/* Group name + status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {GROUP_LABELS[g.questionGroup] ?? g.questionGroup}
                      </span>
                      {g.status ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: statusColor(g.status),
                            background: g.status === 'confirmed' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                            padding: '2px 8px',
                            borderRadius: 6,
                          }}
                        >
                          {STATUS_LABELS[g.status] ?? g.status}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Нет данных</span>
                      )}
                    </div>

                    {/* Score */}
                    {g.employeeScore !== null && (
                      <div style={{ marginBottom: 10 }}>
                        <ScoreBar score={g.employeeScore} />
                      </div>
                    )}

                    {/* Questions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {g.questions.map((q) => (
                        <div key={q.stableKey} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: assessmentColor(q.assessmentStatus),
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.3 }}
                            title={ASSESSMENT_LABELS[q.assessmentStatus ?? ''] ?? '—'}
                          >
                            {q.title}
                          </span>
                        </div>
                      ))}
                      {g.questions.length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Нет вопросов</span>
                      )}
                    </div>

                    {/* Confirmed at */}
                    {g.confirmedAt && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(g.confirmedAt).toLocaleDateString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 28, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Legend dot="var(--green)" label="Оценено / Подтверждено" />
        <Legend dot="#f59e0b" label="Частично / Ожидает подтверждения" />
        <Legend dot="var(--text-muted)" label="Мало данных" />
        <Legend dot="var(--border)" label="Нет данных" />
      </div>
    </main>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 60 ? 'var(--green)' : pct >= 35 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Индекс</span>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{score.toFixed(1)}</span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}
