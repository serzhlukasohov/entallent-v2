import Link from 'next/link';
import type { AdminV2PilotPersonQuestion } from '@entalent/contracts';
import { Nav } from '../components/Nav';
import { fetchAdminV2PilotPeople } from '../lib';
import { personProgress, questionStatusLabel } from '../v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GROUPS = [
  ['growth', 'Развитие'], ['purpose', 'Смысл'], ['belonging', 'Принадлежность'],
] as const;

function GroupCard({ title, questions }: { title: string; questions: AdminV2PilotPersonQuestion[] }) {
  return <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12 }}>
    <b>{title}</b>
    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
      {questions.filter((q) => q.outcome === 'scored').length}/{questions.length} итоговых · готово к подтверждению: {questions.filter((q) => q.ready).length}
    </div>
    {questions.map((q) => <div key={q.stableKey} style={{ fontSize: 12, marginTop: 8 }}>
      <b>{q.title}</b>: {questionStatusLabel(q.status)}{q.ready ? ' · достаточно материала для подтверждения' : ''}
      {q.workingSummary && ['collecting', 'pending_confirmation', 'pending_clarification'].includes(q.status) && (
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.5, margin: '4px 0 0', whiteSpace: 'pre-line' }}>
          Предварительная формулировка: {q.workingSummary}
        </p>
      )}
    </div>)}
  </div>;
}

export default async function PulsePage() {
  const data = await fetchAdminV2PilotPeople();
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="pulse" />
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>Темы участников · V2</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Текущий цикл. Предварительные формулировки ещё не подтверждены участником и не являются итоговыми инсайтами. Сначала показана Автономия; остальные девять тем можно раскрыть.</p>
      {!data ? <p style={{ marginTop: 32 }}>Карточки участников сейчас недоступны.</p> : (
        <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
          {data.people.map((person) => (
            <section key={person.userId} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, margin: '0 0 12px' }}><Link href={`/pulse/${person.userId}`}>{person.displayName}</Link></h2>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{personProgress(person).stage}</span>
              </div>
              <GroupCard title="Автономия" questions={person.questions.filter((q) => q.group === 'autonomy')} />
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>Развитие, Смысл и Принадлежность · ещё 9 тем</summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 12 }}>
                  {GROUPS.map(([group, label]) => <GroupCard key={group} title={label} questions={person.questions.filter((q) => q.group === group)} />)}
                </div>
              </details>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
