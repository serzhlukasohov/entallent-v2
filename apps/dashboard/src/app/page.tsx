import type {
  AdminTeamHierarchyManager, AdminTeamHierarchyPerson, AdminTeamHierarchyRole, AdminTeamHierarchySource,
  AdminTeamHierarchyUnit, AdminTeamHierarchyUnplacedPerson,
} from '@entalent/contracts';
import { Nav } from './components/Nav';
import { Badge, Card, Initials, Notice, PageHeader } from './components/ui';
import { fetchAdminTeamHierarchy, qaPrivateViewEnabled } from './lib';
import { roleLabel, type BadgeTone } from './v2-pilot-progress';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SOURCE_LABELS: Record<AdminTeamHierarchySource, string> = {
  org: 'Оргструктура', legacy: 'Старые команды Slack', none: 'Не настроена',
};

function headcount(unit: AdminTeamHierarchyUnit): number {
  const ids = new Set<string>();
  if (unit.manager) ids.add(unit.manager.id ?? `manager:${unit.id}`);
  for (const team of unit.teams) {
    if (team.lead) ids.add(team.lead.id);
    for (const member of team.members) ids.add(member.id);
  }
  for (const member of unit.directMembers) ids.add(member.id);
  return ids.size;
}

function roleTone(role: AdminTeamHierarchyRole): BadgeTone {
  return role === 'employee' ? 'neutral' : 'accent';
}

function PersonLine({ person, showRole = true }: {
  person: AdminTeamHierarchyPerson | AdminTeamHierarchyManager; showRole?: boolean;
}) {
  return <div className="person">
    <Initials name={person.displayName} />
    <span className="person-name">{person.displayName}</span>
    {showRole && <Badge tone={roleTone(person.role)}>{roleLabel(person.role)}</Badge>}
  </div>;
}

function People({ people }: { people: AdminTeamHierarchyPerson[] }) {
  if (people.length === 0) return <div className="muted small">Нет сотрудников</div>;
  return <ul className="people">
    {people.map((person) => <li key={person.id}><PersonLine person={person} /></li>)}
  </ul>;
}

function Lead({ title, person }: { title: string; person: AdminTeamHierarchyManager | null }) {
  return <div style={{ marginTop: 8 }}>
    <div className="muted small">{title}</div>
    {/* The title already names the role. */}
    {person ? <PersonLine person={person} showRole={false} /> : <Badge tone="warning">Не назначен</Badge>}
  </div>;
}

function UnitCard({ unit }: { unit: AdminTeamHierarchyUnit }) {
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <h2>{unit.name}</h2>
      <Badge>Человек: {headcount(unit)}</Badge>
    </div>
    <Lead title="Руководитель" person={unit.manager} />
    {unit.teams.map((team) => <div key={team.id} className="card-inset" style={{ marginTop: 12 }}>
      <h3>{team.name}</h3>
      <Lead title="Тимлид" person={team.lead} />
      <div className="muted small" style={{ marginTop: 8 }}>Участники</div>
      <People people={team.members} />
    </div>)}
    {(unit.directMembers.length > 0 || unit.teams.length === 0) && <div style={{ marginTop: 12 }}>
      <div className="muted small">Напрямую у руководителя</div>
      <People people={unit.directMembers} />
    </div>}
  </Card>;
}

function legacyHome(person: AdminTeamHierarchyUnplacedPerson): string {
  if (!person.legacyTeam) return 'Нет старой команды';
  const manager = person.legacyTeam.manager?.displayName ?? 'не назначен';
  return `Старая команда: ${person.legacyTeam.name} · Руководитель: ${manager}`;
}

function UnplacedCard({ people }: { people: AdminTeamHierarchyUnplacedPerson[] }) {
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <h2>Не в оргструктуре</h2>
      <Badge tone="warning">Человек: {people.length}</Badge>
    </div>
    <div className="muted small" style={{ marginTop: 4 }}>
      Участники старых команд Slack и текущей V2-когорты без места в оргструктуре.
    </div>
    <ul className="people" style={{ marginTop: 8 }}>
      {people.map((person) => <li key={person.id}>
        <div className="person">
          <Initials name={person.displayName} />
          <span className="person-name">{person.displayName}</span>
          {person.inCurrentCohort && <Badge tone="accent">V2-когорта</Badge>}
        </div>
        <div className="muted small">{legacyHome(person)}</div>
      </li>)}
    </ul>
  </Card>;
}

export default async function DashboardPage() {
  const qaEnabled = qaPrivateViewEnabled();
  const data = await fetchAdminTeamHierarchy();
  // Tolerates an API deployed before `unplaced` existed.
  const unplaced = data?.unplaced ?? [];
  const hasPeople = Boolean(data && (data.units.length > 0 || unplaced.length > 0));

  return (
    <main className="page">
      <Nav active="team" />
      <PageHeader
        title="Команда"
        subtitle={qaEnabled && data && hasPeople
          ? `Кто кому подчиняется. Источник: ${SOURCE_LABELS[data.source]}.`
            + (unplaced.length > 0 ? ` Вне оргструктуры: ${unplaced.length}.` : '')
          : undefined}
      />
      {!qaEnabled ? (
        <Notice>Состав команды с именами доступен только в закрытом QA-режиме.</Notice>
      ) : !data ? (
        <Notice>Иерархия команды сейчас недоступна.</Notice>
      ) : !hasPeople ? (
        <Notice>Иерархия ещё не настроена.</Notice>
      ) : (
        <div className="unit-grid">
          {data.units.map((unit) => <UnitCard key={unit.id} unit={unit} />)}
          {unplaced.length > 0 && <UnplacedCard people={unplaced} />}
        </div>
      )}
    </main>
  );
}
