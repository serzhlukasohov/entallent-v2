import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PULSE_COPY_VERSION, PULSE_ENGLISH_RESOURCES, PulseResourceSchema, validatePulseTexts, type PulseLanguageResource, type PulseResourceKind } from '@entalent/contracts';
import { pulseTextHash, type PulseLanguageRepositoryPort } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
@Injectable()
export class PulseLanguageRepository implements PulseLanguageRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async read(locale: string, kind: PulseResourceKind, tenantId?: string): Promise<PulseLanguageResource | null> {
    if (kind === 'definitions') {
      if (!tenantId) return null;
      const rows = await this.db.client.execute(sql`select tenant_id as "tenantId",locale,'definitions' as kind,version,source_hash as "sourceHash",text_hash as "textHash",texts,provenance,'accepted' as status from pulse_tenant_definition_resources where tenant_id=${tenantId}::uuid and locale=${locale} and version=${PULSE_COPY_VERSION} order by created_at desc limit 1`) as unknown as unknown[];
      const parsed=PulseResourceSchema.safeParse(rows[0]);
      return parsed.success && parsed.data.textHash===pulseTextHash(parsed.data.texts) ? parsed.data : null;
    }
    const source = kind in PULSE_ENGLISH_RESOURCES ? PULSE_ENGLISH_RESOURCES[kind as keyof typeof PULSE_ENGLISH_RESOURCES] : null;
    if (locale === 'en' && source) return {
      locale, kind, version: PULSE_COPY_VERSION, sourceHash: pulseTextHash(source), textHash: pulseTextHash(source), texts: { ...source }, status: 'accepted',
      provenance: { generator: 'reviewed-product-source', reviewer: 'reviewed-product-source', promptVersion: PULSE_COPY_VERSION, semanticPass: true },
    };
    const rows = await this.db.client.execute(sql`select locale,kind,version,source_hash as "sourceHash",text_hash as "textHash",texts,provenance,'accepted' as status from pulse_language_resources where locale=${locale} and kind=${kind} and version=${PULSE_COPY_VERSION} ${source ? sql`and source_hash=${pulseTextHash(source)}` : sql``} order by created_at desc limit 1`) as unknown as unknown[];
    const parsed = PulseResourceSchema.safeParse(rows[0]);
    if (!parsed.success || pulseTextHash(parsed.data.texts) !== parsed.data.textHash || (source && !validatePulseTexts(source, parsed.data.texts))) return null;
    return parsed.data;
  }
  async install(input: PulseLanguageResource): Promise<void> {
    const r = PulseResourceSchema.parse(input);
    if ((r.kind === 'definitions') !== Boolean(r.tenantId)) throw new Error('language_resource_scope_invalid');
    if (r.kind === 'definitions') {
      if(pulseTextHash(r.texts)!==r.textHash) throw new Error('language_hash_invalid');
      await this.db.client.execute(sql`insert into pulse_tenant_definition_resources(tenant_id,locale,version,source_hash,text_hash,texts,provenance) values(${r.tenantId}::uuid,${r.locale},${r.version},${r.sourceHash},${r.textHash},${JSON.stringify(r.texts)}::jsonb,${JSON.stringify(r.provenance)}::jsonb) on conflict do nothing`);
      const stored=await this.read(r.locale,r.kind,r.tenantId);if(stored?.textHash!==r.textHash)throw new Error('language_resource_immutable');return;
    }
    if (pulseTextHash(r.texts) !== r.textHash) throw new Error('language_hash_invalid');
    const source = r.kind in PULSE_ENGLISH_RESOURCES ? PULSE_ENGLISH_RESOURCES[r.kind as keyof typeof PULSE_ENGLISH_RESOURCES] : null;
    if (source && (r.sourceHash !== pulseTextHash(source) || !validatePulseTexts(source, r.texts))) throw new Error('language_source_invalid');
    await this.db.client.execute(sql`insert into pulse_language_resources(locale,kind,version,source_hash,text_hash,texts,provenance) values(${r.locale},${r.kind},${r.version},${r.sourceHash},${r.textHash},${JSON.stringify(r.texts)}::jsonb,${JSON.stringify(r.provenance)}::jsonb) on conflict do nothing`);
    const stored = await this.read(r.locale, r.kind);
    if (stored?.textHash !== r.textHash) throw new Error('language_resource_immutable');
  }
}
