import { CompanyText, CompanyLabel, CompanyProgressTrack } from '../company-language';
import type { ReactNode } from 'react';
import { draftStatusBadge, freshnessLabel, initials, type BadgeTone, type BadgeView } from '../v2-pilot-progress';

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {children}
    </header>
  );
}

export function Stat({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  // Sentence-length values read better at body size.
  const long = typeof value === 'string' && value.length > 12;
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={long ? 'stat-value stat-value-text' : 'stat-value'}>{value}</div>
      {note && <div className="stat-note">{typeof note === 'string' ? <CompanyLabel label={note} /> : note}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ViewBadge({ badge }: { badge: BadgeView }) {
  return <Badge tone={badge.tone}><CompanyLabel label={badge.label} /></Badge>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  // Without a positive max there is nothing to fill; the visible text still reports the raw numbers.
  const ariaMax = max > 0 ? max : 1;
  const ariaNow = max > 0 ? Math.min(Math.max(value, 0), max) : 0;
  const percent = Math.round((ariaNow / ariaMax) * 100);
  return (
    <div className="progress">
      <CompanyProgressTrack value={ariaNow} max={ariaMax} label={label}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </CompanyProgressTrack>
      <span className="progress-label">{value} / {max}</span>
    </div>
  );
}

export function Initials({ name }: { name: string }) {
  return <span className="initials" aria-hidden="true">{initials(name)}</span>;
}

/** Date and time of the latest API read plus a plain link that reloads the same URL; no polling. */
export function Freshness({ checkedAt, href }: { checkedAt: (string | null | undefined)[]; href: string }) {
  return (
    <p className="freshness muted small">
      <CompanyLabel label={freshnessLabel(checkedAt)} />
      {' · '}
      <a href={href}><CompanyText k="ui.085" /></a>
    </p>
  );
}

export function Legend() {
  return (
    <details className="legend card">
      <summary><CompanyText k="ui.086" /></summary>
      <div className="legend-body">
        <div>
          <h4><CompanyText k="ui.087" /></h4>
          <div className="row">
            <ViewBadge badge={draftStatusBadge('collecting')} /><span aria-hidden="true">→</span>
            <ViewBadge badge={draftStatusBadge('pending_confirmation')} /><span aria-hidden="true">→</span>
            <ViewBadge badge={draftStatusBadge('confirmed')} /><span aria-hidden="true">→</span>
            <ViewBadge badge={draftStatusBadge('scored')} />
          </div>
          <p className="muted small">
            <CompanyText k="ui.088" /></p>
          <ul className="muted small">
            <li><ViewBadge badge={draftStatusBadge('pending_clarification')} /> <CompanyText k="ui.089" /></li>
            <li><ViewBadge badge={draftStatusBadge('declined')} /> <CompanyText k="ui.090" /></li>
            <li><ViewBadge badge={draftStatusBadge('reset')} /> <CompanyText k="ui.091" /></li>
            <li><ViewBadge badge={draftStatusBadge('no_data')} /> <CompanyText k="ui.092" /></li>
            <li><ViewBadge badge={draftStatusBadge('insufficient_evidence')} /> <CompanyText k="ui.093" /></li>
          </ul>
        </div>
        <div>
          <h4><CompanyText k="ui.094" /></h4>
          <div className="row">
            <Badge tone="success"><CompanyText k="ui.095" /></Badge>
            <Badge tone="warning"><CompanyText k="ui.096" /></Badge>
            <Badge tone="danger"><CompanyText k="ui.097" /></Badge>
            <Badge tone="neutral"><CompanyText k="ui.098" /></Badge>
          </div>
        </div>
        <div>
          <h4><CompanyText k="ui.099" /></h4>
          <p className="small"><CompanyText k="ui.100" /></p>
        </div>
        <div>
          <h4><CompanyText k="ui.101" /></h4>
          <p className="small">
            <CompanyText k="ui.102" /></p>
        </div>
      </div>
    </details>
  );
}
