import type { EngagementPoint, SignalPoint, QuestionSentiment } from '../types';

const C = {
  green: 'var(--green)',
  red: 'var(--red)',
  yellow: 'var(--yellow)',
  grey: 'var(--text-muted)',
  blue: 'var(--blue)',
};

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function dayLabel(date: string): string {
  return date.slice(5); // MM-DD
}

/** Engagement: inbound messages as bars + active users as an overlaid dot/line. */
export function EngagementChart({ data }: { data: EngagementPoint[] }) {
  const maxMsg = Math.max(1, ...data.map((d) => d.inboundMessages));
  const maxUsers = Math.max(1, ...data.map((d) => d.activeUsers));
  const H = 120;

  return (
    <Card title="Вовлечённость" subtitle="входящие сообщения (столбцы) · активные юзеры (точки) в день">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: H, position: 'relative' }}>
        {data.map((d) => {
          const msgH = (d.inboundMessages / maxMsg) * (H - 20);
          const userY = H - 20 - (d.activeUsers / maxUsers) * (H - 30);
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', position: 'relative' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                {d.inboundMessages || ''}
              </span>
              <div
                title={`${d.date}: ${d.inboundMessages} сообщений, ${d.activeUsers} активных`}
                style={{ width: '70%', height: Math.max(2, msgH), background: C.blue, borderRadius: '3px 3px 0 0', opacity: d.inboundMessages ? 0.85 : 0.2 }}
              />
              {d.activeUsers > 0 && (
                <div
                  style={{ position: 'absolute', top: userY, width: 7, height: 7, borderRadius: '50%', background: C.green, border: '1px solid var(--bg)' }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {data.map((d) => (
          <span key={d.date} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
            {dayLabel(d.date)}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** Signal capture: stacked bars per day by polarity. */
export function SignalChart({ data }: { data: SignalPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const H = 120;
  const segs: Array<[keyof SignalPoint, string]> = [
    ['negative', C.red],
    ['mixed', C.yellow],
    ['neutral', C.grey],
    ['positive', C.green],
  ];

  return (
    <Card title="Захват сигнала" subtitle="записи evidence в день, по полярности">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: H }}>
        {data.map((d) => (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 2 }}>
              {d.total || ''}
            </span>
            <div
              title={`${d.date}: 🟢${d.positive} 🔴${d.negative} 🟡${d.mixed} ⚪${d.neutral}`}
              style={{ display: 'flex', flexDirection: 'column', height: (d.total / max) * (H - 20), minHeight: d.total ? 2 : 0 }}
            >
              {segs.map(([k, color]) => {
                const v = d[k] as number;
                if (!v) return null;
                return <div key={k} style={{ flex: v, background: color, opacity: 0.85 }} />;
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {data.map((d) => (
          <span key={d.date} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
            {dayLabel(d.date)}
          </span>
        ))}
      </div>
    </Card>
  );
}

const FUNNEL_LABELS: Record<string, string> = {
  unknown: 'Неизвестно',
  insufficient_evidence: 'Недостаточно',
  partially_covered: 'Частично',
  covered: 'Покрыто',
  scored: 'Оценено',
  needs_review: 'На проверку',
  suppressed: 'Скрыто',
};
const FUNNEL_ORDER = ['insufficient_evidence', 'partially_covered', 'covered', 'scored'];
const FUNNEL_COLORS: Record<string, string> = {
  insufficient_evidence: C.grey,
  partially_covered: C.yellow,
  covered: C.blue,
  scored: C.green,
};

export function CoverageFunnel({ data }: { data: Record<string, number> }) {
  const shown = FUNNEL_ORDER.filter((s) => (data[s] ?? 0) > 0);
  const max = Math.max(1, ...shown.map((s) => data[s]));

  return (
    <Card title="Воронка покрытия" subtitle="статусы ассессментов по всем вопросам × сотрудникам">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Нет данных</span>}
        {shown.map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 110, fontSize: 12, color: 'var(--text-muted)' }}>{FUNNEL_LABELS[s]}</span>
            <div style={{ flex: 1, height: 22, background: 'var(--surface2)', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ width: `${(data[s] / max) * 100}%`, height: '100%', background: FUNNEL_COLORS[s], opacity: 0.85, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bg)' }}>{data[s]}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Per-question diverging sentiment bars (net from -1 to +1), most-negative first. */
export function QuestionSentimentChart({ data }: { data: QuestionSentiment[] }) {
  const withData = data.filter((q) => q.net !== null);

  return (
    <Card title="Сентимент по вопросам Q12" subtitle="net = (позитив − негатив) / всего, по когорте · снизу самое проблемное">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {withData.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Нет данных</span>}
        {withData.map((q) => {
          const net = q.net ?? 0;
          const pct = Math.abs(net) * 50; // half-width max
          const positive = net >= 0;
          return (
            <div key={q.stableKey} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 200, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.title}>
                {q.title}
              </span>
              <div style={{ flex: 1, height: 20, position: 'relative', background: 'var(--surface2)', borderRadius: 4 }}>
                {/* center line */}
                <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
                <div
                  title={`net ${net} · +${q.positive}/-${q.negative} (всего ${q.total})`}
                  style={{
                    position: 'absolute',
                    top: 3,
                    bottom: 3,
                    borderRadius: 3,
                    background: positive ? C.green : C.red,
                    opacity: 0.85,
                    ...(positive
                      ? { left: '50%', width: `${pct}%` }
                      : { right: '50%', width: `${pct}%` }),
                  }}
                />
              </div>
              <span style={{ width: 44, textAlign: 'right', fontSize: 11, color: positive ? C.green : C.red }}>
                {net > 0 ? '+' : ''}{net.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
