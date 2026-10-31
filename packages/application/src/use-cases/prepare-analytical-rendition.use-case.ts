import { PULSE_LANGUAGE_POLICY, PulseLanguageUnavailable, PulseLocaleSchema } from '@entalent/contracts';
import { evaluateQuestionDeidentification } from '../utils/question-deidentification-policy';
import type { AnalyticalRenditionGeneratorPort, AnalyticalRenditionRepositoryPort } from '../ports/analytical-rendition.port';
export class PrepareAnalyticalRenditionUseCase {
  constructor(private readonly repository: AnalyticalRenditionRepositoryPort, private readonly generator: AnalyticalRenditionGeneratorPort) {}
  async execute(input: { tenantId: string; analyticalId: string; locale: string }): Promise<'installed' | 'stale'> {
    const locale = PulseLocaleSchema.parse(input.locale);
    const source = await this.repository.loadPermittedSource(input.tenantId, input.analyticalId);
    if (!source) return 'stale';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await this.generator.translate({ source, locale, attempt });
        if (typeof text !== 'string' || !text.trim() || text.length > 600 || evaluateQuestionDeidentification({ text }).status !== 'accepted') continue;
        const review = await this.generator.reviewTranslation({ source, locale, text });
        if (review.semanticPass !== true) continue;
        return this.repository.install({ source, locale, text, policyVersion: PULSE_LANGUAGE_POLICY, modelId: review.modelId, promptVersion: review.promptVersion });
      } catch { /* no third candidate or read-time recovery */ }
    }
    throw new PulseLanguageUnavailable(locale, 'safe_signal');
  }
}
