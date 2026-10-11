import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Nav } from '../../components/Nav';
import { fetchAdminV2PilotPeople } from '../../lib';
import { personProgress, questionStatusLabel } from '../../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GROUPS = [
  ['autonomy', 'Автономия'], ['growth', 'Развитие'],
  ['purpose', 'Смысл'], ['belonging', 'Принадлежность'],
] as const;

export default async function UserInsightsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const data = await fetchAdminV2PilotPeople();
  const person = data?.people.find((candidate) => candidate.userId === userId);
  if (data && !person) notFound();

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="pulse" />
      <Link href="/pulse" style={{ fontSize: 13 }}>← Pulse Check</Link>
      <h1 style={{ fontSize: 22, marginTop: 20 }}>{person?.displayName ?? 'Записи недоступны'}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Рабочий смысл показывается до подтверждения; после финализации остаётся обезличенный итог.</p>
      {person && <p style={{ padding: 12, background: 'var(--surface2)', borderRadius: 8, fontSize: 13 }}>
        <b>{personProgress(person).stage}</b> · {personProgress(person).nextStep}
      </p>}
      {person && GROUPS.map(([group, label]) => {
        const questions = person.questions.filter((q) => q.group === group);
        return <details key={group} open={group === 'autonomy'} style={{ marginTop: 24 }}>
          <summary style={{ cursor: 'pointer', fontSize: 16, fontWeight: 600 }}>
            {label} · {questions.filter((q) => q.outcome === 'scored').length}/{questions.length} итоговых · готово к подтверждению: {questions.filter((q) => q.ready).length}
          </summary>
          {questions.map((q) => (
            <div key={q.stableKey} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginTop: 10 }}>
              <b>{q.title}</b>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
                Состояние записи: {questionStatusLabel(q.status)}.
                {q.ready && ' Материала достаточно для подтверждения.'}
              </div>
              {q.workingSummary && <p style={{ fontSize: 13 }}>Рабочая запись, может измениться: {q.workingSummary}</p>}
              {q.finalSummary && <p style={{ fontSize: 13 }}>Итог после подтверждения: {q.finalSummary}</p>}
              {q.score !== null && <p style={{ fontSize: 13 }}>Оценка: {q.score}/100</p>}
              {!q.workingSummary && !q.finalSummary && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Текст записи недоступен на этом этапе.</p>}
            </div>
          ))}
        </details>;
      })}
    </main>
  );
}
