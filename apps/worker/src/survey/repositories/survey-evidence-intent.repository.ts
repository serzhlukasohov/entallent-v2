import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  conversationDispatchIntents, conversationJobAdmissions, conversationTurnEffects,
  conversations, messages,
} from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

interface EvidenceIntentSource {
  inboundMessageId: string;
  conversationId: string;
  tenantId: string;
  userId: string;
}

@Injectable()
export class SurveyEvidenceIntentRepository {
  constructor(private readonly db: DatabaseService) {}

  async status(input: EvidenceIntentSource): Promise<'legacy' | 'pending' | 'complete'> {
    const intent = await this.findIntent(input, false);
    if (intent) return intent.completedAt ? 'complete' : 'pending';
    const [other] = await this.db.client.select({ id: conversationDispatchIntents.id })
      .from(conversationDispatchIntents).where(sql`
        ${conversationDispatchIntents.inboundMessageId} = ${input.inboundMessageId}::uuid
        and ${conversationDispatchIntents.kind} = 'survey_evidence'`)
      .limit(1);
    if (other) throw new Error('survey_evidence_intent_scope_mismatch');
    return 'legacy';
  }

  async complete(input: EvidenceIntentSource, apply: () => Promise<void>): Promise<boolean> {
    return this.db.withTransaction(async () => {
      const intent = await this.findIntent(input, true);
      if (!intent) throw new Error('survey_evidence_intent_scope_mismatch');
      if (intent.completedAt) return false;
      await apply();
      const completedAt = new Date();
      await this.db.client.update(conversationDispatchIntents).set({
        lastQueuedAt: sql`coalesce(${conversationDispatchIntents.lastQueuedAt}, ${completedAt.toISOString()}::timestamptz)`,
        completedAt,
      }).where(eq(conversationDispatchIntents.id, intent.id));
      return true;
    });
  }

  private async findIntent(input: EvidenceIntentSource, lock: boolean): Promise<{
    id: string; completedAt: Date | null;
  } | null> {
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
        and intent.kind = 'survey_evidence' and intent.target_id = effect.inbound_message_id
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
}
