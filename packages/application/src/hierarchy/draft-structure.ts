export interface DraftUnitInput {
  customerUnitKey: string;
  name: string;
  managerPersonId?: string | null;
}

export interface DraftTeamInput {
  customerTeamKey: string;
  name: string;
  unitId: string;
  teamLeadPersonId?: string | null;
}

export class DraftStructureValidationError extends Error {
  constructor(readonly field: string, readonly code: string) {
    super(`${field}: ${code}`);
    this.name = 'DraftStructureValidationError';
  }
}

function required(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new DraftStructureValidationError(field, 'required');
  return normalized;
}

export function prepareDraftUnit(input: DraftUnitInput): DraftUnitInput {
  return {
    customerUnitKey: required(input.customerUnitKey, 'customerUnitKey'),
    name: required(input.name, 'name'),
    managerPersonId: input.managerPersonId == null ? null : required(input.managerPersonId, 'managerPersonId'),
  };
}

export function prepareDraftTeam(input: DraftTeamInput): DraftTeamInput {
  return {
    customerTeamKey: required(input.customerTeamKey, 'customerTeamKey'),
    name: required(input.name, 'name'),
    unitId: required(input.unitId, 'unitId'),
    teamLeadPersonId: input.teamLeadPersonId == null ? null : required(input.teamLeadPersonId, 'teamLeadPersonId'),
  };
}
