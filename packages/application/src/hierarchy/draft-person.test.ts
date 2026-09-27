import { describe, expect, it } from 'vitest';
import { DraftPersonValidationError, prepareDraftPerson } from './draft-person';

describe('prepareDraftPerson', () => {
  it('normalizes stable identity and derives Pulse participation from role', () => {
    expect(prepareDraftPerson({
      customerEmployeeId: '  E-001 ', workEmail: ' Alex@Example.com ', displayName: ' Alex ',
      jobTitle: ' Lead ', primaryRole: 'team_lead',
    })).toEqual({
      customerEmployeeId: 'E-001', workEmail: 'alex@example.com', displayName: 'Alex',
      jobTitle: 'Lead', primaryRole: 'team_lead', pulseParticipant: true,
    });
    expect(prepareDraftPerson({
      customerEmployeeId: 'M-001', workEmail: 'manager@example.com', displayName: 'Manager', primaryRole: 'manager',
    }).pulseParticipant).toBe(false);
  });

  it('rejects malformed identity and unsupported roles before persistence', () => {
    expect(() => prepareDraftPerson({
      customerEmployeeId: ' ', workEmail: 'a@example.com', displayName: 'Alex', primaryRole: 'employee',
    })).toThrow(DraftPersonValidationError);
    expect(() => prepareDraftPerson({
      customerEmployeeId: 'E-001', workEmail: 'not-an-email', displayName: 'Alex', primaryRole: 'employee',
    })).toThrow('workEmail: invalid');
    expect(() => prepareDraftPerson({
      customerEmployeeId: 'E-001', workEmail: 'a@example.com', displayName: 'Alex', primaryRole: 'owner' as 'employee',
    })).toThrow('primaryRole: invalid');
  });
});
