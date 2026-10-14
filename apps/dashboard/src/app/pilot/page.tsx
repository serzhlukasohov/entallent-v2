import type { AdminV2PilotCycle, AdminV2PilotQuestion } from '@entalent/contracts';
import { Nav } from '../components/Nav';
import { fetchAdminV2Pilot } from '../lib';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GROUPS = [
  ['autonomy', 'Автономия'],
  ['growth', 'Развитие'],
  ['purpose', 'Смысл'],
  ['belonging', 'Принадлежность'],
] as const;

function warsaw(instant: string | null): string {
  if (!instant) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(instant));
}

function cycleStage(cycle: AdminV2PilotCycle, now: number): string {
  const start = Date.parse(cycle.periodStart);
  const end = Date.parse(cycle.periodEnd);
  if (now < start) return 'Ожидает начала';
  if (now < end) return 'Сбор идёт';
  if (now < end + 15 * 60_000) return 'Ожидание обработки';
  return 'Цикл завершён';
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 650, marginTop: 4 }}>{value}</div>
      {note && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 5 }}>{note}</div>}
    </div>
  );
}

function QuestionTable({ questions }: { questions: AdminV2PilotQuestion[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: 8 }}>Группа</th><th style={{ padding: 8 }}>Тема</th>
            <th style={{ padding: 8 }}>В работе</th><th style={{ padding: 8 }}>Готово</th>
            <th style={{ padding: 8 }}>Без данных</th><th style={{ padding: 8 }}>Подтверждено</th>
            <th style={{ padding: 8 }}>Оценено</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.flatMap(([group, label]) => questions
            .filter((question) => question.group === group)
            .map((question) => (
              <tr key={question.stableKey} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 8 }}>{label}</td><td style={{ padding: 8 }}>{question.title}</td>
                <td style={{ padding: 8 }}>{question.working}</td><td style={{ padding: 8 }}>{question.ready}</td>
                <td style={{ padding: 8 }}>{question.noData}</td><td style={{ padding: 8 }}>{question.confirmed}</td>
                <td style={{ padding: 8 }}>{question.finalScored}</td>
              </tr>
            )))}
        </tbody>
      </table>
    </div>
  );
}

function Cycle({ cycle, now, current }: { cycle: AdminV2PilotCycle; now: number; current: boolean }) {
  const cutoffPassed = now >= Date.parse(cycle.periodEnd);
  const requiredContributors = 5;
  const missing = Math.max(0, requiredContributors - cycle.autonomyScoredParticipants);
  const reportState = cycle.sentReports > 0
    ? 'Отчёт отправлен'
    : cutoffPassed && cycle.autonomyScoredParticipants >= requiredContributors
      ? 'Цикл закрыт; отправка отчёта не подтверждена'
    : cycle.autonomyScoredParticipants < requiredContributors
      ? cutoffPassed
        ? 'Порог не достигнут до отсечки'
        : `Нужно ещё ${missing} ${missing === 1 ? 'участник' : missing < 5 ? 'участника' : 'участников'} с Автономией 3/3`
      : 'Порог достигнут; проверка и отправка отчёта отдельно';

  const content = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <h2 style={{ fontSize: 19 }}>{current ? 'Текущий цикл' : cycle.state === 'upcoming' ? 'Следующий цикл' : 'Завершённый цикл'} · {cycleStage(cycle, now)}</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 5 }}>
            {warsaw(cycle.periodStart)} → {warsaw(cycle.periodEnd)} (Варшава)
          </p>
        </div>
        <span style={{ color: cycle.sentReports > 0 ? 'var(--green)' : 'var(--text-muted)', fontSize: 13 }}>
          {reportState}
        </span>
      </div>

      {current && !cutoffPassed && <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
        До отсечки {Math.ceil((Date.parse(cycle.periodEnd) - now) / 3_600_000)} ч · входящих обработано {cycle.processed}/{cycle.inbound}.
        Счётчики ниже относятся к разным объектам: участникам, темам и квитанциям; число готовых смыслов может уменьшиться после подтверждения.
      </p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 22 }}>
        <Metric label="1 · Начали беседу" value={`${cycle.participants} / ${cycle.rosterSize}`} note="участники когорты" />
        <Metric label="2 · Смыслы готовы" value={cycle.readyMeanings} note={`темы; полных групп: ${cycle.completeGroups}`} />
        <Metric label="3 · Уведомлены об отчёте" value={cycle.deliveredDisclosures} note="квитанции доставки" />
        <Metric label="4 · Bundle доставлены" value={cycle.deliveredBundles} note="группы на подтверждении" />
        <Metric label="5 · Ответы на Bundle" value={cycle.autonomyVerdicts} note="квитанции по Автономии" />
        <Metric label="6 · Автономия 3/3" value={`${cycle.autonomyScoredParticipants} / ${requiredContributors}`} note="участники; порог отчёта" />
      </div>

      <div style={{ marginTop: 18, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Отчёт менеджеру: {reportState}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          Для промежуточного отчёта нужны пять разных участников с тремя итоговыми оценками Автономии до отсечки.
          Счётчик 3/3 не подтверждает проверку приватности и активной роли получателя; их проверяют отдельно перед отправкой.
          Снимков отчёта: {cycle.reportSnapshots}, отправлено: {cycle.sentReports}.
        </p>
      </div>

      <h3 style={{ fontSize: 16, marginTop: 26, marginBottom: 10 }}>Три темы Автономии</h3>
      <QuestionTable questions={cycle.questions.filter((question) => question.group === 'autonomy')} />

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Технические подробности и остальные темы</summary>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>
          Когорта: {cycle.cohortId} · версия определения: {cycle.definitionVersion} · политика: {cycle.scoringPolicyVersion}
          {' · '}маршрут менеджера {cycle.managerTargetConfigured ? 'настроен' : 'не настроен'}
          {' · '}последнее входящее: {warsaw(cycle.lastInboundAt)}.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Окна V2: {cycle.windows} · готовые смыслы: {cycle.readyMeanings} · полные группы для Bundle: {cycle.completeGroups}
          {' · '}Bundle всего: {cycle.bundles} · ожидают ответа: {cycle.awaitingBundles}
          {' · '}в статусе resolved: {cycle.resolvedBundles} · без данных: {cycle.noDataMeanings}
          {' · '}финальные оценки: {cycle.finalScored} · недостаточно данных: {cycle.finalInsufficient}.
          Статус resolved не сохраняется после очистки Bundle; для прогресса смотрите квитанции выше.
        </p>
        <QuestionTable questions={cycle.questions.filter((question) => question.group !== 'autonomy')} />
      </details>
    </>
  );

  if (!current) {
    return (
      <details style={{ marginTop: 18, padding: 20, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface2)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          Завершённый цикл · {warsaw(cycle.periodStart)}–{warsaw(cycle.periodEnd)} · Автономия 3/3: {cycle.autonomyScoredParticipants}/{requiredContributors}
        </summary>
        <div style={{ marginTop: 18 }}>{content}</div>
      </details>
    );
  }

  return <section style={{ marginTop: 28, padding: 24, border: '1px solid var(--border)', borderRadius: 14, background: 'var(--surface2)' }}>{content}</section>;
}

export default async function PilotPage() {
  const data = await fetchAdminV2Pilot();
  const now = data ? Date.parse(data.checkedAt) : Date.now();

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 80px' }}>
      <Nav active="pilot" />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 650 }}>Insight Analysis V2 · пилот</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 5 }}>
            Агрегированный ход теста. Тексты бесед, имена и персональные оценки здесь не отображаются.
          </p>
        </div>
        <a href="/pilot" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>Обновить</a>
      </div>

      {!data ? (
        <div style={{ padding: 24, marginTop: 24, background: 'var(--surface)', borderRadius: 10 }}>
          Данные недоступны. Проверьте соединение с API и настройки внутреннего дашборда.
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>
            Проверено: {warsaw(data.checkedAt)} (Варшава). Данные обновляются при открытии страницы.
          </p>
          {data.cycles.length === 0 && <p style={{ marginTop: 28 }}>Для этого тенанта нет циклов V2.</p>}
          {data.cycles.length > 0 && !data.cycles.some((cycle) => cycle.state === 'active') && (
            <p style={{ marginTop: 28 }}>Активного цикла сейчас нет; ниже — завершённые циклы.</p>
          )}
          {data.cycles.map((cycle) => <Cycle key={cycle.cohortId} cycle={cycle} now={now} current={cycle.state === 'active'} />)}
        </>
      )}
    </main>
  );
}
