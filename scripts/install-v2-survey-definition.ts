import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { createDbClient, surveyDefinitions, surveyQuestions } from '@entalent/database';
import { hasCompleteV2ScoringPolicy } from '@entalent/application';

const VERSION = 'v2-policy-1.0.0';
const POLICY_FILE = resolve('scripts/data/v2-scoring-policy-1.0.0.json');

export async function installV2SurveyDefinition(databaseUrl: string, tenantId: string): Promise<string> {
  const policy: unknown = JSON.parse(await readFile(POLICY_FILE, 'utf8'));
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('approved_v2_policy_invalid');
  const entries = Object.entries(policy as Record<string, Record<string, unknown>>);
  const questions = entries.map(([stableKey, rubric], displayOrder) => ({
    stableKey,
    title: rubric['title'] as string,
    canonicalMeaning: rubric['canonicalMeaning'] as string,
    questionGroup: rubric['questionGroup'] as string,
    responseType: 'open_ended',
    version: rubric['version'] as string,
    dimension: rubric['questionGroup'] as string,
    displayOrder,
  }));
  if (!hasCompleteV2ScoringPolicy(questions, policy)) throw new Error('approved_v2_policy_invalid');
  const client = createDbClient(databaseUrl);
  try {
    return await client.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(surveyDefinitions).where(and(
        eq(surveyDefinitions.tenantId, tenantId), eq(surveyDefinitions.version, VERSION),
      )).limit(1);
      if (existing) {
        const rows = await tx.select({
          stableKey: surveyQuestions.stableKey, title: surveyQuestions.title,
          canonicalMeaning: surveyQuestions.canonicalMeaning,
          questionGroup: surveyQuestions.questionGroup, responseType: surveyQuestions.responseType,
          version: surveyQuestions.version,
        }).from(surveyQuestions).where(eq(surveyQuestions.surveyDefinitionId, existing.id));
        if (existing.active || !hasCompleteV2ScoringPolicy(rows, policy)) {
          throw new Error('existing_v2_definition_mismatch');
        }
        return existing.id;
      }
      const [definition] = await tx.insert(surveyDefinitions).values({
        tenantId, name: 'Insight Analysis V2 1.0.0', version: VERSION, active: false,
        configuration: { scoringPolicyVersion: '1.0.0' },
      }).returning({ id: surveyDefinitions.id });
      if (!definition) throw new Error('v2_definition_insert_failed');
      await tx.insert(surveyQuestions).values(questions.map((question) => ({
        ...question, surveyDefinitionId: definition.id,
      })));
      return definition.id;
    });
  } finally {
    await client.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

if (require.main === module) {
  const url = process.env['DATABASE_URL'];
  const tenantId = process.env['TENANT_ID'];
  if (!url || !tenantId || process.env['CONFIRM_V2_DEFINITION_INSTALL'] !== tenantId) {
    throw new Error('DATABASE_URL, TENANT_ID and matching CONFIRM_V2_DEFINITION_INSTALL are required');
  }
  installV2SurveyDefinition(url, tenantId)
    .then((id) => console.log(JSON.stringify({ definitionId: id, active: false })))
    .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
