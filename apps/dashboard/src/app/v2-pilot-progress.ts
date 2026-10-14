import type { AdminV2PilotCohortState, AdminV2PilotPerson } from '@entalent/contracts';

function warsawDate(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(instant));
}

/** Only a cohort whose period is running is called the current cycle. */
export function cohortLabel(cohort: { state: AdminV2PilotCohortState; periodStart: string; periodEnd: string }): string {
  const period = `${warsawDate(cohort.periodStart)} → ${warsawDate(cohort.periodEnd)} (Варшава)`;
  if (cohort.state === 'active') return `Текущий цикл · ${period}`;
  if (cohort.state === 'upcoming') return `Цикл ещё не начался · ${period}`;
  return `Завершённый цикл · ${period} · активного цикла сейчас нет`;
}

export function questionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    collecting: 'Черновик, не подтверждён',
    pending_confirmation: 'Ожидает подтверждения',
    pending_clarification: 'Нужно уточнение',
    confirmed: 'Подтверждено',
    declined: 'Отклонено',
    no_data: 'Нет данных по теме',
    reset: 'Сбор начат заново',
    scored: 'Итог оценён',
    insufficient_evidence: 'Недостаточно данных для оценки',
  };
  return labels[status] ?? status;
}

export function personProgress(person: AdminV2PilotPerson): { stage: string; nextStep: string } {
  const autonomy = person.questions.filter((question) => question.group === 'autonomy');
  const scored = autonomy.filter((question) => question.outcome === 'scored').length;
  const finalized = autonomy.filter((question) => question.outcome !== null).length;
  const ready = autonomy.filter((question) => question.ready).length;
  const working = autonomy.filter((question) => question.workingSummary).length;

  if (scored === 3) return { stage: 'Автономия 3/3', nextStep: 'Итог готов для проверки порога отчёта' };
  if (finalized === 3) return { stage: `Автономия завершена · оценено ${scored}/3`, nextStep: 'Проверить темы без достаточных данных' };
  if (person.inbound === 0) return { stage: 'Беседа не начата', nextStep: 'Ждём первого диалога' };
  if (ready === 3) return { stage: 'Три смысла готовы', nextStep: 'Проверить Bundle и ответ участника' };
  if (finalized > 0) return { stage: `Итоги Автономии ${finalized}/3`, nextStep: 'Проверить оставшиеся темы Автономии' };
  if (working > 0 || ready > 0) return {
    stage: `Автономия в работе · готово ${ready}/3`,
    nextStep: 'Продолжить диалог по недостающим темам',
  };
  if (person.questions.some((question) => question.workingSummary)) return {
    stage: 'Есть записи по другим группам',
    nextStep: 'Проверить охват Автономии',
  };
  return { stage: 'Диалог есть, записей пока нет', nextStep: 'Проверить обработку и продолжить диалог' };
}
