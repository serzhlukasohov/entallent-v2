'use client';

import { useState } from 'react';
import type { EmployeeRow, QuestionSignal } from '../types';

const POLARITY_COLOR: Record<string, string> = {
  positive: 'var(--green)',
  negative: 'var(--red)',
  mixed: 'var(--yellow)',
  neutral: 'var(--text-muted)',
};

const POLARITY_LABEL: Record<string, string> = {
  positive: 'позитив',
  negative: 'негатив',
  mixed: 'смешанный',
  neutral: 'нейтральный',
};

const STATUS_ORDER: Record<string, number> = {
  scored: 0,
  partially_covered: 1,
  insufficient_evidence: 2,
  unknown: 3,
};

function SignalDot({ signal }: { signal: QuestionSignal }) {
  const color = signal.polarity ? POLARITY_COLOR[signal.polarity] : 'var(--border)';
  const hasData = signal.assessmentStatus !== 'unknown';

  return (
    <div
      title={`${signal.title}\n${signal.polarity ? POLARITY_LABEL[signal.polarity] : 'нет данных'}\n${signal.evidenceSummary ?? ''}`}
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: hasData ? color : 'var(--border)',
        opacity: hasData ? 1 : 0.4,
        flexShrink: 0,
      }}
    />
  );
}

function EvidenceCard({ signal }: { signal: QuestionSignal }) {
  if (!signal.evidenceSummary) return null;
  const color = signal.polarity ? POLARITY_COLOR[signal.polarity] : 'var(--border)';

  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: `1px solid var(--border)`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>
          {signal.title}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {signal.strength !== null && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {Math.round(signal.strength * 100)}%
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color,
              background: `${color}22`,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {signal.polarity ? POLARITY_LABEL[signal.polarity] : '—'}
          </span>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>
        {signal.evidenceSummary}
      </p>
    </div>
  );
}

function EmployeeDetail({ employee }: { employee: EmployeeRow }) {
  const withEvidence = employee.signals
    .filter((s) => s.evidenceSummary)
    .sort((a, b) => (STATUS_ORDER[a.assessmentStatus] ?? 9) - (STATUS_ORDER[b.assessmentStatus] ?? 9));

  const empty = employee.signals.filter((s) => !s.evidenceSummary);

  return (
    <div style={{ padding: '0 20px 20px 20px' }}>
      {withEvidence.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
          {withEvidence.map((s) => (
            <EvidenceCard key={s.stableKey} signal={s} />
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Нет инсайтов — разговоров ещё не было.</p>
      )}
      {empty.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {empty.map((s) => (
            <span
              key={s.stableKey}
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              {s.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelative(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days}д назад`;
  if (days < 30) return `${Math.floor(days / 7)}нед назад`;
  return `${Math.floor(days / 30)}мес назад`;
}

function CoverageBar({ pct, total, scored }: { pct: number; total: number; scored: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 80,
          height: 5,
          background: 'var(--border)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct > 60 ? 'var(--green)' : pct > 30 ? 'var(--yellow)' : 'var(--text-muted)',
            borderRadius: 3,
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {scored}/{total}
      </span>
    </div>
  );
}

export function TeamTable({ employees }: { employees: EmployeeRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr 120px 100px 80px',
          padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          gap: 12,
        }}
      >
        <span>Сотрудник</span>
        <span>Q12 сигналы</span>
        <span>Покрытие</span>
        <span>Активность</span>
        <span></span>
      </div>

      {employees.map((emp) => (
        <div key={emp.userId} style={{ borderBottom: '1px solid var(--border)' }}>
          {/* Main row */}
          <div
            onClick={() => setExpanded(expanded === emp.userId ? null : emp.userId)}
            style={{
              display: 'grid',
              gridTemplateColumns: '200px 1fr 120px 100px 80px',
              padding: '14px 20px',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = '')}
          >
            {/* Name + risk */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                  flexShrink: 0,
                  color: emp.hasActiveRisk ? 'var(--risk)' : 'var(--text)',
                }}
              >
                {emp.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {emp.displayName}
                </div>
                {emp.hasActiveRisk && (
                  <div style={{ fontSize: 10, color: 'var(--risk)', marginTop: 1 }}>
                    ⚠ риск сигнал
                  </div>
                )}
              </div>
            </div>

            {/* Signal dots */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              {emp.signals.map((s) => (
                <SignalDot key={s.stableKey} signal={s} />
              ))}
            </div>

            {/* Coverage bar */}
            <CoverageBar pct={emp.coveragePct} total={emp.totalQuestions} scored={emp.scoredCount} />

            {/* Last active */}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {formatRelative(emp.lastActiveAt)}
            </span>

            {/* Expand toggle */}
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                textAlign: 'right',
                transition: 'transform 0.15s',
                display: 'inline-block',
                transform: expanded === emp.userId ? 'rotate(90deg)' : 'none',
              }}
            >
              ›
            </span>
          </div>

          {/* Expanded detail */}
          {expanded === emp.userId && <EmployeeDetail employee={emp} />}
        </div>
      ))}
    </div>
  );
}
