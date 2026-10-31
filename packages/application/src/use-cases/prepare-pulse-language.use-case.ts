import { createHash } from 'node:crypto';
import { PULSE_COPY_VERSION, PulseLanguageUnavailable, PulseLocaleSchema, validatePulseTexts, type PulseLanguageResource, type PulseResourceKind } from '@entalent/contracts';
import type { PulseLanguageGeneratorPort, PulseLanguageRepositoryPort } from '../ports/pulse-language.port';
export function pulseTextHash(texts: Readonly<Record<string, string>>): string {
  return createHash('sha256').update(JSON.stringify(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}
export class PreparePulseLanguageUseCase {
  constructor(private readonly repository: PulseLanguageRepositoryPort, private readonly generator: PulseLanguageGeneratorPort) {}
  async execute(input: { tenantId?: string; locale: string; kind: PulseResourceKind; source: Readonly<Record<string, string>> }): Promise<PulseLanguageResource> {
    const locale = PulseLocaleSchema.parse(input.locale);
    if ((input.kind === 'definitions') !== Boolean(input.tenantId)) throw new Error('language_resource_scope_invalid');
    const sourceHash = pulseTextHash(input.source);
    const existing = await this.repository.read(locale, input.kind, input.tenantId);
    if (existing?.sourceHash === sourceHash && validatePulseTexts(input.source, existing.texts)) return existing;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const candidate = locale === 'en' && input.kind !== 'definitions' ? input.source : await this.generator.generate({ ...input, locale, attempt });
        if (!validatePulseTexts(input.source, candidate)) continue;
        const review = locale === 'en' && input.kind !== 'definitions' ? { semanticPass: true, modelId: 'reviewed-product-source', promptVersion: PULSE_COPY_VERSION } : await this.generator.review({ ...input, locale, candidate });
        if (review.semanticPass !== true) continue;
        const resource: PulseLanguageResource = {
          ...(input.tenantId ? {tenantId:input.tenantId} : {}), locale, kind: input.kind, version: PULSE_COPY_VERSION, sourceHash, textHash: pulseTextHash(candidate), texts: { ...candidate }, status: 'accepted',
          provenance: { generator: locale === 'en' && input.kind !== 'definitions' ? 'reviewed-product-source' : this.generator.modelId, reviewer: review.modelId, promptVersion: review.promptVersion, semanticPass: true },
        };
        await this.repository.install(resource);
        return resource;
      } catch { /* bounded candidate budget; installation never occurs before semantic review */ }
    }
    throw new PulseLanguageUnavailable(locale, input.kind);
  }
}
