import { companyLabelKey } from './company-label';
import type { ReactNode } from 'react';
import { CompanyText, CompanyLabel } from './company-language';
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
  org: "ui.001", legacy: "ui.002", none: "ui.003",
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
    {showRole && <Badge tone={roleTone(person.role)}><CompanyLabel label={roleLabel(person.role)} /></Badge>}
  </div>;
}

function People({ people }: { people: AdminTeamHierarchyPerson[] }) {
  if (people.length === 0) return <div className="muted small"><CompanyText k="ui.004" /></div>;
  return <ul className="people">
    {people.map((person) => <li key={person.id}><PersonLine person={person} /></li>)}
  </ul>;
}

function Lead({ title, person }: { title: ReactNode; person: AdminTeamHierarchyManager | null }) {
  return <div style={{ marginTop: 8 }}>
    <div className="muted small">{title}</div>
    {/* The title already names the role. */}
    {person ? <PersonLine person={person} showRole={false} /> : <Badge tone="warning"><CompanyText k="ui.005" /></Badge>}
  </div>;
}

function UnitCard({ unit }: { unit: AdminTeamHierarchyUnit }) {
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <h2>{unit.name}</h2>
      <Badge><CompanyText k="ui.006" />{headcount(unit)}</Badge>
    </div>
    <Lead title={<CompanyText k="ui.007" />} person={unit.manager} />
    {unit.teams.map((team) => <div key={team.id} className="card-inset" style={{ marginTop: 12 }}>
      <h3>{team.name}</h3>
      <Lead title={<CompanyText k="ui.008" />} person={team.lead} />
      <div className="muted small" style={{ marginTop: 8 }}><CompanyText k="ui.009" /></div>
      <People people={team.members} />
    </div>)}
    {(unit.directMembers.length > 0 || unit.teams.length === 0) && <div style={{ marginTop: 12 }}>
      <div className="muted small"><CompanyText k="ui.010" /></div>
      <People people={unit.directMembers} />
    </div>}
  </Card>;
}

function legacyHome(person: AdminTeamHierarchyUnplacedPerson): string {
  if (!person.legacyTeam) return "ui.011";
  const manager = person.legacyTeam.manager?.displayName ?? "ui.012";
  return companyLabelKey('ui.legacy_home',{team:person.legacyTeam.name,manager});
}

function UnplacedCard({ people }: { people: AdminTeamHierarchyUnplacedPerson[] }) {
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <h2><CompanyText k="ui.013" /></h2>
      <Badge tone="warning"><CompanyText k="ui.006" />{people.length}</Badge>
    </div>
    <div className="muted small" style={{ marginTop: 4 }}>
      <CompanyText k="ui.014" /></div>
    <ul className="people" style={{ marginTop: 8 }}>
      {people.map((person) => <li key={person.id}>
        <div className="person">
          <Initials name={person.displayName} />
          <span className="person-name">{person.displayName}</span>
          {person.inCurrentCohort && <Badge tone="accent"><CompanyText k="ui.015" /></Badge>}
        </div>
        <div className="muted small"><CompanyLabel label={legacyHome(person)} /></div>
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
        title={<CompanyText k="ui.016" />}
        subtitle={qaEnabled && data && hasPeople
          ? <><CompanyLabel label={companyLabelKey('ui.hierarchy_source',{source:SOURCE_LABELS[data.source]},['source'])} /> {unplaced.length > 0 && <CompanyText k="ui.unplaced_count" values={{count:unplaced.length}} />}</>
          : undefined}
      />
      {!qaEnabled ? (
        <Notice><CompanyText k="ui.017" /></Notice>
      ) : !data ? (
        <Notice><CompanyText k="ui.018" /></Notice>
      ) : !hasPeople ? (
        <Notice><CompanyText k="ui.019" /></Notice>
      ) : (
        <div className="unit-grid">
          {data.units.map((unit) => <UnitCard key={unit.id} unit={unit} />)}
          {unplaced.length > 0 && <UnplacedCard people={unplaced} />}
        </div>
      )}
    </main>
  );
}
