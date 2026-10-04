import { describe, expect, it, vi } from 'vitest';
import { CompanySetupController } from './company-setup.controller';
import { HierarchyCsvValidationError } from './hierarchy-draft.service';

const COOKIE = '__Host-entalent-company-session=opaque-session-token';

function setup() {
  const sessions = {
    resolve: vi.fn().mockResolvedValue({ tenantId: 'tenant-from-session', personId: 'admin-person' }),
    verifyCsrf: vi.fn().mockReturnValue(true),
  };
  const reads = { snapshot: vi.fn().mockResolvedValue({ persons: [] }) };
  const drafts = {
    createPerson: vi.fn().mockResolvedValue({ id: 'new-person' }),
    createUnit: vi.fn().mockResolvedValue({ id: 'new-unit' }),
    createTeam: vi.fn().mockResolvedValue({ id: 'new-team' }),
    updatePerson: vi.fn().mockResolvedValue({ id: 'person-1' }),
    updateUnit: vi.fn().mockResolvedValue({ id: 'unit-1' }),
    updateTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
    replaceDraftPlacement: vi.fn().mockResolvedValue({ id: 'placement-1' }),
    previewCsv: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
    importCsv: vi.fn().mockResolvedValue({ personIds: [] }),
  };
  const slack = { linkByEmail: vi.fn(), unlinkDraft: vi.fn().mockResolvedValue(undefined) };
  const rollout = { activateUnit: vi.fn(), previewUnit: vi.fn().mockResolvedValue({ ready: true, issues: [] }),
    activateUnits: vi.fn().mockResolvedValue([]), previewUnits: vi.fn().mockResolvedValue({ ready: true, units: [] }) };
  const mutations = { moveEmployee: vi.fn().mockResolvedValue({ employeePersonId: 'employee-1', unitId: 'unit-2', teamId: null }),
    promoteTeamLead: vi.fn().mockResolvedValue({ teamId: 'team-1' }),
    promoteManager: vi.fn().mockResolvedValue({ unitId: 'unit-1' }) };
  const capabilities = { grantCompanyAdmin: vi.fn().mockResolvedValue({ changed: true }), revokeCompanyAdmin: vi.fn().mockResolvedValue({ changed: true }) };
  const advisorScopes = { replaceScope: vi.fn().mockResolvedValue({ personId: 'advisor-1' }) };
  const deactivations = { deactivatePerson: vi.fn().mockResolvedValue({ personId: 'employee-1' }),
    deactivateTeam: vi.fn().mockResolvedValue({ teamId: 'team-1' }),
    transferAndDeactivateUnit: vi.fn().mockResolvedValue({ sourceUnitId: 'unit-1' }) };
  const controller = new CompanySetupController(
    sessions as never, reads as never, drafts as never, slack as never, rollout as never, mutations as never,
    capabilities as never,
    advisorScopes as never,
    deactivations as never,
  );
  return { controller, sessions, reads, drafts, slack, rollout, mutations, capabilities, advisorScopes, deactivations };
}

describe('CompanySetupController customer boundary', () => {
  it('requires CSRF proof for agent default changes', async () => {
    const { controller, sessions } = setup();
    sessions.verifyCsrf.mockReturnValue(false);
    await expect(controller.saveOnboardingSettings({ headers: { cookie: COOKIE, 'x-csrf-token': 'wrong' } } as never, {}))
      .rejects.toThrow('CSRF proof required');
  });
  it('rejects invalid calendars before accessing settings persistence', async () => {
    const { controller } = setup();
    await expect(controller.saveOnboardingSettings({ headers: { cookie: COOKIE, 'x-csrf-token': 'proof' } } as never,
      { timezone: 'wrong', workingDays: [], workdayStart: '19:00', workdayEnd: '09:00' })).rejects.toThrow();
  });
  it('requires a live session even for the read snapshot', async () => {
    const { controller, reads } = setup();
    await expect(controller.snapshot({ headers: {} } as never)).rejects.toThrow('access denied');
    expect(reads.snapshot).not.toHaveBeenCalled();
    await controller.snapshot({ headers: { cookie: COOKIE } } as never);
    expect(reads.snapshot).toHaveBeenCalledWith('tenant-from-session');
  });

  it('requires CSRF proof for writes and never accepts a tenant or actor from the body', async () => {
    const { controller, sessions, drafts } = setup();
    const body = {
      tenantId: 'attacker-tenant', actorId: 'attacker',
      customerEmployeeId: 'E-1', workEmail: 'a@example.test',
      displayName: 'A', primaryRole: 'employee',
    };
    await expect(controller.createPerson({ headers: { cookie: COOKIE } } as never, body))
      .rejects.toThrow('CSRF proof required');
    expect(drafts.createPerson).not.toHaveBeenCalled();
    await controller.createPerson({ headers: {
      cookie: COOKIE, 'x-csrf-token': 'valid-csrf',
    } } as never, body);
    expect(sessions.verifyCsrf).toHaveBeenCalledWith('opaque-session-token', 'valid-csrf');
    expect(drafts.createPerson).toHaveBeenCalledWith('tenant-from-session', expect.objectContaining({
      customerEmployeeId: 'E-1',
    }), { type: 'company_admin', personId: 'admin-person' });
  });

  it('returns CSV errors from the authoritative import validation', async () => {
    const { controller, drafts } = setup();
    drafts.importCsv.mockRejectedValueOnce(new HierarchyCsvValidationError([
      { rowNumber: 2, field: 'workEmail', code: 'invalid', message: 'Invalid work email' },
    ]));
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await expect(controller.previewCsv(request as never, { csv: 'header\nrow' }))
      .resolves.toMatchObject({ ok: true });
    expect(drafts.previewCsv).toHaveBeenCalledWith('tenant-from-session', 'header\nrow',
      { type: 'company_admin', personId: 'admin-person' });
    await expect(controller.importCsv(request as never, { csv: 'header\nrow' }))
      .rejects.toMatchObject({ status: 422 });
  });

  it('edits draft records using only the session tenant and actor', async () => {
    const { controller, drafts } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.updateDraftPerson(request as never, 'person-1', {
      tenantId: 'attacker', customerEmployeeId: 'E-1', workEmail: 'e@example.test',
      displayName: 'Employee', primaryRole: 'employee',
    });
    await controller.updateDraftUnit(request as never, 'unit-1', {
      tenantId: 'attacker', customerUnitKey: 'U-1', name: 'Unit', managerPersonId: null,
    });
    await controller.updateDraftTeam(request as never, 'team-1', {
      tenantId: 'attacker', customerTeamKey: 'T-1', name: 'Team', unitId: 'unit-1', teamLeadPersonId: null,
    });
    const actor = { type: 'company_admin', personId: 'admin-person' };
    expect(drafts.updatePerson).toHaveBeenCalledWith('tenant-from-session', 'person-1',
      expect.objectContaining({ customerEmployeeId: 'E-1' }), actor);
    expect(drafts.updateUnit).toHaveBeenCalledWith('tenant-from-session', 'unit-1',
      expect.objectContaining({ customerUnitKey: 'U-1' }), actor);
    expect(drafts.updateTeam).toHaveBeenCalledWith('tenant-from-session', 'team-1',
      expect.objectContaining({ customerTeamKey: 'T-1' }), actor);
  });

  it('corrects a draft placement within the session tenant', async () => {
    const { controller, drafts } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.replaceDraftPlacement(request as never, 'person-1', {
      tenantId: 'attacker', targetUnitId: 'unit-1', targetTeamId: '',
    });
    expect(drafts.replaceDraftPlacement).toHaveBeenCalledWith('tenant-from-session', 'person-1',
      'unit-1', null, { type: 'company_admin', personId: 'admin-person' });
  });

  it('treats empty optional owner fields from setup forms as unassigned', async () => {
    const { controller, drafts } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.createUnit(request as never, { customerUnitKey: 'U-1', name: 'Unit', managerPersonId: '' });
    await controller.createTeam(request as never, { customerTeamKey: 'T-1', name: 'Team',
      unitId: 'unit-1', teamLeadPersonId: '' });
    expect(drafts.createUnit).toHaveBeenCalledWith('tenant-from-session',
      expect.objectContaining({ managerPersonId: null }),
      { type: 'company_admin', personId: 'admin-person' });
    expect(drafts.createTeam).toHaveBeenCalledWith('tenant-from-session',
      expect.objectContaining({ teamLeadPersonId: null }),
      { type: 'company_admin', personId: 'admin-person' });
  });

  it('previews Unit readiness with the tenant and actor from the session', async () => {
    const { controller, rollout } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await expect(controller.previewUnit(request as never, 'unit-1', { workspaceId: 'T-1', tenantId: 'other' }))
      .resolves.toMatchObject({ ready: true });
    expect(rollout.previewUnit).toHaveBeenCalledWith('tenant-from-session', 'unit-1', 'T-1',
      { type: 'company_admin', personId: 'admin-person' });
  });

  it('validates a multi-Unit selection before session-scoped preview and activation', async () => {
    const { controller, rollout } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    await expect(controller.activateUnits(request as never, { unitIds: [ids[0], ids[0]], workspaceId: 'T-1' }))
      .rejects.toMatchObject({ status: 400 });
    expect(rollout.activateUnits).not.toHaveBeenCalled();
    await controller.previewUnits(request as never, { unitIds: ids, workspaceId: 'T-1', tenantId: 'other' });
    await controller.activateUnits(request as never, { unitIds: ids, workspaceId: 'T-1', tenantId: 'other' });
    const expected = ['tenant-from-session', ids, 'T-1', { type: 'company_admin', personId: 'admin-person' }];
    expect(rollout.previewUnits).toHaveBeenCalledWith(...expected);
    expect(rollout.activateUnits).toHaveBeenCalledWith(...expected);
  });

  it('moves an Employee through the session-scoped typed operation', async () => {
    const { controller, mutations } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.moveEmployee(request as never, 'employee-1', {
      targetUnitId: 'unit-2', targetTeamId: null, tenantId: 'attacker-tenant',
    });
    expect(mutations.moveEmployee).toHaveBeenCalledWith('tenant-from-session', 'employee-1',
      'unit-2', null, { type: 'company_admin', personId: 'admin-person' });
  });

  it('requires an explicit previous Lead action and uses the session tenant', async () => {
    const { controller, mutations } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await expect(controller.promoteTeamLead(request as never, 'team-1', {
      employeePersonId: 'employee-1', previousLeadAction: 'automatic',
    })).rejects.toMatchObject({ status: 400 });
    expect(mutations.promoteTeamLead).not.toHaveBeenCalled();
    await controller.promoteTeamLead(request as never, 'team-1', {
      employeePersonId: 'employee-1', previousLeadAction: 'become_employee', tenantId: 'attacker',
    });
    expect(mutations.promoteTeamLead).toHaveBeenCalledWith(
      'tenant-from-session', 'team-1', 'employee-1', 'become_employee',
      { type: 'company_admin', personId: 'admin-person' },
    );
  });

  it('requires an explicit previous Manager action and uses the session tenant', async () => {
    const { controller, mutations } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await expect(controller.promoteManager(request as never, 'unit-1', {
      employeePersonId: 'employee-1', previousManagerAction: '',
    })).rejects.toMatchObject({ status: 400 });
    expect(mutations.promoteManager).not.toHaveBeenCalled();
    await controller.promoteManager(request as never, 'unit-1', {
      employeePersonId: 'employee-1', previousManagerAction: 'deactivate', tenantId: 'attacker',
    });
    expect(mutations.promoteManager).toHaveBeenCalledWith(
      'tenant-from-session', 'unit-1', 'employee-1', 'deactivate',
      { type: 'company_admin', personId: 'admin-person' },
    );
  });

  it('unlinks only a draft Person through the scoped Slack service', async () => {
    const { controller, slack } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.unlinkDraft(request as never, 'person-1', { workspaceId: 'T-1', tenantId: 'other' });
    expect(slack.unlinkDraft).toHaveBeenCalledWith('tenant-from-session', 'person-1', 'T-1',
      { type: 'company_admin', personId: 'admin-person' });
  });

  it('grants and revokes capability through the session actor', async () => {
    const { controller, capabilities } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.grantCompanyAdmin(request as never, 'person-2');
    await controller.revokeCompanyAdmin(request as never, 'person-2');
    const expected = ['tenant-from-session', 'person-2', { type: 'company_admin', personId: 'admin-person' }];
    expect(capabilities.grantCompanyAdmin).toHaveBeenCalledWith(...expected);
    expect(capabilities.revokeCompanyAdmin).toHaveBeenCalledWith(...expected);
  });

  it('replaces advisory scope using the session tenant and actor', async () => {
    const { controller, advisorScopes } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.replaceAdvisorScope(request as never, 'advisor-1', {
      scopeMode: 'selected_units', unitIds: ['unit-1'], tenantId: 'attacker',
    });
    expect(advisorScopes.replaceScope).toHaveBeenCalledWith(
      'tenant-from-session', 'advisor-1',
      { scopeMode: 'selected_units', unitIds: ['unit-1'] },
      { type: 'company_admin', personId: 'admin-person' },
    );
  });

  it('deactivates through a session-scoped typed operation', async () => {
    const { controller, deactivations } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await controller.deactivatePerson(request as never, 'employee-1');
    expect(deactivations.deactivatePerson).toHaveBeenCalledWith(
      'tenant-from-session', 'employee-1', { type: 'company_admin', personId: 'admin-person' },
    );
  });

  it('requires an explicit Lead action for Team deactivation', async () => {
    const { controller, deactivations } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await expect(controller.deactivateTeam(request as never, 'team-1', { leadAction: 'automatic' }))
      .rejects.toMatchObject({ status: 400 });
    expect(deactivations.deactivateTeam).not.toHaveBeenCalled();
    await controller.deactivateTeam(request as never, 'team-1', { leadAction: 'become_employee' });
    expect(deactivations.deactivateTeam).toHaveBeenCalledWith(
      'tenant-from-session', 'team-1', 'become_employee',
      { type: 'company_admin', personId: 'admin-person' },
    );
  });

  it('requires an explicit Manager action for Unit transfer and deactivation', async () => {
    const { controller, deactivations } = setup();
    const request = { headers: { cookie: COOKIE, 'x-csrf-token': 'valid-csrf' } };
    await expect(controller.transferAndDeactivateUnit(request as never, 'unit-1', {
      targetUnitId: 'unit-2', managerAction: 'automatic',
    })).rejects.toMatchObject({ status: 400 });
    expect(deactivations.transferAndDeactivateUnit).not.toHaveBeenCalled();
    await controller.transferAndDeactivateUnit(request as never, 'unit-1', {
      targetUnitId: 'unit-2', managerAction: 'become_employee', tenantId: 'attacker',
    });
    expect(deactivations.transferAndDeactivateUnit).toHaveBeenCalledWith(
      'tenant-from-session', 'unit-1', 'unit-2', 'become_employee',
      { type: 'company_admin', personId: 'admin-person' },
    );
  });
});
