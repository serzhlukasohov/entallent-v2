import type { PulseLanguageResource, PulseResourceKind } from '@entalent/contracts';
export interface PulseLanguageRepositoryPort {
  read(locale: string, kind: PulseResourceKind, tenantId?: string): Promise<PulseLanguageResource | null>;
  install(resource: PulseLanguageResource): Promise<void>;
}
export interface PulseLanguageGeneratorPort {
  generate(input: { locale: string; kind: PulseResourceKind; source: Readonly<Record<string, string>>; attempt: number }): Promise<unknown>;
  review(input: { locale: string; kind: PulseResourceKind; source: Readonly<Record<string, string>>; candidate: Readonly<Record<string, string>> }): Promise<{ semanticPass: boolean; modelId: string; promptVersion: string }>;
  readonly modelId: string;
}
