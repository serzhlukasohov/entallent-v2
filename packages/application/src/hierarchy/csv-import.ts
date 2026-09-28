import { inspectDraftPerson, prepareDraftPerson, type PreparedDraftPerson } from './draft-person';

const REQUIRED_HEADERS = ['customerEmployeeId', 'workEmail', 'displayName', 'primaryRole'] as const;
const HEADERS = new Set([
  ...REQUIRED_HEADERS, 'jobTitle', 'customerUnitKey', 'unitName', 'customerTeamKey', 'teamName',
  'assignedUnitKeys', 'hrbpScopeMode', 'companyAdmin', 'pulseParticipant',
]);

export interface ExistingHierarchyForImport {
  people: Array<{ tenantId: string; customerEmployeeId: string; workEmail: string }>;
  units: Array<{ tenantId: string; customerUnitKey: string; name: string }>;
  teams: Array<{ tenantId: string; customerTeamKey: string; customerUnitKey: string; name: string }>;
}

export interface HierarchyImportRow extends PreparedDraftPerson {
  rowNumber: number;
  customerUnitKey: string | null;
  unitName: string | null;
  customerTeamKey: string | null;
  teamName: string | null;
  assignedUnitKeys: string[];
  hrbpScopeMode: 'all_units' | 'selected_units' | null;
  companyAdmin: boolean;
}

export interface HierarchyCsvError {
  rowNumber: number;
  field: string;
  code: string;
  message: string;
}

export type HierarchyCsvValidation =
  | { ok: true; rows: HierarchyImportRow[] }
  | { ok: false; errors: HierarchyCsvError[] };

interface CsvRecord { rowNumber: number; cells: string[] }

export function validateHierarchyCsv(
  csv: string, tenantId: string, existing: ExistingHierarchyForImport,
): HierarchyCsvValidation {
  const errors: HierarchyCsvError[] = [];
  const parsed = parseCsv(csv);
  if ('error' in parsed) return { ok: false, errors: [parsed.error] };
  const [headerRecord, ...dataRecords] = parsed.records;
  if (!headerRecord) return { ok: false, errors: [error(1, 'file', 'empty_file', 'CSV is empty')] };
  const headers = headerRecord.cells.map((cell) => cell.trim());
  const seenHeaders = new Set<string>();
  for (const header of headers) {
    if (seenHeaders.has(header)) errors.push(error(1, header, 'duplicate_header', `Duplicate column ${header}`));
    if (!HEADERS.has(header)) errors.push(error(1, header || 'header', 'unknown_header', `Unknown column ${header}`));
    seenHeaders.add(header);
  }
  for (const header of REQUIRED_HEADERS) {
    if (!seenHeaders.has(header)) errors.push(error(1, header, 'missing_header', `Missing required column ${header}`));
  }
  if (errors.length > 0) return { ok: false, errors };
  if (dataRecords.length === 0) return { ok: false, errors: [error(2, 'file', 'empty_file', 'CSV has no Person rows')] };

  const ownPeople = existing.people.filter((person) => person.tenantId === tenantId);
  const ownUnits = new Map(existing.units.filter((unit) => unit.tenantId === tenantId).map((unit) => [unit.customerUnitKey, unit]));
  const ownTeams = new Map(existing.teams.filter((team) => team.tenantId === tenantId).map((team) => [team.customerTeamKey, team]));
  const otherUnitKeys = new Set(existing.units.filter((unit) => unit.tenantId !== tenantId).map((unit) => unit.customerUnitKey));
  const otherTeamKeys = new Set(existing.teams.filter((team) => team.tenantId !== tenantId).map((team) => team.customerTeamKey));
  const personIds = new Map<string, number>();
  const emails = new Map<string, number>();
  const unitNames = new Map<string, string>();
  const teamDefinitions = new Map<string, { name: string | null; unitKey: string; rowNumber: number }>();
  const unitOwners = new Map<string, number>();
  const teamOwners = new Map<string, number>();
  const rows: HierarchyImportRow[] = [];

  for (const record of dataRecords) {
    if (record.cells.length !== headers.length) {
      errors.push(error(record.rowNumber, 'row', 'column_count', `Expected ${headers.length} columns, found ${record.cells.length}`));
      continue;
    }
    const values = Object.fromEntries(headers.map((header, index) => [header, record.cells[index]?.trim() ?? '']));
    const get = (field: string) => values[field] ?? '';
    const unitKey = get('customerUnitKey') || null;
    const unitName = get('unitName') || null;
    const teamKey = get('customerTeamKey') || null;
    const teamName = get('teamName') || null;
    const scopeMode = get('hrbpScopeMode');
    const assignedUnitKeys = get('assignedUnitKeys') ? get('assignedUnitKeys').split(';').map((key) => key.trim()) : [];
    const adminValue = get('companyAdmin').toLowerCase();
    if (adminValue && adminValue !== 'true' && adminValue !== 'false') {
      errors.push(error(record.rowNumber, 'companyAdmin', 'invalid_boolean', 'Use true or false'));
    }
    if (get('pulseParticipant')) {
      errors.push(error(record.rowNumber, 'pulseParticipant', 'not_editable', 'Pulse participation is derived from primary role'));
    }
    if (assignedUnitKeys.some((key) => !key) || new Set(assignedUnitKeys).size !== assignedUnitKeys.length) {
      errors.push(error(record.rowNumber, 'assignedUnitKeys', 'invalid_unit_keys', 'Use distinct nonempty Unit keys separated by semicolons'));
    }
    if (unitName && !unitKey) errors.push(error(record.rowNumber, 'unitName', 'orphan_name', 'unitName requires customerUnitKey'));
    if (teamName && !teamKey) errors.push(error(record.rowNumber, 'teamName', 'orphan_name', 'teamName requires customerTeamKey'));
    const personInput = {
      customerEmployeeId: get('customerEmployeeId'), workEmail: get('workEmail'),
      displayName: get('displayName'), jobTitle: get('jobTitle'),
      primaryRole: get('primaryRole') as PreparedDraftPerson['primaryRole'],
    };
    const baseErrors = inspectDraftPerson(personInput);
    for (const issue of baseErrors) errors.push(error(record.rowNumber, issue.field, issue.code, issue.message));
    const normalizedId = personInput.customerEmployeeId.trim();
    const normalizedEmail = personInput.workEmail.trim().toLowerCase();
    const earlierId = personIds.get(normalizedId);
    if (normalizedId && earlierId) errors.push(error(record.rowNumber, 'customerEmployeeId', 'duplicate_in_file', `Already used on row ${earlierId}`));
    else if (normalizedId) personIds.set(normalizedId, record.rowNumber);
    if (normalizedId && ownPeople.some((item) => item.customerEmployeeId === normalizedId)) {
      errors.push(error(record.rowNumber, 'customerEmployeeId', 'person_exists', 'Person already exists in this tenant'));
    }
    const earlierEmail = emails.get(normalizedEmail);
    if (normalizedEmail && earlierEmail) errors.push(error(record.rowNumber, 'workEmail', 'duplicate_in_file', `Already used on row ${earlierEmail}`));
    else if (normalizedEmail) emails.set(normalizedEmail, record.rowNumber);
    if (normalizedEmail && ownPeople.some((item) => item.workEmail === normalizedEmail)) {
      errors.push(error(record.rowNumber, 'workEmail', 'email_exists', 'Work email already exists in this tenant'));
    }
    if (baseErrors.length > 0) continue;
    const person = prepareDraftPerson(personInput);

    if (person.primaryRole === 'employee' || person.primaryRole === 'team_lead' || person.primaryRole === 'manager') {
      if (!unitKey) errors.push(error(record.rowNumber, 'customerUnitKey', 'required_for_role', 'Unit key is required for this role'));
      if (person.primaryRole === 'team_lead' && !teamKey) errors.push(error(record.rowNumber, 'customerTeamKey', 'required_for_role', 'Team Lead requires a Team key'));
      if (person.primaryRole === 'manager' && teamKey) errors.push(error(record.rowNumber, 'customerTeamKey', 'forbidden_for_role', 'Manager cannot be a Team member'));
      if (assignedUnitKeys.length || scopeMode) errors.push(error(record.rowNumber, 'assignedUnitKeys', 'forbidden_for_role', 'Line roles cannot have advisory scope'));
    } else {
      if (unitKey || teamKey) errors.push(error(record.rowNumber, 'customerUnitKey', 'forbidden_for_role', 'Advisory and Leadership roles are outside line placement'));
      if (person.primaryRole === 'hr' && assignedUnitKeys.length === 0) errors.push(error(record.rowNumber, 'assignedUnitKeys', 'required_for_role', 'HR requires selected Units'));
      if (person.primaryRole === 'hrbp') {
        if (scopeMode !== 'all_units' && scopeMode !== 'selected_units') errors.push(error(record.rowNumber, 'hrbpScopeMode', 'invalid_scope_mode', 'Use all_units or selected_units'));
        if (scopeMode === 'selected_units' && assignedUnitKeys.length === 0) errors.push(error(record.rowNumber, 'assignedUnitKeys', 'required_for_role', 'Selected HRBP scope requires Units'));
        if (scopeMode === 'all_units' && assignedUnitKeys.length > 0) errors.push(error(record.rowNumber, 'assignedUnitKeys', 'forbidden_for_scope', 'All-Unit HRBP has no selected Unit keys'));
      } else if (scopeMode) errors.push(error(record.rowNumber, 'hrbpScopeMode', 'forbidden_for_role', 'Scope mode is only for HRBP'));
      if (person.primaryRole === 'leadership' && assignedUnitKeys.length > 0) errors.push(error(record.rowNumber, 'assignedUnitKeys', 'forbidden_for_role', 'Leadership scope is tenant-wide'));
    }

    if (unitKey) {
      const existingUnit = ownUnits.get(unitKey);
      if (existingUnit && unitName && unitName !== existingUnit.name) errors.push(error(record.rowNumber, 'unitName', 'existing_unit_redefinition', 'CSV cannot rename an existing Unit'));
      if (unitName) {
        const priorName = unitNames.get(unitKey);
        if (priorName && priorName !== unitName) errors.push(error(record.rowNumber, 'unitName', 'conflicting_unit_name', 'Repeated Unit key has a different name'));
        else unitNames.set(unitKey, unitName);
      }
      if (person.primaryRole === 'manager') {
        if (existingUnit) errors.push(error(record.rowNumber, 'customerUnitKey', 'existing_unit_owner_change', 'CSV cannot change an existing Unit owner'));
        const priorOwner = unitOwners.get(unitKey);
        if (priorOwner) errors.push(error(record.rowNumber, 'customerUnitKey', 'multiple_unit_managers', `Manager already declared on row ${priorOwner}`));
        else unitOwners.set(unitKey, record.rowNumber);
      }
    }
    if (teamKey && unitKey) {
      const existingTeam = ownTeams.get(teamKey);
      if (existingTeam && (existingTeam.customerUnitKey !== unitKey || (teamName && teamName !== existingTeam.name))) {
        errors.push(error(record.rowNumber, 'customerTeamKey', 'existing_team_redefinition', 'CSV cannot change an existing Team'));
      }
      const prior = teamDefinitions.get(teamKey);
      if (prior && (prior.unitKey !== unitKey || (prior.name && teamName && prior.name !== teamName))) {
        errors.push(error(record.rowNumber, 'customerTeamKey', 'conflicting_team_definition', 'Repeated Team key has conflicting Unit or name'));
      } else if (!prior) teamDefinitions.set(teamKey, { name: teamName, unitKey, rowNumber: record.rowNumber });
      else if (!prior.name && teamName) prior.name = teamName;
      if (person.primaryRole === 'team_lead') {
        if (existingTeam) errors.push(error(record.rowNumber, 'customerTeamKey', 'existing_team_owner_change', 'CSV cannot change an existing Team Lead'));
        const priorOwner = teamOwners.get(teamKey);
        if (priorOwner) errors.push(error(record.rowNumber, 'customerTeamKey', 'multiple_team_leads', `Team Lead already declared on row ${priorOwner}`));
        else teamOwners.set(teamKey, record.rowNumber);
      }
    }

    rows.push({
      ...person, rowNumber: record.rowNumber, customerUnitKey: unitKey, unitName,
      customerTeamKey: teamKey, teamName, assignedUnitKeys,
      hrbpScopeMode: scopeMode === 'all_units' || scopeMode === 'selected_units' ? scopeMode : null,
      companyAdmin: adminValue === 'true',
    });
  }

  for (const row of rows) {
    if (row.customerUnitKey && !ownUnits.has(row.customerUnitKey) && !unitNames.has(row.customerUnitKey)) {
      const crossTenant = otherUnitKeys.has(row.customerUnitKey);
      errors.push(error(row.rowNumber, 'customerUnitKey', crossTenant ? 'cross_tenant_reference' : 'unknown_unit',
        crossTenant ? 'Unit key exists only in another tenant' : 'New Unit requires a unitName; existing Unit key was not found'));
    }
    if (row.customerTeamKey && !ownTeams.has(row.customerTeamKey) && !teamDefinitions.get(row.customerTeamKey)?.name) {
      const crossTenant = otherTeamKeys.has(row.customerTeamKey);
      errors.push(error(row.rowNumber, 'customerTeamKey', crossTenant ? 'cross_tenant_reference' : 'unknown_team',
        crossTenant ? 'Team key exists only in another tenant' : 'New Team requires a teamName; existing Team key was not found'));
    }
    for (const key of row.assignedUnitKeys) {
      if (!ownUnits.has(key) && !unitNames.has(key)) errors.push(error(row.rowNumber, 'assignedUnitKeys',
        otherUnitKeys.has(key) ? 'cross_tenant_reference' : 'unknown_unit', `Unit ${key} was not found in this tenant`));
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

function error(rowNumber: number, field: string, code: string, message: string): HierarchyCsvError {
  return { rowNumber, field, code, message };
}

function parseCsv(input: string): { records: CsvRecord[] } | { error: HierarchyCsvError } {
  const records: CsvRecord[] = [];
  const text = input.replace(/^\uFEFF/, '');
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowNumber = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else { cell += char; if (char === '\n') line += 1; }
      continue;
    }
    if (char === '"') {
      if (cell || afterQuote) return { error: error(rowNumber, 'file', 'unexpected_quote', 'Quote must start a field') };
      quoted = true;
    } else if (char === ',') {
      cells.push(cell); cell = ''; afterQuote = false;
    } else if (char === '\n' || char === '\r') {
      cells.push(cell);
      if (cells.some((value) => value.trim())) records.push({ rowNumber, cells });
      cells = []; cell = ''; afterQuote = false;
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      line += 1; rowNumber = line;
    } else {
      if (afterQuote) return { error: error(rowNumber, 'file', 'unexpected_character', 'Only a delimiter may follow a closing quote') };
      cell += char;
    }
  }
  if (quoted) return { error: error(rowNumber, 'file', 'unclosed_quote', 'Quoted field was not closed') };
  cells.push(cell);
  if (cells.some((value) => value.trim())) records.push({ rowNumber, cells });
  return { records };
}
