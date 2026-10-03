import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  auditLogs, conversations, createDbClient, memoryItems, messages, riskSignals,
  surveyAssessments, surveyDefinitions, surveyEvidence,
  surveyQuestionConfirmationBundles, surveyQuestionInsights,
  surveyQuestionWorkingInsights, surveyQuestions, surveyScoringPolicies,
  surveyWindowScoringPolicies, surveyWindows, tenants, users,
} from '@entalent/database';
import { RetentionRepository } from './retention.repository';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('V2 temporary retention on migrated PostgreSQL', () => {
  it('purges only aged tenant-owned private content and stays idempotent', async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port) {
      throw new Error('isolated_postgres_required');
    }
    const client = createDbClient(databaseUrl!);
    const db = client.db;
    const tenantIds: string[] = [];
    try {
      const [tenant, otherTenant] = await db.insert(tenants).values([
        { name: `V2 retention ${randomUUID()}` },
        { name: `V2 retention other ${randomUUID()}` },
      ]).returning();
      tenantIds.push(tenant!.id, otherTenant!.id);
      const [user, otherUser] = await db.insert(users).values([
        { tenantId: tenant!.id }, { tenantId: otherTenant!.id },
      ]).returning();
      const [definition, otherDefinition] = await db.insert(surveyDefinitions).values([
        { tenantId: tenant!.id, name: 'Retention V2', version: randomUUID() },
        { tenantId: otherTenant!.id, name: 'Retention V2', version: randomUUID() },
      ]).returning();
      const [oldQuestion, youngQuestion, foreignQuestion, plainQuestion] = await db.insert(surveyQuestions).values([
        { surveyDefinitionId: definition!.id, stableKey: 'retention_old', title: 'Old',
          canonicalMeaning: 'Old', dimension: 'autonomy' },
        { surveyDefinitionId: definition!.id, stableKey: 'retention_young', title: 'Young',
          canonicalMeaning: 'Young', dimension: 'growth', questionGroup: 'growth' },
        { surveyDefinitionId: otherDefinition!.id, stableKey: 'retention_foreign', title: 'Foreign',
          canonicalMeaning: 'Foreign', dimension: 'autonomy' },
        { surveyDefinitionId: definition!.id, stableKey: 'retention_plain', title: 'Plain',
          canonicalMeaning: 'Plain', dimension: 'purpose', questionGroup: 'purpose' },
      ]).returning();
      const periodStart = new Date('2026-09-01T00:00:00Z');
      const periodEnd = new Date('2026-12-31T00:00:00Z');
      const [window, foreignWindow] = await db.insert(surveyWindows).values([
        { tenantId: tenant!.id, userId: user!.id, surveyDefinitionId: definition!.id,
          periodStart, periodEnd },
        { tenantId: otherTenant!.id, userId: otherUser!.id,
          surveyDefinitionId: otherDefinition!.id, periodStart, periodEnd },
      ]).returning();
      const [policy, foreignPolicy] = await db.insert(surveyScoringPolicies).values([
        { tenantId: tenant!.id, version: 'retention-policy', rubrics: {}, approvedAt: periodStart },
        { tenantId: otherTenant!.id, version: 'retention-policy', rubrics: {},
          approvedAt: periodStart },
      ]).returning();
      await db.insert(surveyWindowScoringPolicies).values([
        { tenantId: tenant!.id, surveyWindowId: window!.id, scoringPolicyId: policy!.id },
        { tenantId: otherTenant!.id, surveyWindowId: foreignWindow!.id,
          scoringPolicyId: foreignPolicy!.id },
      ]);
      const oldDate = new Date('2026-10-01T00:00:00Z');
      const youngDate = new Date('2026-10-21T00:00:00Z');
      const withdrawnAt = new Date('2026-10-20T00:00:00Z');
      const [conversation, otherConversation] = await db.insert(conversations).values([
        { tenantId: tenant!.id, userId: user!.id, channelType: 'dev',
          externalConversationId: `retention-${randomUUID()}` },
        { tenantId: otherTenant!.id, userId: otherUser!.id, channelType: 'dev',
          externalConversationId: `retention-${randomUUID()}` },
      ]).returning();
      const [oldMessage, youngMessage, foreignMessage] = await db.insert(messages).values([
        { tenantId: tenant!.id, userId: user!.id, conversationId: conversation!.id,
          direction: 'inbound', senderType: 'user', text: 'Private old message',
          normalizedText: 'Private normalized message', metadata: { private: 'old' },
          occurredAt: oldDate },
        { tenantId: tenant!.id, userId: user!.id, conversationId: conversation!.id,
          direction: 'inbound', senderType: 'user', text: 'Private young message',
          occurredAt: youngDate },
        { tenantId: otherTenant!.id, userId: otherUser!.id,
          conversationId: otherConversation!.id, direction: 'inbound', senderType: 'user',
          text: 'Private foreign message', occurredAt: oldDate },
      ]).returning();
      const [oldMemory] = await db.insert(memoryItems).values({
        tenantId: tenant!.id, userId: user!.id, category: 'work',
        canonicalKey: 'private-key', content: 'Private memory',
        structuredValue: { private: 'memory' }, sourceMessageIds: [oldMessage!.id],
        createdAt: oldDate,
      }).returning();
      const [oldEvidence] = await db.insert(surveyEvidence).values({
        surveyWindowId: window!.id, surveyQuestionId: oldQuestion!.id,
        userId: user!.id, sourceMessageIds: [oldMessage!.id],
        evidenceSummary: 'Private evidence', polarity: 'positive', strength: '0.8',
        completeness: '0.8', confidence: '0.8', evaluatorVersion: 'fixture',
        promptVersion: 'fixture', createdAt: oldDate,
      }).returning();
      const [oldAssessment] = await db.insert(surveyAssessments).values({
        surveyWindowId: window!.id, surveyQuestionId: oldQuestion!.id,
        score: '8', confidence: '0.8', status: 'scored',
        reasoningSummary: 'Private reasoning', evidenceIds: [oldEvidence!.id],
        evaluatorVersion: 'fixture', calculatedAt: oldDate,
      }).returning();
      const [oldRisk] = await db.insert(riskSignals).values({
        tenantId: tenant!.id, userId: user!.id, sourceMessageId: oldMessage!.id,
        type: 'burnout', severity: 'medium', confidence: '0.8',
        evidenceMessageIds: [oldMessage!.id], recommendedAction: 'Private action',
        detectedAt: oldDate,
      }).returning();
      const finalBase = {
        questionVersion: oldQuestion!.version, deidentifiedSummary: 'Safe summary',
        score: '50', signalDirection: 'mixed', signalSeverity: 'moderate',
        rootCauseCategory: 'other', scoringPolicyVersion: 'retention-policy',
        questionRubricVersion: 'rubric-v1', modelId: 'fixture-model',
        promptVersion: 'fixture-prompt', confidence: '0.9',
        privacyPolicyVersion: 'fixture-privacy', confirmedAt: oldDate,
        scoredAt: oldDate,
      } as const;
      const [oldFinal, youngFinal, foreignFinal, plainFinal] = await db.insert(surveyQuestionInsights)
        .values([
          { ...finalBase, tenantId: tenant!.id, userId: user!.id,
            surveyWindowId: window!.id, surveyDefinitionId: definition!.id,
            surveyQuestionId: oldQuestion!.id, questionGroup: 'autonomy',
            processedAt: oldDate, withdrawnAt },
          { ...finalBase, tenantId: tenant!.id, userId: user!.id,
            surveyWindowId: window!.id, surveyDefinitionId: definition!.id,
            surveyQuestionId: youngQuestion!.id, questionGroup: 'growth',
            processedAt: youngDate },
          { ...finalBase, tenantId: otherTenant!.id, userId: otherUser!.id,
            surveyWindowId: foreignWindow!.id, surveyDefinitionId: otherDefinition!.id,
            surveyQuestionId: foreignQuestion!.id, questionGroup: 'autonomy',
            processedAt: oldDate },
          { ...finalBase, tenantId: tenant!.id, userId: user!.id,
            surveyWindowId: window!.id, surveyDefinitionId: definition!.id,
            surveyQuestionId: plainQuestion!.id, questionGroup: 'purpose',
            processedAt: oldDate },
        ]).returning();
      const [oldBundle, youngBundle, foreignBundle] = await db.insert(surveyQuestionConfirmationBundles)
        .values([
          { tenantId: tenant!.id, userId: user!.id, surveyWindowId: window!.id,
            questionGroup: 'autonomy', version: 'old', displayedText: 'Private old Bundle',
            components: { private: 'old' }, status: 'awaiting_confirmation', createdAt: oldDate },
          { tenantId: tenant!.id, userId: user!.id, surveyWindowId: window!.id,
            questionGroup: 'growth', version: 'young', displayedText: 'Private young Bundle',
            components: { private: 'young' }, status: 'awaiting_confirmation', createdAt: youngDate },
          { tenantId: otherTenant!.id, userId: otherUser!.id, surveyWindowId: foreignWindow!.id,
            questionGroup: 'autonomy', version: 'foreign', displayedText: 'Private foreign Bundle',
            components: { private: 'foreign' }, status: 'awaiting_confirmation', createdAt: oldDate },
        ]).returning();
      const [oldWorking, youngWorking, foreignWorking] = await db.insert(surveyQuestionWorkingInsights)
        .values([
          { tenantId: tenant!.id, userId: user!.id, surveyWindowId: window!.id,
            surveyQuestionId: oldQuestion!.id, questionVersion: oldQuestion!.version,
            status: 'pending_confirmation', readyForConfirmation: true,
            workingSummary: 'Private old meaning', sourceMessageIds: [randomUUID()],
            confirmationBundleId: oldBundle!.id, createdAt: oldDate },
          { tenantId: tenant!.id, userId: user!.id, surveyWindowId: window!.id,
            surveyQuestionId: youngQuestion!.id, questionVersion: youngQuestion!.version,
            status: 'pending_confirmation', readyForConfirmation: true,
            workingSummary: 'Private young meaning', sourceMessageIds: [randomUUID()],
            confirmationBundleId: youngBundle!.id, createdAt: youngDate },
          { tenantId: otherTenant!.id, userId: otherUser!.id,
            surveyWindowId: foreignWindow!.id, surveyQuestionId: foreignQuestion!.id,
            questionVersion: foreignQuestion!.version, status: 'pending_confirmation',
            readyForConfirmation: true, workingSummary: 'Private foreign meaning',
            sourceMessageIds: [randomUUID()], confirmationBundleId: foreignBundle!.id,
            createdAt: oldDate },
        ]).returning();
      const repository = new RetentionRepository({ client: db } as never, tenant!.id);
      const params = {
        tenantId: tenant!.id, now: new Date('2026-10-31T00:00:00Z'),
        messagesCutoff: new Date('2026-10-11T00:00:00Z'),
        memoryCutoff: new Date('2026-10-11T00:00:00Z'),
        riskSignalCutoff: new Date('2026-10-11T00:00:00Z'),
        auditLogCutoff: new Date('2026-08-01T00:00:00Z'),
      };
      const first = await repository.applyRetention(params);
      expect(first.workingQuestionInsightsExpired).toBe(1);
      expect(first.questionBundlesExpired).toBe(1);
      expect(first.questionInsightsDeleted).toBe(2);
      expect(first.messagesDeleted).toBe(1);
      expect(first.memoryItemsExpired).toBe(1);
      expect(first.surveyEvidenceExpired).toBe(1);
      expect(first.surveyAssessmentsExpired).toBe(1);
      expect(first.riskSignalsExpired).toBe(1);
      const second = await repository.applyRetention(params);
      expect(second.workingQuestionInsightsExpired).toBe(0);
      expect(second.questionBundlesExpired).toBe(0);
      expect(second.questionInsightsDeleted).toBe(0);
      expect(second.messagesDeleted).toBe(0);
      expect(second.memoryItemsExpired).toBe(0);
      expect(second.surveyEvidenceExpired).toBe(0);
      expect(second.surveyAssessmentsExpired).toBe(0);
      expect(second.riskSignalsExpired).toBe(0);
      const [expiredMessage] = await db.select().from(messages)
        .where(eq(messages.id, oldMessage!.id));
      expect(expiredMessage).toMatchObject({ text: '[deleted]', normalizedText: null,
        metadata: {}, deletedAt: params.now });
      for (const id of [youngMessage!.id, foreignMessage!.id]) {
        const [row] = await db.select().from(messages).where(eq(messages.id, id));
        expect(row?.text).toMatch(/^Private /);
      }
      const [expiredMemory] = await db.select().from(memoryItems)
        .where(eq(memoryItems.id, oldMemory!.id));
      expect(expiredMemory).toMatchObject({ status: 'deleted', content: '[deleted]',
        canonicalKey: null, structuredValue: null, sourceMessageIds: [] });
      const [expiredEvidence] = await db.select().from(surveyEvidence)
        .where(eq(surveyEvidence.id, oldEvidence!.id));
      expect(expiredEvidence).toMatchObject({ evidenceSummary: '[deleted]',
        sourceMessageIds: [], supersededAt: params.now });
      const [expiredAssessment] = await db.select().from(surveyAssessments)
        .where(eq(surveyAssessments.id, oldAssessment!.id));
      expect(expiredAssessment).toMatchObject({ status: 'suppressed', score: null,
        reasoningSummary: null, evidenceIds: [] });
      const [expiredRisk] = await db.select().from(riskSignals)
        .where(eq(riskSignals.id, oldRisk!.id));
      expect(expiredRisk).toMatchObject({ status: 'expired', recommendedAction: null });
      expect(await db.select().from(surveyQuestionInsights)
        .where(eq(surveyQuestionInsights.id, oldFinal!.id))).toHaveLength(0);
      expect(await db.select().from(surveyQuestionInsights)
        .where(eq(surveyQuestionInsights.id, plainFinal!.id))).toHaveLength(0);
      for (const id of [youngFinal!.id, foreignFinal!.id]) {
        expect(await db.select().from(surveyQuestionInsights)
          .where(eq(surveyQuestionInsights.id, id))).toHaveLength(1);
      }
      const withdrawalAudit = await db.select().from(auditLogs)
        .where(eq(auditLogs.idempotencyKey, `v2-retention-withdrawal:${oldFinal!.id}`));
      expect(withdrawalAudit).toHaveLength(1);
      expect(withdrawalAudit[0]).toMatchObject({ tenantId: tenant!.id,
        resourceId: oldFinal!.id, createdAt: withdrawnAt });
      expect(JSON.stringify(withdrawalAudit[0]?.metadata)).not.toContain('Safe summary');
      expect(await db.select().from(auditLogs)
        .where(eq(auditLogs.idempotencyKey, `v2-retention-withdrawal:${plainFinal!.id}`)))
        .toHaveLength(0);
      const afterAuditCutoff = await repository.applyRetention({
        ...params, auditLogCutoff: new Date('2026-10-25T00:00:00Z'),
      });
      expect(afterAuditCutoff.auditLogsDeleted).toBe(1);
      expect(await db.select().from(auditLogs)
        .where(eq(auditLogs.idempotencyKey, `v2-retention-withdrawal:${oldFinal!.id}`)))
        .toHaveLength(0);
      const [expiredWorking] = await db.select().from(surveyQuestionWorkingInsights)
        .where(eq(surveyQuestionWorkingInsights.id, oldWorking!.id));
      expect(expiredWorking).toMatchObject({ status: 'no_data', readyForConfirmation: false,
        workingSummary: null, confirmedSemanticSummary: null, sourceMessageIds: [],
        confirmationBundleId: null });
      expect(expiredWorking?.purgedAt).toEqual(params.now);
      const [expiredBundle] = await db.select().from(surveyQuestionConfirmationBundles)
        .where(eq(surveyQuestionConfirmationBundles.id, oldBundle!.id));
      expect(expiredBundle).toMatchObject({ status: 'purged', displayedText: null, components: null });
      for (const id of [youngWorking!.id, foreignWorking!.id]) {
        const [row] = await db.select().from(surveyQuestionWorkingInsights)
          .where(eq(surveyQuestionWorkingInsights.id, id));
        expect(row?.workingSummary).toMatch(/^Private /);
      }
      for (const id of [youngBundle!.id, foreignBundle!.id]) {
        const [row] = await db.select().from(surveyQuestionConfirmationBundles)
          .where(eq(surveyQuestionConfirmationBundles.id, id));
        expect(row?.displayedText).toMatch(/^Private /);
      }
    } finally {
      for (const tenantId of tenantIds) {
        await db.delete(tenants).where(eq(tenants.id, tenantId));
      }
      await client.sql.end({ timeout: 2 });
    }
  });
});
