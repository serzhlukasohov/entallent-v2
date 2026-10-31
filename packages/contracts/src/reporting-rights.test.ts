import { describe, expect, it } from 'vitest';
import {
  parseReportingRightsActionId, parseReportingRightsButtonValue, PULSE_ENGLISH_RESOURCES, PULSE_SOURCE_REPORTING_RIGHTS,
  reportingRightsActionId, reportingRightsButtonValue, ReportingRightsJobSchema, reportingRightsRenderJobId,
} from './index';

const MENU = '00000000-0000-4000-8000-0000000000a1';
describe('RPT-09 reporting-rights protocol contract', () => {
  it('accepts only the namespaced action ids', () => {
    expect(reportingRightsActionId('confirm')).toBe('reporting_rights:confirm');
    expect(parseReportingRightsActionId('reporting_rights:confirm')).toBe('confirm');
    for (const bad of ['reporting_rights:withdraw', 'onboarding:start', 'reporting_rights:', 'confirm', 7, undefined]) {
      expect(parseReportingRightsActionId(bad)).toBeNull();
    }
  });
  it('button values carry only a menu token and an option index', () => {
    expect(parseReportingRightsButtonValue(reportingRightsButtonValue(MENU))).toEqual({ menuId: MENU });
    expect(parseReportingRightsButtonValue(reportingRightsButtonValue(MENU, 12))).toEqual({ menuId: MENU, index: 12 });
    for (const bad of [`${MENU}:01`, `${MENU}:-1`, `${MENU}:1:2`, `${MENU}:1000`, 'not-a-uuid', `${MENU.toUpperCase()}`, 3, '']) {
      expect(parseReportingRightsButtonValue(bad)).toBeNull();
    }
  });
  it('validates queue jobs strictly', () => {
    expect(ReportingRightsJobSchema.parse({ kind: 'apply', tenantId: MENU, admissionId: MENU })).toEqual({ kind: 'apply', tenantId: MENU, admissionId: MENU });
    expect(ReportingRightsJobSchema.parse({ kind: 'render', tenantId: MENU, menuId: MENU, view: 'topics', clickTs: '1.2' })).toMatchObject({ page: 0 });
    expect(ReportingRightsJobSchema.safeParse({ kind: 'apply', tenantId: MENU, admissionId: MENU, lineageIds: [] }).success).toBe(false);
    expect(reportingRightsRenderJobId(MENU, 'topics', 1, '1700000000.123:x')).toBe(`reporting-rights-render-${MENU}-topics-1-1700000000.123`);
  });
  it('publishes the English rights source as a localizable pulse resource', () => {
    expect(PULSE_ENGLISH_RESOURCES.reporting_rights).toBe(PULSE_SOURCE_REPORTING_RIGHTS);
    expect(PULSE_SOURCE_REPORTING_RIGHTS['button.full']).toBe('Withdraw all');
    expect(PULSE_SOURCE_REPORTING_RIGHTS['button.topics']).toBe('Choose topics');
  });
});
