import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { pulseInputRows, pulsePublicationHash, type PulseReportExecutor } from '@entalent/database';
import type {
  PulseRecipientBinding,
  PulseRecipientCandidate,
  PulseBindingProof,
} from '@entalent/contracts';
import { DatabaseService } from '../../database/database.service';
/** Current exact-scope ownership is authority; opening_owner_person_id is audit only. */
@Injectable()
export class PulseReportRecipientRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly decode: (encrypted: string) => string,
  ) {}
  async resolve(
    tenantId: string,
    scopeId: string,
    tx: PulseReportExecutor = this.db.client,
  ): Promise<PulseRecipientCandidate | null> {
    const rows = await pulseInputRows(
      tx,
      sql`select s.id scope_id,p.id person_id,u.id user_id,a.id account_id,a.binding_revision account_revision,w.id workspace_connection_id,w.binding_revision workspace_revision,a.external_workspace_id workspace_id,a.external_user_id slack_user_id
  from survey_report_scopes s join org_units unit on unit.id=s.org_unit_id and unit.tenant_id=s.tenant_id and unit.lifecycle_status='active'
  left join org_teams team on team.id=s.org_team_id and team.unit_id=unit.id and team.tenant_id=s.tenant_id and team.lifecycle_status='active'
  join people p on p.tenant_id=s.tenant_id and p.id=case when s.kind='team' then team.team_lead_person_id else unit.manager_person_id end and p.lifecycle_status='active' and p.primary_role=case when s.kind='team' then 'team_lead' else 'manager' end
  join users u on u.id=p.id and u.tenant_id=p.tenant_id and u.deleted_at is null and u.status<>'deleted'
  join channel_accounts a on a.user_id=u.id and a.tenant_id=s.tenant_id and a.channel_type='slack' and a.link_status='linked'
  join workspace_connections w on w.tenant_id=a.tenant_id and w.channel_type='slack' and w.external_workspace_id=a.external_workspace_id and w.status='active'
  where s.id=${scopeId}::uuid and s.tenant_id=${tenantId}::uuid`,
    );
    if (rows.length !== 1) return null;
    const r = rows[0]!;
    return {
      tenantId,
      scopeId,
      personId: String(r.person_id),
      userId: String(r.user_id),
      accountId: String(r.account_id),
      accountRevision: Number(r.account_revision),
      workspaceConnectionId: String(r.workspace_connection_id),
      workspaceRevision: Number(r.workspace_revision),
      workspaceId: String(r.workspace_id),
      slackUserId: String(r.slack_user_id),
    };
  }
  async credential(
    candidate: PulseRecipientCandidate,
    tx: PulseReportExecutor = this.db.client,
  ): Promise<string | null> {
    const [row] = await pulseInputRows(
      tx,
      sql`select encrypted_credentials from workspace_connections where id=${candidate.workspaceConnectionId}::uuid and tenant_id=${candidate.tenantId}::uuid and binding_revision=${candidate.workspaceRevision} and status='active' and external_workspace_id=${candidate.workspaceId}`,
    );
    if (!row) return null;
    try {
      return this.decode(String(row.encrypted_credentials));
    } catch {
      return null;
    }
  }
  async verify(
    candidate: PulseRecipientCandidate,
    proof: PulseBindingProof,
  ): Promise<PulseRecipientBinding | null> {
    if (
      !proof.privateDm ||
      proof.workspaceId !== candidate.workspaceId ||
      proof.slackUserId !== candidate.slackUserId ||
      !proof.channelId ||
      !proof.botUserId
    )
      return null;
    return this.db.client.transaction(async (tx) => {
      await this.lockAuthority(tx, candidate);
      const fresh = await this.resolve(candidate.tenantId, candidate.scopeId, tx);
      if (pulsePublicationHash(fresh) !== pulsePublicationHash(candidate)) return null;
      const binding = { ...candidate, channelId: proof.channelId, botUserId: proof.botUserId };
      const [row] = await pulseInputRows(
        tx,
        sql`insert into survey_report_recipient_proofs(tenant_id,scope_id,binding,expires_at) values(${candidate.tenantId}::uuid,${candidate.scopeId}::uuid,${JSON.stringify(binding)}::jsonb,clock_timestamp()+interval '1 day') returning id`,
      );
      return { ...binding, proofId: String(row!.id) };
    });
  }
  /** NOWAIT on every reversed-order row: hierarchy writers hold these before subjects. */
  async lockAuthority(tx: PulseReportExecutor, candidate: PulseRecipientCandidate): Promise<void> {
    const t = candidate.tenantId;
    await tx.execute(sql`select id from tenants where id=${t}::uuid for update nowait`);
    await tx.execute(
      sql`select unit.id from org_units unit join survey_report_scopes s on s.org_unit_id=unit.id and s.tenant_id=unit.tenant_id where s.id=${candidate.scopeId}::uuid and s.tenant_id=${t}::uuid for update of unit nowait`,
    );
    await tx.execute(
      sql`select team.id from org_teams team join survey_report_scopes s on s.org_team_id=team.id and s.tenant_id=team.tenant_id where s.id=${candidate.scopeId}::uuid and s.tenant_id=${t}::uuid for update of team nowait`,
    );
    await tx.execute(
      sql`select id from people where id=${candidate.personId}::uuid and tenant_id=${t}::uuid for update nowait`,
    );
    await tx.execute(
      sql`select id from users where id=${candidate.userId}::uuid and tenant_id=${t}::uuid for update nowait`,
    );
    await tx.execute(
      sql`select id from channel_accounts where id=${candidate.accountId}::uuid and tenant_id=${t}::uuid for update nowait`,
    );
    await tx.execute(
      sql`select id from workspace_connections where id=${candidate.workspaceConnectionId}::uuid and tenant_id=${t}::uuid for update nowait`,
    );
  }
  async validate(tx: PulseReportExecutor, binding: PulseRecipientBinding): Promise<boolean> {
    await this.lockAuthority(tx, binding);
    const fresh = await this.resolve(binding.tenantId, binding.scopeId, tx);
    if (!fresh) return false;
    const { proofId, channelId, botUserId, ...candidate } = binding;
    if (pulsePublicationHash(fresh) !== pulsePublicationHash(candidate)) return false;
    const [proof] = await pulseInputRows(
      tx,
      sql`select binding from survey_report_recipient_proofs where id=${proofId}::uuid and tenant_id=${binding.tenantId}::uuid and scope_id=${binding.scopeId}::uuid and expires_at>clock_timestamp() for update nowait`,
    );
    return Boolean(
      proof &&
      pulsePublicationHash(proof.binding) ===
        pulsePublicationHash({ ...candidate, channelId, botUserId }),
    );
  }
}
