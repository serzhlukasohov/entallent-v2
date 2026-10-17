import { describe, expect, it, vi } from 'vitest';
import {
  buildLegacyHierarchy, buildOrgHierarchy, buildUnplaced, TeamHierarchyReadModel, type UnplacedCandidateRow,
} from './team-hierarchy.read-model';

const TENANT = '7d1e0163-6d53-4713-bd24-254690cc5090';

function readModelWith(...results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  return { execute, readModel: new TeamHierarchyReadModel({ client: { execute } } as never) };
}

const COHORT = { cohortId: '0b9c2a51-7c1e-4f53-9d38-5f0f3f6f1a01', periodStart: '2026-01-01T00:00:00Z', periodEnd: '2100-01-01T00:00:00Z' };

function candidate(userId: string, overrides: Partial<UnplacedCandidateRow> = {}): UnplacedCandidateRow {
  return {
    userId, displayName: null, inCurrentCohort: false, legacyTeamName: null,
    managerSlackUserId: null, managerUserId: null, managerName: null, ...overrides,
  };
}

const ORG_UNITS = [
  { id: 'u-sales', name: 'Продажи', managerId: null, managerName: null, managerRole: null },
  { id: 'u-eng', name: 'Инженерия', managerId: 'p-mgr', managerName: 'Мария', managerRole: 'manager' },
];
const ORG_TEAMS = [
  { id: 't-web', unitId: 'u-eng', name: 'Веб', leadId: 'p-lead', leadName: 'Лев', leadRole: 'team_lead' },
  { id: 't-api', unitId: 'u-eng', name: 'API', leadId: null, leadName: null, leadRole: null },
];
const ORG_PLACEMENTS = [
  { personId: 'p-lead', unitId: 'u-eng', teamId: 't-web', displayName: 'Лев', role: 'team_lead' },
  { personId: 'p-vera', unitId: 'u-eng', teamId: 't-web', displayName: 'Вера', role: 'employee' },
  { personId: 'p-anna', unitId: 'u-eng', teamId: 't-web', displayName: 'Анна', role: 'employee' },
  { personId: 'p-ivan', unitId: 'u-eng', teamId: 't-api', displayName: 'Иван', role: 'employee' },
  { personId: 'p-dina', unitId: 'u-eng', teamId: null, displayName: 'Дина', role: 'employee' },
  { personId: 'p-mgr', unitId: 'u-eng', teamId: null, displayName: 'Мария', role: 'manager' },
  { personId: 'p-ghost', unitId: 'u-eng', teamId: 't-inactive', displayName: 'Призрак', role: 'employee' },
];

it('never lists a manager or lead a second time as a member', () => {
  const units = buildOrgHierarchy(ORG_UNITS, ORG_TEAMS, [
    { personId: 'p-mgr', unitId: 'u-eng', teamId: 't-web', displayName: 'Мария', role: 'manager' },
    { personId: 'p-lead', unitId: 'u-eng', teamId: null, displayName: 'Лев', role: 'team_lead' },
  ]);
  const eng = units.find((unit) => unit.id === 'u-eng');
  expect(eng?.teams.flatMap((team) => team.members)).toEqual([]);
  expect(eng?.directMembers).toEqual([]);
});

it('drops blank legacy names and duplicate memberships', () => {
  const [unit] = buildLegacyHierarchy(
    [{ id: 'lt', name: 'Команда', managerSlackUserId: 'U1', managerUserId: 'mgr', managerName: '  ' }],
    [
      { teamId: 'lt', userId: 'a', displayName: ' ' },
      { teamId: 'lt', userId: 'a', displayName: ' ' },
      { teamId: 'lt', userId: 'mgr', displayName: 'Олег' },
    ],
  );
  expect(unit?.manager).toEqual({ id: 'mgr', displayName: 'U1', role: 'manager' });
  expect(unit?.directMembers).toEqual([{ id: 'a', displayName: 'Участник 1', role: 'employee' }]);
});

describe('team hierarchy read model', () => {
  it('rejects a non-UUID tenant before querying', async () => {
    const { execute, readModel } = readModelWith();
    await expect(readModel.getHierarchy('bad-tenant')).rejects.toThrow('tenantId');
    await expect(readModel.getHierarchy(undefined)).rejects.toThrow('tenantId');
    expect(execute).not.toHaveBeenCalled();
  });

  it('assembles the org tree with team and direct members, showing each person once and sorted', () => {
    const units = buildOrgHierarchy(ORG_UNITS, ORG_TEAMS, ORG_PLACEMENTS);
    expect(units.map((unit) => unit.name)).toEqual(['Инженерия', 'Продажи']);
    const [eng, sales] = units;
    expect(eng?.manager).toEqual({ id: 'p-mgr', displayName: 'Мария', role: 'manager' });
    expect(eng?.teams.map((team) => team.name)).toEqual(['Веб', 'API']);
    const web = eng?.teams.find((team) => team.id === 't-web');
    expect(web?.lead).toEqual({ id: 'p-lead', displayName: 'Лев', role: 'team_lead' });
    expect(web?.members.map((m) => m.displayName)).toEqual(['Анна', 'Вера']);
    expect(eng?.teams.find((team) => team.id === 't-api')?.lead).toBeNull();
    // A person placed in an inactive team still belongs to the unit.
    expect(eng?.directMembers.map((m) => m.displayName)).toEqual(['Дина', 'Призрак']);
    expect(sales).toEqual({ id: 'u-sales', name: 'Продажи', manager: null, teams: [], directMembers: [] });
  });

  it('reads the org model, tenant-scoped, and exposes no email or employee id', async () => {
    const { execute, readModel } = readModelWith(
      ORG_UNITS,
      ORG_TEAMS,
      ORG_PLACEMENTS.map((row) => ({ ...row, workEmail: 'secret@example.com', customerEmployeeId: 'EMP-42' })),
      [COHORT],
      [{ ...candidate('user-out', { displayName: 'Ольга' }), workEmail: 'secret@example.com', externalUserId: 'U0EMP' }],
    );
    const result = await readModel.getHierarchy(TENANT);
    expect(result.source).toBe('org');
    expect(result.tenantId).toBe(TENANT);
    expect(execute).toHaveBeenCalledTimes(5);
    execute.mock.calls.forEach((call, index) => {
      const query = JSON.stringify(call[0]);
      expect(query).toContain(TENANT);
      if (index < 3) expect(query).toContain("lifecycle_status = 'active'");
      expect(query).not.toContain('work_email');
      expect(query).not.toContain('customer_employee_id');
      expect(query).not.toMatch(/external_user_id AS|ca\.external_user_id,/);
    });
    expect(JSON.stringify(execute.mock.calls[4]?.[0])).toContain(COHORT.cohortId);
    expect(result.unplaced).toEqual([{ id: 'user-out', displayName: 'Ольга', legacyTeam: null, inCurrentCohort: false }]);
    const json = JSON.stringify(result);
    expect(json).not.toContain('secret@example.com');
    expect(json).not.toContain('EMP-42');
    expect(json).not.toMatch(/workEmail|customerEmployeeId|externalUserId/);
  });

  it('falls back to legacy teams with resolved and unresolved managers', async () => {
    const { execute, readModel } = readModelWith(
      [],
      [
        { id: 'lt-b', name: 'Бэкенд', managerSlackUserId: 'U0RAW', managerUserId: null, managerName: null },
        { id: 'lt-a', name: 'Аналитика', managerSlackUserId: 'U0MGR', managerUserId: 'user-mgr', managerName: 'Олег' },
      ],
      [
        { teamId: 'lt-a', userId: 'user-mgr', displayName: 'Олег' },
        { teamId: 'lt-a', userId: 'user-2', displayName: null },
        { teamId: 'lt-a', userId: 'user-1', displayName: 'Яна' },
        { teamId: 'lt-b', userId: 'user-3', displayName: null },
      ],
      [],
      [],
    );
    const result = await readModel.getHierarchy(TENANT);
    expect(result.source).toBe('legacy');
    expect(result.unplaced).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(5);
    for (const call of execute.mock.calls) expect(JSON.stringify(call[0])).toContain(TENANT);
    const [analytics, backend] = result.units;
    expect(analytics?.manager).toEqual({ id: 'user-mgr', displayName: 'Олег', role: 'manager' });
    expect(analytics?.directMembers).toEqual([
      { id: 'user-2', displayName: 'Участник 1', role: 'employee' },
      { id: 'user-1', displayName: 'Яна', role: 'employee' },
    ]);
    expect(analytics?.teams).toEqual([]);
    expect(backend?.manager).toEqual({ id: null, displayName: 'U0RAW', role: 'manager' });
    expect(backend?.directMembers).toEqual([{ id: 'user-3', displayName: 'Участник 1', role: 'employee' }]);
  });

  it('reports none when there are no org units and no legacy teams', async () => {
    const { readModel } = readModelWith([], [], [], []);
    const result = await readModel.getHierarchy(TENANT);
    expect(result).toMatchObject({ tenantId: TENANT, source: 'none', units: [], unplaced: [] });
  });

  it('labels legacy members without a Slack name deterministically by user id', () => {
    const units = buildLegacyHierarchy(
      [{ id: 'lt', name: 'Команда', managerSlackUserId: null, managerUserId: null, managerName: null }],
      [{ teamId: 'lt', userId: 'b', displayName: null }, { teamId: 'lt', userId: 'a', displayName: null }],
    );
    expect(units[0]?.manager).toBeNull();
    expect(units[0]?.directMembers.map((m) => [m.id, m.displayName])).toEqual([['a', 'Участник 1'], ['b', 'Участник 2']]);
  });

  it('lists the current cohort when no hierarchy exists at all', async () => {
    const { execute, readModel } = readModelWith([], [], [COHORT], [candidate('user-a', { displayName: 'Аня', inCurrentCohort: true })]);
    const result = await readModel.getHierarchy(TENANT);
    expect(result.source).toBe('none');
    expect(result.unplaced).toEqual([{ id: 'user-a', displayName: 'Аня', legacyTeam: null, inCurrentCohort: true }]);
    expect(JSON.stringify(execute.mock.calls[3]?.[0])).toContain(COHORT.cohortId);
  });

  it('reads no roster when the tenant has no started V2 cohort', async () => {
    const upcoming = { ...COHORT, periodStart: '2099-01-01T00:00:00Z' };
    const { execute, readModel } = readModelWith([], [], [upcoming], []);
    await readModel.getHierarchy(TENANT);
    const query = JSON.stringify(execute.mock.calls[3]?.[0]);
    expect(query).not.toContain(COHORT.cohortId);
    expect(query).toContain('null');
  });
});

describe('people outside the hierarchy', () => {
  const tree = buildOrgHierarchy(ORG_UNITS, ORG_TEAMS, ORG_PLACEMENTS);

  it('lists unplaced cohort and legacy members with their legacy team and manager, once, sorted', () => {
    const unplaced = buildUnplaced(tree, [
      candidate('u-zoya', { displayName: 'Зоя', inCurrentCohort: true, legacyTeamName: 'Пилот', managerUserId: 'u-oleg', managerName: 'Олег', managerSlackUserId: 'U0MGR' }),
      candidate('u-boris', { displayName: 'Борис', inCurrentCohort: true }),
      candidate('u-zoya', { displayName: 'Зоя', inCurrentCohort: true }),
      candidate('u-raw', { displayName: '  ', legacyTeamName: 'Старая', managerSlackUserId: 'U0RAW' }),
    ]);
    expect(unplaced).toEqual([
      { id: 'u-boris', displayName: 'Борис', legacyTeam: null, inCurrentCohort: true },
      { id: 'u-zoya', displayName: 'Зоя', inCurrentCohort: true,
        legacyTeam: { name: 'Пилот', manager: { id: 'u-oleg', displayName: 'Олег', role: 'manager' } } },
      { id: 'u-raw', displayName: 'Участник 1', inCurrentCohort: false,
        legacyTeam: { name: 'Старая', manager: { id: null, displayName: 'U0RAW', role: 'manager' } } },
    ]);
  });

  it('never repeats someone already in the tree, including managers and leads without a placement', () => {
    const headersOnly = buildOrgHierarchy(ORG_UNITS, ORG_TEAMS, []);
    const unplaced = buildUnplaced(headersOnly, [
      candidate('p-mgr', { inCurrentCohort: true }), candidate('p-lead', { inCurrentCohort: true }),
      candidate('p-vera', { displayName: 'Вера', inCurrentCohort: true }),
    ]);
    expect(unplaced.map((person) => person.id)).toEqual(['p-vera']);
    expect(buildUnplaced(tree, [candidate('p-vera'), candidate('p-ghost'), candidate('p-dina')])).toEqual([]);
  });

  it('matches the partial production rollout: everyone in the cohort is visible exactly once', () => {
    const units = buildOrgHierarchy(
      [{ id: 'u-qa', name: 'QA Pilot', managerId: 'p-1', managerName: 'Первый', managerRole: 'manager' }],
      [],
      [{ personId: 'p-2', unitId: 'u-qa', teamId: null, displayName: 'Второй', role: 'employee' }],
    );
    const roster = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6'];
    const unplaced = buildUnplaced(units, roster.map((id) => candidate(id, { displayName: id, inCurrentCohort: true })));
    const visible = [...shownInTree(units), ...unplaced.map((person) => person.id)];
    expect(visible.sort()).toEqual(roster);
  });
});

function shownInTree(units: ReturnType<typeof buildOrgHierarchy>): string[] {
  return units.flatMap((unit) => [
    ...(unit.manager?.id ? [unit.manager.id] : []),
    ...unit.teams.flatMap((team) => [...(team.lead ? [team.lead.id] : []), ...team.members.map((m) => m.id)]),
    ...unit.directMembers.map((m) => m.id),
  ]);
}
