import Link from 'next/link';
import { Nav } from '../../components/Nav';
import { fetchApi } from '../../lib';
import type { QuestionInsight, UserInsightsResponse } from '../../types';

const GROUP_LABELS: Record<string, string> = {
  autonomy: 'Autonomy',
  belonging: 'Belonging',
  engagement: 'Engagement',
  growth: 'Growth',
  purpose: 'Purpose',
};

// engagement always last — it's a numeric summary group, not a qualitative insight category
const GROUP_ORDER = ['autonomy', 'belonging', 'growth', 'purpose', 'engagement'];

const STATUS_LABEL: Record<string, string> = {
  scored: 'Scored',
  covered: 'Covered',
  partially_covered: 'Partial',
  insufficient_evidence: 'Insufficient data',
  needs_review: 'Under review',
  suppressed: 'Suppressed',
  unknown: '—',
};

const POLARITY_LABEL: Record<string, { label: string; color: string }> = {
  positive: { label: '+ Positive', color: '#10b981' },
  negative: { label: '− Negative', color: '#ef4444' },
  mixed: { label: '~ Mixed', color: '#f59e0b' },
  neutral: { label: '· Neutral', color: 'var(--text-muted)' },
};

/**
 * Reconcile the assessment status with whether an insight actually exists, so the
 * status chip/dot never contradicts the card body. Status (survey_assessments) and
 * insight text (survey_evidence) live in separate tables and can drift:
 *  - evidence present but low confidence/completeness → don't say "No data", say "Collected";
 *  - no live evidence → "No data" regardless of a stale assessment row.
 */
function displayStatus(q: QuestionInsight): { label: string; dot: string } {
  const hasData = Boolean(q.currentState || q.rootCause);

  if (!hasData) return { label: 'No data', dot: 'var(--border)' };

  const s = q.assessmentStatus;
  if (s === 'scored' || s === 'covered') return { label: STATUS_LABEL[s], dot: '#10b981' };
  if (s === 'partially_covered') return { label: 'Partial', dot: '#f59e0b' };
  if (s === 'needs_review') return { label: 'Under review', dot: '#8b5cf6' };
  if (s === 'suppressed') return { label: 'Suppressed', dot: 'var(--border)' };
  // Insight exists but confidence/completeness is low (insufficient_evidence / unknown / null):
  // show it as collected rather than "no data".
  return { label: 'Collected', dot: '#3b82f6' };
}

export default async function UserInsightsPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const data = await fetchApi<UserInsightsResponse>(
    `/admin/users/${userId}/insights`,
    0,
  );

  if (!data || !data.windowId) {
    return (
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
        <Nav active="pulse" />
        <Link href="/pulse" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to Pulse
        </Link>
        <p style={{ marginTop: 32, color: 'var(--text-muted)' }}>
          No active survey window for this user.
        </p>
      </main>
    );
  }

  // Group questions
  const byGroup: Record<string, QuestionInsight[]> = {};
  for (const q of data.questions) {
    if (!byGroup[q.group]) byGroup[q.group] = [];
    byGroup[q.group].push(q);
  }

  const groups = Object.keys(byGroup).sort(
    (a, b) =>
      (GROUP_ORDER.indexOf(a) === -1 ? 99 : GROUP_ORDER.indexOf(a)) -
      (GROUP_ORDER.indexOf(b) === -1 ? 99 : GROUP_ORDER.indexOf(b)),
  );

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="pulse" />
      <Link href="/pulse" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← Back to Pulse
      </Link>

      <div style={{ marginTop: 20, marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
          Employee Insights
        </h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          ID: {userId}
          {data.periodEnd && (
            <> · Window ends: {new Date(data.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No questions found for this survey window.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {groups.map((group) => (
            <section key={group}>
              <h2
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                {GROUP_LABELS[group] ?? group}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {byGroup[group].map((q) => (
                  <InsightRow key={q.questionId} q={q} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 40, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Legend dot="#10b981" label="Scored / Covered" />
        <Legend dot="#f59e0b" label="Partial" />
        <Legend dot="#3b82f6" label="Collected" />
        <Legend dot="#8b5cf6" label="Under review" />
        <Legend dot="var(--border)" label="No data" />
      </div>
    </main>
  );
}

function InsightRow({ q }: { q: QuestionInsight }) {
  const polarity = q.polarity ? POLARITY_LABEL[q.polarity] : null;
  const hasData = q.currentState || q.rootCause;
  const status = displayStatus(q);

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: '24px 1fr',
        gap: '0 12px',
      }}
    >
      {/* Status dot */}
      <div style={{ paddingTop: 3 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: status.dot,
          }}
        />
      </div>

      <div>
        {/* Question title + status */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{q.title}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {status.label}
          </span>
          {q.score !== null && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: q.score >= 60 ? '#10b981' : q.score >= 35 ? '#f59e0b' : '#ef4444',
              }}
            >
              {q.score.toFixed(0)} / 100
            </span>
          )}
          {polarity && (
            <span style={{ fontSize: 11, color: polarity.color }}>{polarity.label}</span>
          )}
        </div>

        {/* Canonical meaning (subtitle) */}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: hasData ? 10 : 0 }}>
          {q.canonicalMeaning}
        </div>

        {/* Current state + root cause */}
        {hasData && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: q.currentState && q.rootCause ? '1fr 1fr' : '1fr',
              gap: 12,
              marginTop: 6,
            }}
          >
            {q.currentState && (
              <InfoBlock
                label="Current State"
                text={q.currentState}
                accentColor="#3b82f6"
              />
            )}
            {q.rootCause && (
              <InfoBlock
                label={q.currentState ? 'Root Cause' : 'Evidence'}
                text={q.rootCause}
                accentColor={polarity?.color ?? 'var(--text-muted)'}
              />
            )}
          </div>
        )}

        {!hasData && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No data yet — insights will appear after conversations with this employee.
          </div>
        )}

        {/* Timestamps */}
        {(q.assessedAt || q.evidenceUpdatedAt) && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
            {q.assessedAt && (
              <span>
                Assessed: {new Date(q.assessedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {q.evidenceUpdatedAt && (
              <span>
                Evidence: {new Date(q.evidenceUpdatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBlock({
  label,
  text,
  accentColor,
}: {
  label: string;
  text: string | null;
  accentColor: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface2)',
        borderRadius: 8,
        padding: '10px 12px',
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: text ? 'var(--text)' : 'var(--text-muted)', fontStyle: text ? 'normal' : 'italic', lineHeight: 1.5 }}>
        {text ?? 'Not enough data'}
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
