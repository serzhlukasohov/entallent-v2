import { describe, expect, it } from 'vitest';
import { prepareDraftTeam, prepareDraftUnit } from './draft-structure';

describe('draft hierarchy structure', () => {
  it('normalizes stable keys and names without requiring draft owners', () => {
    expect(prepareDraftUnit({ customerUnitKey: ' U-1 ', name: ' Sales ' })).toEqual({
      customerUnitKey: 'U-1', name: 'Sales', managerPersonId: null,
    });
    expect(prepareDraftTeam({ customerTeamKey: ' T-1 ', name: ' North ', unitId: ' unit-1 ' })).toEqual({
      customerTeamKey: 'T-1', name: 'North', unitId: 'unit-1', teamLeadPersonId: null,
    });
  });

  it('rejects blank stable keys and missing Unit reference', () => {
    expect(() => prepareDraftUnit({ customerUnitKey: ' ', name: 'Sales' })).toThrow('customerUnitKey: required');
    expect(() => prepareDraftTeam({ customerTeamKey: 'T-1', name: 'North', unitId: ' ' })).toThrow('unitId: required');
  });
});
