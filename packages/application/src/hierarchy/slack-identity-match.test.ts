import { describe, expect, it } from 'vitest';
import { matchSlackIdentity, type SlackIdentityCandidate } from './slack-identity-match';

const person = { tenantId: 'tenant-1', workspaceId: 'workspace-1', personId: 'person-1', workEmail: ' PERSON@Example.com ' };
const account: SlackIdentityCandidate = {
  tenantId: 'tenant-1', workspaceId: 'workspace-1', externalUserId: 'U123',
  email: 'person@example.com', assignedPersonId: null, isBot: false, deleted: false,
};

describe('matchSlackIdentity', () => {
  it('matches one eligible account by exact normalized email', () => {
    expect(matchSlackIdentity({ ...person, candidates: [account] })).toEqual({ status: 'matched', externalUserId: 'U123' });
    expect(matchSlackIdentity({ ...person, candidates: [{ ...account, assignedPersonId: person.personId }] }))
      .toEqual({ status: 'matched', externalUserId: 'U123' });
  });

  it('never matches by display name or another tenant or workspace', () => {
    expect(matchSlackIdentity({ ...person, candidates: [
      { ...account, email: 'different@example.com' },
      { ...account, tenantId: 'tenant-2' },
      { ...account, workspaceId: 'workspace-2' },
    ] })).toEqual({ status: 'missing_slack_match' });
  });

  it('keeps ambiguous, bot, deleted and already assigned identities out of automatic linking', () => {
    expect(matchSlackIdentity({ ...person, candidates: [account, { ...account, externalUserId: 'U456' }] }))
      .toEqual({ status: 'ambiguous_slack_match' });
    expect(matchSlackIdentity({ ...person, candidates: [{ ...account, isBot: true }, { ...account, deleted: true }] }))
      .toEqual({ status: 'missing_slack_match' });
    expect(matchSlackIdentity({ ...person, candidates: [{ ...account, assignedPersonId: 'person-2' }] }))
      .toEqual({ status: 'account_already_assigned' });
  });
});
