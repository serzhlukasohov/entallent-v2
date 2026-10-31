import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PulseReportSlackAssemblyService } from './pulse-report-slack-assembly.service';
import { PULSE_ENGLISH_LABELS, type PulseReportPresentation } from '@entalent/contracts';
function setup() {
  const presentation = {
    contract: 'pulse-presentation-v1',
    variant: 'team_lead_final',
    purpose: 'final',
    audience: 'team_lead',
    locale: 'en',
    period: 'October 2026',
    labels: PULSE_ENGLISH_LABELS,
    labelVersion: 'pulse-labels-v1',
    labelHash: createHash('sha256').update(JSON.stringify(PULSE_ENGLISH_LABELS)).digest('hex'),
    sections: [{ sectionKey: 'sA', label: 'Frozen team', status: 'insufficient_data' }],
  } as PulseReportPresentation;
  const provenance = { context: { request: {} }, sections: [], evidenceMappings: {} };
  const build = { execute: vi.fn(async () => ({ status: 'built', presentation, provenance })) };
  const repository = { validate: vi.fn(async () => true) };
  return {
    presentation,
    build,
    repository,
    service: new PulseReportSlackAssemblyService(build as never, repository as never),
  };
}
const request = {
  tenantId: 'tenant',
  cycleId: 'cycle',
  overallScopeId: 'overall',
  audience: 'team_lead' as const,
  purpose: 'final' as const,
};
describe('RPT06 callable worker assembly boundary', () => {
  it('returns package only after a separate post-render current-rights revalidation', async () => {
    const h = setup();
    const r = await h.service.assemble(request);
    expect(r.status).toBe('built');
    expect(r).toHaveProperty('slack.parts');
    expect(h.repository.validate).toHaveBeenCalledTimes(1);
  });
  it('post-render invalidation discards every publishable part', async () => {
    const h = setup();
    h.repository.validate.mockResolvedValue(false);
    expect(await h.service.assemble(request)).toEqual({ status: 'invalidated' });
  });
  it('typed rendering failure never returns a partial logical package or performs rights validation', async () => {
    const h = setup();
    h.presentation.labelHash = 'changed';
    expect(await h.service.assemble(request)).toEqual({ status: 'language_unavailable' });
    expect(h.repository.validate).not.toHaveBeenCalled();
  });
  it('technical upstream preparation failure propagates before any renderer/revalidation', async () => {
    const h = setup();
    h.build.execute.mockResolvedValue({ status: 'pending' } as never);
    expect(await h.service.assemble(request)).toEqual({ status: 'pending' });
    expect(h.repository.validate).not.toHaveBeenCalled();
  });
});
