export interface SlackIdentityCandidate {
  tenantId: string;
  workspaceId: string;
  externalUserId: string;
  email: string | null;
  assignedPersonId: string | null;
  isBot: boolean;
  deleted: boolean;
}

export interface SlackIdentityMatchInput {
  tenantId: string;
  workspaceId: string;
  personId: string;
  workEmail: string;
  candidates: SlackIdentityCandidate[];
}

export type SlackIdentityMatch =
  | { status: 'matched'; externalUserId: string }
  | { status: 'missing_slack_match' | 'ambiguous_slack_match' | 'account_already_assigned' };

export function matchSlackIdentity(input: SlackIdentityMatchInput): SlackIdentityMatch {
  const workEmail = input.workEmail.trim().toLowerCase();
  if (!workEmail) return { status: 'missing_slack_match' };

  const matches = input.candidates.filter((candidate) =>
    candidate.tenantId === input.tenantId &&
    candidate.workspaceId === input.workspaceId &&
    !candidate.isBot && !candidate.deleted &&
    candidate.email?.trim().toLowerCase() === workEmail,
  );
  if (matches.length === 0) return { status: 'missing_slack_match' };
  if (matches.length !== 1) return { status: 'ambiguous_slack_match' };

  const account = matches[0]!;
  if (account.assignedPersonId && account.assignedPersonId !== input.personId) {
    return { status: 'account_already_assigned' };
  }
  return { status: 'matched', externalUserId: account.externalUserId };
}
