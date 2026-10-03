import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, messages, userStyleProfiles,
} from '@entalent/database';
import type {
  CommittedStyleAnalysisInput, CommittedStyleProfileRepositoryPort,
  StyleProfileRecord, StyleDimensions, StylePhrase,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class StyleProfileRepository implements CommittedStyleProfileRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async isCommittedStyleAnalysisComplete(input: CommittedStyleAnalysisInput): Promise<boolean> {
    const intent = await this.findCommittedStyleIntent(input, false);
    if (!intent) throw new Error('style_analysis_intent_scope_mismatch');
    return intent.completedAt !== null;
  }

  async completeCommittedStyleAnalysis(
    input: CommittedStyleAnalysisInput,
    update: ((current: StyleProfileRecord | null) => StyleProfileRecord) | null,
  ): Promise<void> {
    await this.db.withTransaction(async () => {
      await this.db.client.execute(sql`select pg_advisory_xact_lock(
        hashtextextended(${`${input.tenantId}:${input.userId}`}, 0))`);
      const intent = await this.findCommittedStyleIntent(input, true);
      if (!intent) throw new Error('style_analysis_intent_scope_mismatch');
      if (intent.completedAt !== null) return;
      if (update && !(await this.hasNewerCompletedStyleAnalysis(input))) {
        const profile = update(await this.findByUser(input.userId, input.tenantId));
        if (profile.userId !== input.userId || profile.tenantId !== input.tenantId) {
          throw new Error('style_analysis_profile_scope_mismatch');
        }
        await this.upsert(profile);
      }
      await this.db.client.update(conversationDispatchIntents)
        .set({ completedAt: new Date() })
        .where(eq(conversationDispatchIntents.id, intent.id));
    });
  }

  private async hasNewerCompletedStyleAnalysis(input: CommittedStyleAnalysisInput): Promise<boolean> {
    const rows = await this.db.client.execute(sql`select 1
      from ${messages} source
      join ${conversationTurnEffects} later_effect
        on later_effect.tenant_id = ${input.tenantId}::uuid
        and later_effect.user_id = ${input.userId}::uuid
      join ${conversationDispatchIntents} later_intent
        on later_intent.inbound_message_id = later_effect.inbound_message_id
        and later_intent.kind = 'style_analysis'
        and later_intent.completed_at is not null
      join ${messages} later_source
        on later_source.id = later_effect.inbound_message_id
        and later_source.tenant_id = later_effect.tenant_id
        and later_source.user_id = later_effect.user_id
        and later_source.direction = 'inbound'
      where source.id = ${input.inboundMessageId}::uuid
        and source.tenant_id = ${input.tenantId}::uuid
        and source.user_id = ${input.userId}::uuid
        and (later_source.occurred_at,
          coalesce(later_source.external_message_id, later_source.id::text)) >
          (source.occurred_at, coalesce(source.external_message_id, source.id::text))
      limit 1`);
    return rows.length > 0;
  }

  private async findCommittedStyleIntent(
    input: CommittedStyleAnalysisInput,
    lock: boolean,
  ): Promise<{ id: string; completedAt: Date | null } | null> {
    const rows = await this.db.client.execute(sql`select intent.id, intent.completed_at
      from ${conversationDispatchIntents} intent
      join ${conversationTurnEffects} effect on effect.inbound_message_id = intent.inbound_message_id
      join ${conversationJobAdmissions} admission on admission.message_id = effect.inbound_message_id
        and admission.tenant_id = effect.tenant_id and admission.user_id = effect.user_id
        and admission.conversation_id = effect.conversation_id
      join ${conversations} owner on owner.id = effect.conversation_id
        and owner.tenant_id = effect.tenant_id and owner.user_id = effect.user_id
        and owner.external_conversation_id = admission.external_conversation_id
      join ${messages} inbound on inbound.id = effect.inbound_message_id
        and inbound.tenant_id = effect.tenant_id and inbound.user_id = effect.user_id
        and inbound.conversation_id = effect.conversation_id
        and inbound.direction = 'inbound' and inbound.deleted_at is null
      where intent.inbound_message_id = ${input.inboundMessageId}::uuid
        and intent.kind = 'style_analysis' and intent.target_id = effect.inbound_message_id
        and effect.tenant_id = ${input.tenantId}::uuid
        and effect.user_id = ${input.userId}::uuid
        and effect.conversation_id = ${input.conversationId}::uuid
      limit 1
      ${lock ? sql`for update of intent` : sql``}`);
    const row = rows[0];
    return row ? {
      id: String(row['id']),
      completedAt: row['completed_at'] ? new Date(String(row['completed_at'])) : null,
    } : null;
  }

  async findByUser(userId: string, tenantId: string): Promise<StyleProfileRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(userStyleProfiles)
      .where(and(eq(userStyleProfiles.userId, userId), eq(userStyleProfiles.tenantId, tenantId)))
      .limit(1);
    return row ? map(row) : null;
  }

  async upsert(p: StyleProfileRecord): Promise<StyleProfileRecord> {
    const [row] = await this.db.client
      .insert(userStyleProfiles)
      .values({
        userId: p.userId,
        tenantId: p.tenantId,
        dimensions: p.dimensions as never,
        phrases: p.phrases as never,
        adaptationWeight: String(p.adaptationWeight),
        conversationsAnalyzed: p.conversationsAnalyzed,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userStyleProfiles.userId, userStyleProfiles.tenantId],
        set: {
          dimensions: p.dimensions as never,
          phrases: p.phrases as never,
          adaptationWeight: String(p.adaptationWeight),
          conversationsAnalyzed: p.conversationsAnalyzed,
          updatedAt: new Date(),
        },
      })
      .returning();
    return map(row);
  }
}

function map(row: typeof userStyleProfiles.$inferSelect): StyleProfileRecord {
  return {
    userId: row.userId,
    tenantId: row.tenantId,
    dimensions: row.dimensions as StyleDimensions,
    phrases: row.phrases as StylePhrase[],
    adaptationWeight: Number(row.adaptationWeight),
    conversationsAnalyzed: row.conversationsAnalyzed,
    updatedAt: row.updatedAt,
  };
}
