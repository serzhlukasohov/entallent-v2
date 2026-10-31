import { describe, expect, it, vi } from 'vitest';
import { PreparePulseLanguageUseCase } from './prepare-pulse-language.use-case';
import type { PulseLanguageGeneratorPort, PulseLanguageRepositoryPort } from '../ports/pulse-language.port';
const source = { title: 'Hello {name}' };
function fixture() {
  const repository = { read: vi.fn().mockResolvedValue(null), install: vi.fn() } satisfies PulseLanguageRepositoryPort;
  const generator = { modelId: 'fake-generation', generate: vi.fn().mockResolvedValue({ title: 'Hallo {name}' }), review: vi.fn().mockResolvedValue({ semanticPass: true, modelId: 'fake-review', promptVersion: 'v1' }) } satisfies PulseLanguageGeneratorPort;
  return { repository, generator, useCase: new PreparePulseLanguageUseCase(repository, generator) };
}
describe('prepare accepted resources', () => {
  it('installs only reviewed exact-key candidates, preserving provenance', async () => {
    const { useCase, generator, repository } = fixture();
    const result = await useCase.execute({ locale: 'de', kind: 'admin', source });
    expect(result.texts).toEqual({ title: 'Hallo {name}' });
    expect(result.provenance.reviewer).toBe('fake-review');
    expect(generator.generate).toHaveBeenCalledTimes(1); expect(generator.review).toHaveBeenCalledTimes(1); expect(repository.install).toHaveBeenCalledTimes(1);
  });
  it('bounds rejected reviews to two candidates and never installs', async () => {
    const { useCase, generator, repository } = fixture(); generator.review.mockResolvedValue({ semanticPass: false, modelId: 'fake-review', promptVersion: 'v1' });
    await expect(useCase.execute({ locale: 'uk', kind: 'admin', source })).rejects.toMatchObject({ code: 'language_unavailable', locale: 'uk' });
    expect(generator.generate).toHaveBeenCalledTimes(2); expect(generator.review).toHaveBeenCalledTimes(2); expect(repository.install).not.toHaveBeenCalled();
  });
  it('does not spend a review call on malformed keys', async () => {
    const { useCase, generator, repository } = fixture(); generator.generate.mockResolvedValue({ title: 'Hallo' });
    await expect(useCase.execute({ locale: 'de', kind: 'admin', source })).rejects.toThrow();
    expect(generator.review).not.toHaveBeenCalled(); expect(repository.install).not.toHaveBeenCalled();
  });
});
