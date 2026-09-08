import { describe, expect, it } from 'vitest';
import { evaluateDeidentification, isAcceptedDeidentificationDecision } from './deidentification-policy';

describe('evaluateDeidentification', () => {
  it('accepts generalized reportable summaries', () => {
    expect(evaluateDeidentification({
      text: 'Several people feel blocked when ownership is unclear and decisions take too long.',
    })).toEqual({
      status: 'accepted',
      policyVersion: 'deidentification-v1',
      reasons: [],
    });
  });

  it('rejects direct and concrete identifiers with machine-readable reasons', () => {
    expect(evaluateDeidentification({
      text: 'Sam raised Project Apollo in <@U123> on 3 September.',
      knownIdentifiers: ['Sam'],
      sourceMessageIds: ['message-1'],
    })).toEqual({
      status: 'rejected',
      policyVersion: 'deidentification-v1',
      reasons: ['exact_date_or_time', 'known_identifier', 'project_or_customer_identifier', 'slack_handle'],
    });
  });

  it('does not treat accepted decisions with rejection reasons as accepted', () => {
    expect(isAcceptedDeidentificationDecision({
      status: 'accepted',
      policyVersion: 'deidentification-v1',
      reasons: ['known_identifier'],
    } as never)).toBe(false);
  });
});
