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

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  // Sentence-length values read better at body size.
  const long = typeof value === 'string' && value.length > 12;
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={long ? 'stat-value stat-value-text' : 'stat-value'}>{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ViewBadge({ badge }: { badge: BadgeView }) {
  return <Badge tone={badge.tone}>{badge.label}</Badge>;
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
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={ariaMax}
        aria-valuenow={ariaNow}
        aria-valuetext={`${value} / ${max}`}
        aria-label={label}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
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
      {freshnessLabel(checkedAt)}
      {' · '}
      <a href={href}>Обновить</a>
    </p>
  );
}

export function Legend() {
  return (
    <details className="legend card">
      <summary>Как читать</summary>
      <div className="legend-body">
        <div>
          <h4>Путь темы</h4>
          <div className="row">
            <ViewBadge badge={draftStatusBadge('collecting')} /><span aria-hidden="true">→</span>
            <ViewBadge badge={draftStatusBadge('pending_confirmation')} /><span aria-hidden="true">→</span>
            <ViewBadge badge={draftStatusBadge('confirmed')} /><span aria-hidden="true">→</span>
            <ViewBadge badge={draftStatusBadge('scored')} />
          </div>
          <p className="muted small">
            «Подтверждено» — участник согласился с текстом, итог ещё считается; «Итог оценён» — готов обезличенный итог с оценкой.
          </p>
          <ul className="muted small">
            <li><ViewBadge badge={draftStatusBadge('pending_clarification')} /> — бот переспрашивает участника.</li>
            <li><ViewBadge badge={draftStatusBadge('declined')} /> — участник отказался обсуждать тему; черновик удалён.</li>
            <li><ViewBadge badge={draftStatusBadge('reset')} /> — участник отверг весь Bundle; тема собирается заново.</li>
            <li><ViewBadge badge={draftStatusBadge('no_data')} /> — записи по теме нет или цикл закрылся до подтверждения.</li>
            <li><ViewBadge badge={draftStatusBadge('insufficient_evidence')} /> — итог есть, но оценки нет.</li>
          </ul>
        </div>
        <div>
          <h4>Цвета сигналов</h4>
          <div className="row">
            <Badge tone="success">Позитивно</Badge>
            <Badge tone="warning">Смешанно</Badge>
            <Badge tone="danger">Негативно</Badge>
            <Badge tone="neutral">Нет оценки</Badge>
          </div>
        </div>
        <div>
          <h4>Оценка</h4>
          <p className="small">От 0 до 100: чем выше, тем лучше.</p>
        </div>
        <div>
          <h4>Обезличено</h4>
          <p className="small">
            Текст переписан без имён и узнаваемых деталей. Автор показан для проверки обезличивания:
            сверьте итог с исходным диалогом.
          </p>
        </div>
      </div>
    </details>
  );
}
