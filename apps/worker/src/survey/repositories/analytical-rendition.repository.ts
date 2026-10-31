import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { lockPulseReportSubject } from '@entalent/database';
import { PULSE_LANGUAGE_POLICY } from '@entalent/contracts';
import type { AnalyticalRendition, AnalyticalRenditionRepositoryPort, AnalyticalRenditionSource } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
@Injectable()
export class AnalyticalRenditionRepository implements AnalyticalRenditionRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async loadPermittedSource(tenantId: string, analyticalId: string): Promise<AnalyticalRenditionSource | null> {
    const rows = await this.db.client.execute(sql`select * from pulse_language_permitted_source(${tenantId}::uuid,${analyticalId}::uuid)`) as unknown as AnalyticalRenditionSource[];
    return rows[0] ? { ...rows[0], expiresAt: new Date(rows[0].expiresAt) } : null;
  }
  async install(r: AnalyticalRendition): Promise<'installed' | 'stale'> {
    return this.db.client.transaction(async tx => {
      await lockPulseReportSubject(tx, r.source.tenantId, r.source.userId);
      const rows = await tx.execute(sql`select * from pulse_language_permitted_source(${r.source.tenantId}::uuid,${r.source.analyticalId}::uuid)`) as unknown as AnalyticalRenditionSource[];
      const source = rows[0];
      if (!source || source.sourceHash !== r.source.sourceHash || r.policyVersion !== PULSE_LANGUAGE_POLICY) return 'stale';
      await tx.execute(sql`insert into pulse_analytical_renditions(tenant_id,user_id,analytical_id,source_hash,locale,text,support,policy_version,model_id,prompt_version,expires_at) values(${source.tenantId}::uuid,${source.userId}::uuid,${source.analyticalId}::uuid,${source.sourceHash},${r.locale},${r.text},${source.support},${r.policyVersion},${r.modelId},${r.promptVersion},${source.expiresAt}::timestamptz) on conflict do nothing`);
      return 'installed';
    });
  }
  async read(tenantId: string, analyticalId: string, locale: string): Promise<AnalyticalRendition | null> {
    const source = await this.loadPermittedSource(tenantId, analyticalId);
    if (!source) return null;
    const rows = await this.db.client.execute(sql`select text,policy_version as "policyVersion",model_id as "modelId",prompt_version as "promptVersion" from pulse_analytical_renditions where tenant_id=${tenantId}::uuid and analytical_id=${analyticalId}::uuid and locale=${locale} and source_hash=${source.sourceHash} and policy_version=${PULSE_LANGUAGE_POLICY} and expires_at>clock_timestamp()`) as unknown as Pick<AnalyticalRendition, 'text' | 'policyVersion' | 'modelId' | 'promptVersion'>[];
    return rows[0] ? { ...rows[0], source, locale } : null;
  }
}
