import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { createDbClient, surveyDefinitions, surveyQuestions, surveyEngagementContractQuestions, surveyEngagementCollectionContracts } from '@entalent/database';
import { hasCompleteV2ScoringPolicy, hasCompleteReportEngagementPolicy } from '@entalent/application';
import { ENGAGEMENT_ANSWER_CONTRACT, ENGAGEMENT_QUESTIONS, ENGAGEMENT_RESPONSE_TYPE, REPORT_ENGAGEMENT_DEFINITION_VERSION } from '@entalent/application';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function prepareReportEngagementDefinition(databaseUrl: string, tenantId: string, sourceDefinitionId: string): Promise<string> {
  const rubrics: unknown = JSON.parse(await readFile(resolve(__dirname, 'data/v2-scoring-policy-1.0.0.json'), 'utf8'));
  const client = createDbClient(databaseUrl);
  try {
    return await client.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('engagement-catalog:' || ${tenantId}::uuid::text, 0))`);
      const [source] = await tx.select().from(surveyDefinitions).where(and(eq(surveyDefinitions.id, sourceDefinitionId), eq(surveyDefinitions.tenantId, tenantId)));
      const questions = await tx.select().from(surveyQuestions).where(eq(surveyQuestions.surveyDefinitionId, sourceDefinitionId));
      if (!source || source.version !== 'v2-policy-1.0.0' || !hasCompleteV2ScoringPolicy(questions, rubrics)) throw new Error('approved_canonical_source_required');
      const [existing] = await tx.select().from(surveyDefinitions).where(and(eq(surveyDefinitions.tenantId, tenantId), eq(surveyDefinitions.version, REPORT_ENGAGEMENT_DEFINITION_VERSION)));
      if (existing) {
        const declared = await tx.select().from(surveyQuestions).where(eq(surveyQuestions.surveyDefinitionId, existing.id));
        const contracts = await tx.select().from(surveyEngagementContractQuestions).where(eq(surveyEngagementContractQuestions.surveyDefinitionId, existing.id));
        const [collection] = await tx.select().from(surveyEngagementCollectionContracts).where(eq(surveyEngagementCollectionContracts.surveyDefinitionId, existing.id));
        if (!collection || collection.sourceDefinitionId !== sourceDefinitionId || !hasCompleteReportEngagementPolicy(declared, rubrics, contracts) || contracts.length !== 3 || (existing.configuration as Record<string,unknown>)['engagementAnswerContract'] !== ENGAGEMENT_ANSWER_CONTRACT) throw new Error('engagement_catalog_conflict');
        return existing.id;
      }
      const [definition] = await tx.insert(surveyDefinitions).values({ tenantId, name: 'Report Engagement V1', version: REPORT_ENGAGEMENT_DEFINITION_VERSION, active: false, configuration: { engagementAnswerContract: ENGAGEMENT_ANSWER_CONTRACT, sourceDefinitionId } }).returning();
      for (const question of questions) {
        const { id: _id, surveyDefinitionId: _definition, ...content } = question;
        await tx.insert(surveyQuestions).values({ ...content, surveyDefinitionId: definition!.id });
      }
      for (const [index, declared] of ENGAGEMENT_QUESTIONS.entries()) {
        const [question] = await tx.insert(surveyQuestions).values({ ...declared, surveyDefinitionId: definition!.id, dimension: 'engagement', questionGroup: 'engagement', responseType: ENGAGEMENT_RESPONSE_TYPE, version: ENGAGEMENT_ANSWER_CONTRACT, displayOrder: 12 + index, minimumEvidenceCount: 1 }).returning();
        await tx.insert(surveyEngagementContractQuestions).values({ surveyQuestionId: question!.id, surveyDefinitionId: definition!.id, contractVersion: ENGAGEMENT_ANSWER_CONTRACT, stableKey: declared.stableKey, questionVersion: ENGAGEMENT_ANSWER_CONTRACT, displayedTextHash: createHash('sha256').update(declared.title).digest('hex') });
      }
      await tx.insert(surveyEngagementCollectionContracts).values({ surveyDefinitionId: definition!.id, tenantId, sourceDefinitionId, contractVersion: ENGAGEMENT_ANSWER_CONTRACT });
      return definition!.id;
    });
  } finally { await client.sql.end({ timeout: 2 }); }
}

export function parsePrepareReportEngagementDefinitionConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env['DATABASE_URL']; const tenantId = env['TENANT_ID']; const sourceDefinitionId = env['SOURCE_SURVEY_DEFINITION_ID'];
  if (!databaseUrl || !tenantId || !sourceDefinitionId || env['CONFIRM_ENGAGEMENT_DEFINITION_PREPARE'] !== tenantId) throw new Error('explicit_database_tenant_source_confirmation_required');
  return { databaseUrl, tenantId, sourceDefinitionId };
}
if (require.main === module) {
  const config = parsePrepareReportEngagementDefinitionConfig(process.env);
  prepareReportEngagementDefinition(config.databaseUrl, config.tenantId, config.sourceDefinitionId).then((id) => console.log(JSON.stringify({ definitionId: id }))).catch(() => { console.error('engagement_definition_preparation_failed'); process.exitCode = 1; });
}
