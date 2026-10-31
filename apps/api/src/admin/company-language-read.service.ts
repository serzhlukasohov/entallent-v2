import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { canonicalCompanyLocale, PULSE_COPY_VERSION, PULSE_SOURCE_ADMIN, PulseResourceSchema, validatePulseTexts, type PulseLanguageReadMetadata } from '@entalent/contracts';
import { pulseTextHash } from '@entalent/application';
import { DatabaseService } from '../database/database.service';
/** Pure reads only. Tenant identity must come from the existing protected route. */
@Injectable()
export class CompanyLanguageReadService {
  constructor(private readonly db: DatabaseService) {}
  async read(tenantId: string): Promise<PulseLanguageReadMetadata> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) throw new BadRequestException('invalid_tenant_id');
    const tenants = await this.db.client.execute(sql`select locale from tenants where id=${tenantId}::uuid`) as unknown as { locale: unknown }[];
    if (!tenants[0]) throw new NotFoundException('tenant_not_found');
    const locale = canonicalCompanyLocale(tenants[0].locale);
    if (!locale) throw new BadRequestException('invalid_company_locale');
    const rows = await this.db.client.execute(sql`select locale,kind,version,source_hash as "sourceHash",text_hash as "textHash",texts,provenance,'accepted' as status from pulse_language_resources where locale=${locale} and version=${PULSE_COPY_VERSION} and kind='admin' order by created_at`) as unknown as unknown[];
    const resources: PulseLanguageReadMetadata['resources'] = {};
    for (const row of rows) {
      const parsed = PulseResourceSchema.safeParse(row);
      if (parsed.success && parsed.data.textHash === pulseTextHash(parsed.data.texts) && (parsed.data.kind !== 'admin' || (parsed.data.sourceHash === pulseTextHash(PULSE_SOURCE_ADMIN) && validatePulseTexts(PULSE_SOURCE_ADMIN, parsed.data.texts)))) resources[parsed.data.kind] = parsed.data;
    }
    const definitions=await this.db.client.execute(sql`select tenant_id as "tenantId",locale,'definitions' as kind,version,source_hash as "sourceHash",text_hash as "textHash",texts,provenance,'accepted' as status from pulse_tenant_definition_resources where tenant_id=${tenantId}::uuid and locale=${locale} and version=${PULSE_COPY_VERSION} order by created_at desc limit 1`) as unknown as unknown[];
    const definitionResource=PulseResourceSchema.safeParse(definitions[0]);
    if(definitionResource.success && definitionResource.data.textHash===pulseTextHash(definitionResource.data.texts)) resources.definitions=definitionResource.data;
    if (locale === 'en') resources.admin = { locale,kind:'admin',version:PULSE_COPY_VERSION,sourceHash:pulseTextHash(PULSE_SOURCE_ADMIN),textHash:pulseTextHash(PULSE_SOURCE_ADMIN),texts:{...PULSE_SOURCE_ADMIN},status:'accepted',provenance:{generator:'reviewed-product-source',reviewer:'reviewed-product-source',promptVersion:PULSE_COPY_VERSION,semanticPass:true} };
    return { locale, resourceVersion: PULSE_COPY_VERSION, status: locale === 'en' || resources.admin ? 'ready' : 'language_unavailable', resources };
  }
}

export function definitionDisplay(language: PulseLanguageReadMetadata, stableKey: string, title: string) {
  const sourceHash=createHash('sha256').update(stableKey+'\0'+title).digest('hex');
  const text=language.resources.definitions?.texts['title.'+sourceHash] ?? null;
  return {status:text?'ready' as const:'language_unavailable' as const,locale:language.locale,text,sourceHash};
}
