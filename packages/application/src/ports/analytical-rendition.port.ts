export interface AnalyticalRenditionSource {
  tenantId: string; userId: string; analyticalId: string; sourceHash: string;
  summary: string; support: string; sourceLocale: string | null; expiresAt: Date;
}
export interface AnalyticalRendition {
  source: AnalyticalRenditionSource; locale: string; text: string; policyVersion: string;
  modelId: string; promptVersion: string;
}
export interface AnalyticalRenditionRepositoryPort {
  loadPermittedSource(tenantId: string, analyticalId: string): Promise<AnalyticalRenditionSource | null>;
  install(rendition: AnalyticalRendition): Promise<'installed' | 'stale'>;
  read(tenantId: string, analyticalId: string, locale: string): Promise<AnalyticalRendition | null>;
}
export interface AnalyticalRenditionGeneratorPort {
  translate(input: { source: AnalyticalRenditionSource; locale: string; attempt: number }): Promise<unknown>;
  reviewTranslation(input: { source: AnalyticalRenditionSource; locale: string; text: string }): Promise<{ semanticPass: boolean; modelId: string; promptVersion: string }>;
}
