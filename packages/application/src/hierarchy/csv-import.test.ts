import { describe, expect, it } from 'vitest';
import { validateHierarchyCsv, type ExistingHierarchyForImport } from './csv-import';

const tenantId = 'tenant-1';
const empty: ExistingHierarchyForImport = { people: [], units: [], teams: [] };
const headers = [
  'customerEmployeeId', 'workEmail', 'displayName', 'primaryRole', 'jobTitle',
  'customerUnitKey', 'unitName', 'customerTeamKey', 'teamName',
  'assignedUnitKeys', 'hrbpScopeMode', 'companyAdmin', 'pulseParticipant',
];

function csv(rows: Array<Record<string, string>>): string {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => {
    const value = row[header] ?? '';
    return value.includes(',') || value.includes('"') || value.includes('\n')
      ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(','))].join('\r\n');
}

describe('validateHierarchyCsv', () => {
  it('accepts a complete person-centric draft hierarchy with quoted values', () => {
    const result = validateHierarchyCsv(csv([
      { customerEmployeeId: 'M-1', workEmail: 'M@EXAMPLE.COM', displayName: 'Manager', primaryRole: 'manager', customerUnitKey: 'U-1', unitName: 'Unit One', companyAdmin: 'true' },
      { customerEmployeeId: 'L-1', workEmail: 'l@example.com', displayName: 'Lead', primaryRole: 'team_lead', customerUnitKey: 'U-1', customerTeamKey: 'T-1', teamName: 'Team One' },
      { customerEmployeeId: 'E-1', workEmail: 'e@example.com', displayName: 'Employee, One', primaryRole: 'employee', customerUnitKey: 'U-1', customerTeamKey: 'T-1' },
      { customerEmployeeId: 'H-1', workEmail: 'h@example.com', displayName: 'HR', primaryRole: 'hr', assignedUnitKeys: 'U-1' },
      { customerEmployeeId: 'B-1', workEmail: 'b@example.com', displayName: 'HRBP', primaryRole: 'hrbp', assignedUnitKeys: 'U-1', hrbpScopeMode: 'selected_units' },
    ]), tenantId, empty);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({ workEmail: 'm@example.com', pulseParticipant: false, companyAdmin: true });
    expect(result.rows[2]).toMatchObject({ displayName: 'Employee, One', customerTeamKey: 'T-1' });
  });

  it('allows a later file to reference existing Unit and Team keys without redefining them', () => {
    const existing: ExistingHierarchyForImport = {
      people: [],
      units: [{ tenantId, customerUnitKey: 'U-1', name: 'Unit One' }],
      teams: [{ tenantId, customerTeamKey: 'T-1', customerUnitKey: 'U-1', name: 'Team One' }],
    };
    expect(validateHierarchyCsv(csv([{
      customerEmployeeId: 'E-2', workEmail: 'new@example.com', displayName: 'New',
      primaryRole: 'employee', customerUnitKey: 'U-1', customerTeamKey: 'T-1',
    }]), tenantId, existing).ok).toBe(true);
  });

  it('returns all detectable field and cross-row errors for a rejected file', () => {
    const result = validateHierarchyCsv(csv([
      { customerEmployeeId: '', workEmail: 'bad', displayName: '', primaryRole: 'owner', companyAdmin: 'maybe', pulseParticipant: 'true' },
      { customerEmployeeId: 'E-1', workEmail: 'same@example.com', displayName: 'First', primaryRole: 'employee', customerUnitKey: 'U-1', unitName: 'First Unit' },
      { customerEmployeeId: 'E-1', workEmail: 'same@example.com', displayName: 'Second', primaryRole: 'employee', customerUnitKey: 'U-1', unitName: 'Different Unit' },
    ]), tenantId, empty);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toEqual(expect.arrayContaining([
      'required', 'invalid', 'invalid_boolean', 'not_editable', 'duplicate_in_file', 'conflicting_unit_name',
    ]));
    expect(result.errors.every((item) => item.rowNumber >= 2 && item.field && item.message)).toBe(true);
  });

  it('still reports duplicate identities when another field in the row is invalid', () => {
    const result = validateHierarchyCsv(csv([
      { customerEmployeeId: 'E-1', workEmail: 'same@example.com', displayName: 'First', primaryRole: 'employee', customerUnitKey: 'U-1', unitName: 'Unit One' },
      { customerEmployeeId: 'E-1', workEmail: 'SAME@example.com', displayName: '', primaryRole: 'employee', customerUnitKey: 'U-1' },
    ]), tenantId, empty);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 3, field: 'displayName', code: 'required' }),
      expect.objectContaining({ rowNumber: 3, field: 'customerEmployeeId', code: 'duplicate_in_file' }),
      expect.objectContaining({ rowNumber: 3, field: 'workEmail', code: 'duplicate_in_file' }),
    ]));
  });

  it('rejects cross-tenant structure references and malformed CSV', () => {
    const existing: ExistingHierarchyForImport = {
      people: [], units: [{ tenantId: 'tenant-2', customerUnitKey: 'U-2', name: 'Other' }], teams: [],
    };
    const result = validateHierarchyCsv(csv([{
      customerEmployeeId: 'E-1', workEmail: 'e@example.com', displayName: 'Employee',
      primaryRole: 'employee', customerUnitKey: 'U-2',
    }]), tenantId, existing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ code: 'cross_tenant_reference' }));

    const malformed = validateHierarchyCsv('customerEmployeeId,workEmail,displayName,primaryRole\n"unterminated', tenantId, empty);
    expect(malformed).toMatchObject({ ok: false, errors: [{ code: 'unclosed_quote' }] });
  });
});
