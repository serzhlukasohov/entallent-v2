import Link from 'next/link';
import { Nav } from './components/Nav';
import { fetchAdminV2PilotPeople } from './lib';
import { personProgress } from './v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const data = await fetchAdminV2PilotPeople();
  const people = data?.people ?? [];

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <Nav active="team" />
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>Команда · пилот V2</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Текущий замороженный цикл. Рабочие записи меняются до подтверждения и удаляются после финализации.
      </p>
      {!data ? <p style={{ marginTop: 32 }}>Карточки участников сейчас недоступны.</p> : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '24px 0' }}>
            <div>Участников: <b>{people.length}</b></div>
            <div>Начали беседу: <b>{people.filter((person) => person.inbound > 0).length}</b></div>
            <div>Автономия 3/3: <b>{people.filter((person) => person.questions.filter((q) => q.group === 'autonomy' && q.outcome === 'scored').length === 3).length} / 5</b> для порога отчёта</div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            «Что проверить» — подсказка по сохранённым записям. Доставку сообщений конкретному участнику эта таблица не подтверждает.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 10 }}>Участник</th><th style={{ padding: 10 }}>Сообщения</th>
                <th style={{ padding: 10 }}>Этап Автономии</th><th style={{ padding: 10 }}>Что проверить</th>
                <th style={{ padding: 10 }}>Записи / итоги</th>
              </tr></thead>
              <tbody>{people.map((person) => {
                const progress = personProgress(person);
                return <tr key={person.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}><Link href={`/pulse/${person.userId}`}>{person.displayName}</Link></td>
                  <td style={{ padding: 10 }}>{person.inbound}</td>
                  <td style={{ padding: 10 }}>{progress.stage}</td>
                  <td style={{ padding: 10, color: 'var(--text-muted)' }}>{progress.nextStep}</td>
                  <td style={{ padding: 10 }}>{person.questions.filter((q) => q.workingSummary).length} / {person.questions.filter((q) => q.outcome).length}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>«Записи / итоги» считаются по всем 12 темам текущего цикла.</p>
        </>
      )}
    </main>
  );
}
