export type PrimaryOrgRole = 'employee' | 'team_lead' | 'manager' | 'hr' | 'hrbp' | 'leadership';

export interface DraftPersonInput {
  customerEmployeeId: string;
  workEmail: string;
  displayName: string;
  jobTitle?: string | null;
  primaryRole: PrimaryOrgRole;
}

export interface PreparedDraftPerson {
  customerEmployeeId: string;
  workEmail: string;
  displayName: string;
  jobTitle: string | null;
  primaryRole: PrimaryOrgRole;
  pulseParticipant: boolean;
}

export class DraftPersonValidationError extends Error {
  constructor(readonly field: keyof DraftPersonInput, readonly code: string) {
    super(`${field}: ${code}`);
    this.name = 'DraftPersonValidationError';
  }
}

const PRIMARY_ROLES = new Set<PrimaryOrgRole>(['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership']);

export function inspectDraftPerson(input: DraftPersonInput): DraftPersonValidationError[] {
  const errors: DraftPersonValidationError[] = [];
  const customerEmployeeId = input.customerEmployeeId?.trim();
  if (!customerEmployeeId) errors.push(new DraftPersonValidationError('customerEmployeeId', 'required'));

  const workEmail = input.workEmail?.trim().toLowerCase();
  if (!workEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    errors.push(new DraftPersonValidationError('workEmail', 'invalid'));
  }

  const displayName = input.displayName?.trim();
  if (!displayName) errors.push(new DraftPersonValidationError('displayName', 'required'));
  if (!PRIMARY_ROLES.has(input.primaryRole)) errors.push(new DraftPersonValidationError('primaryRole', 'invalid'));
  return errors;
}

export function prepareDraftPerson(input: DraftPersonInput): PreparedDraftPerson {
  const errors = inspectDraftPerson(input);
  if (errors[0]) throw errors[0];

  return {
    customerEmployeeId: input.customerEmployeeId.trim(),
    workEmail: input.workEmail.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    jobTitle: input.jobTitle?.trim() || null,
    primaryRole: input.primaryRole,
    pulseParticipant: input.primaryRole === 'employee' || input.primaryRole === 'team_lead',
  };
}
