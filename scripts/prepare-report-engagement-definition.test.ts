import assert from 'node:assert/strict';
import { parsePrepareReportEngagementDefinitionConfig } from './prepare-report-engagement-definition';
const tenant='00000000-0000-4000-8000-000000000001',source='00000000-0000-4000-8000-000000000002';
const env={DATABASE_URL:'postgresql://fixture.invalid/db',TENANT_ID:tenant,SOURCE_SURVEY_DEFINITION_ID:source,CONFIRM_ENGAGEMENT_DEFINITION_PREPARE:tenant};
assert.deepEqual(parsePrepareReportEngagementDefinitionConfig(env),{ databaseUrl:env.DATABASE_URL,tenantId:tenant,sourceDefinitionId:source });
for (const key of Object.keys(env)) assert.throws(()=>parsePrepareReportEngagementDefinitionConfig({...env,[key]:''}),/explicit_database_tenant_source_confirmation_required/);
assert.throws(()=>parsePrepareReportEngagementDefinitionConfig({...env,CONFIRM_ENGAGEMENT_DEFINITION_PREPARE:source}));
console.log('prepare-report-engagement-definition config checks passed');
