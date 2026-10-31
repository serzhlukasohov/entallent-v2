import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { pulseInputRows, type PulseReportExecutor } from '@entalent/database';
import {
  decidePulseReportActivation,
  normalizePulseReportActivationChange,
  validatePulseReportActivationChange,
  type PulseReportActivationChange,
  type PulseReportActivationChangeResult,
  type PulseReportActivationControl,
  type PulseReportActivationDecision,
  type PulseReportActivationMode,
  type PulseReportActivationPort,
  type PulseReportActivationScope,
  type PulseReportActivationScopeKind,
  type PulseReportActivationState,
} from '@entalent/application';
import type { PulseRecipientBinding } from '@entalent/contracts';
import { DatabaseService } from '../../database/database.service';
import type { PulseLifecycleScopeFilter } from './pulse-report-lifecycle.repository';
import type { PulseDeliveryActivationGuard } from './pulse-report-delivery.repository';

export interface PulseReportActivationJobDecision {
  decision: PulseReportActivationDecision;
  snapshotId: string | null;
}
export interface PulseReportHeldSnapshot {
  obligationId: string;
  snapshotId: string;
  scopeId: string;
  kind: string;
  status: string;
  holdReason: PulseReportActivationDecision['holdReason'];
}

/** RPT-10 activation controls. Reads are fail-closed; writes only via `change` (operator script). */
@Injectable()
export class PulseReportActivationRepository implements PulseReportActivationPort {
  constructor(private readonly db: DatabaseService) {}

  /** Discovery/repair page predicate: tenant observe|deliver, unexpired by DB clock, scope allowlisted. */
  readonly scopeFilter: PulseLifecycleScopeFilter = (scope: SQL) =>
    sql`exists(select 1 from pulse_report_activation_controls ac join pulse_report_activation_scopes acs on acs.tenant_id=ac.tenant_id where ac.tenant_id=${scope}.tenant_id and ac.mode in ('observe','deliver') and (ac.expires_at is null or ac.expires_at>clock_timestamp()) and acs.org_unit_id=${scope}.org_unit_id and acs.kind=${scope}.kind and acs.org_team_id is not distinct from ${scope}.org_team_id)`;

  /**
   * Per-job decision from the control, the obligation's durable scope and the current live snapshot's frozen
   * route (unique per obligation; purged or expired snapshots count as missing). Read-only. `route` overrides the
   * stored route with the artifact actually being dispatched.
   */
  async decide(
    tenantId: string,
    obligationId: string,
    tx: PulseReportExecutor = this.db.client,
    route?: Pick<PulseRecipientBinding, 'personId' | 'scopeId'>,
  ): Promise<PulseReportActivationJobDecision> {
    const [row] = await pulseInputRows(
      tx,
      sql`select clock_timestamp() now,o.scope_id,c.mode,c.expires_at,a.id activation_scope_id,a.approved_recipient_person_id,sn.id snapshot_id,sn.route_person_id,sn.route_scope_id,coalesce(sn.delivered_parts,0) delivered_parts
  from survey_report_obligations o join survey_report_scopes s on s.id=o.scope_id and s.tenant_id=o.tenant_id
  left join pulse_report_activation_controls c on c.tenant_id=o.tenant_id
  left join pulse_report_activation_scopes a on a.tenant_id=o.tenant_id and a.org_unit_id=s.org_unit_id and a.kind=s.kind and a.org_team_id is not distinct from s.org_team_id
  left join lateral (select x.id,p.route->>'personId' route_person_id,p.route->>'scopeId' route_scope_id,(select count(*)::int from survey_report_receipts r where r.snapshot_id=x.id and r.tenant_id=x.tenant_id) delivered_parts
    from survey_report_native_snapshots x join survey_report_snapshot_payloads p on p.snapshot_id=x.id and p.tenant_id=x.tenant_id
    where x.obligation_id=o.id and x.tenant_id=o.tenant_id and x.purged_at is null and x.expires_at>clock_timestamp() order by x.created_at desc,x.id limit 1) sn on true
  where o.id=${obligationId}::uuid and o.tenant_id=${tenantId}::uuid`,
    );
    if (!row)
      return { decision: { observe: false, deliver: false, holdReason: 'obligation_missing' }, snapshotId: null };
    const frozen = route
      ? { personId: route.personId, scopeId: route.scopeId }
      : row.route_person_id && row.route_scope_id
        ? { personId: String(row.route_person_id), scopeId: String(row.route_scope_id) }
        : null;
    const decision = decidePulseReportActivation({
      control: row.mode ? { mode: row.mode as PulseReportActivationMode, expiresAt: toDate(row.expires_at) } : null,
      scope: row.activation_scope_id
        ? { approvedRecipientPersonId: (row.approved_recipient_person_id as string | null) ?? null }
        : null,
      frozenRoute: row.snapshot_id ? frozen : null,
      obligationScopeId: String(row.scope_id),
      deliveredParts: Number(row.delivered_parts),
      now: toDate(row.now)!,
    });
    return { decision, snapshotId: row.snapshot_id ? String(row.snapshot_id) : null };
  }

  /**
   * Re-check inside the delivery claim and again before provider invocation. Compares the recipient of the artifact
   * actually being dispatched; the control row share lock serializes against a concurrent `change`.
   */
  deliveryGuard(tenantId: string, obligationId: string): PulseDeliveryActivationGuard {
    return async (tx, frozen: { obligationId: string; route: PulseRecipientBinding }) => {
      if (frozen.obligationId !== obligationId || frozen.route.tenantId !== tenantId) return false;
      await tx.execute(
        sql`select tenant_id from pulse_report_activation_controls where tenant_id=${tenantId}::uuid for share`,
      );
      return (await this.decide(tenantId, obligationId, tx, frozen.route)).decision.deliver;
    };
  }

  async now(): Promise<Date> {
    const [row] = await pulseInputRows(this.db.client, sql`select clock_timestamp() now`);
    return toDate(row!.now)!;
  }

  /** Tenancy checks (errors) and current-owner comparison (warnings) for a proposed change. */
  async inspect(
    input: PulseReportActivationChange,
    tx: PulseReportExecutor = this.db.client,
  ): Promise<{ errors: string[]; warnings: string[] }> {
    const change = normalizePulseReportActivationChange(input);
    const errors: string[] = [],
      warnings: string[] = [];
    for (const scope of change.scopes) {
      const label = scope.kind + ':' + scope.orgUnitId + (scope.orgTeamId ? ':' + scope.orgTeamId : '');
      const [unit] = await pulseInputRows(
        tx,
        sql`select u.manager_person_id,t.id team_id,t.team_lead_person_id from org_units u left join org_teams t on t.id=${scope.orgTeamId}::uuid and t.unit_id=u.id and t.tenant_id=u.tenant_id where u.id=${scope.orgUnitId}::uuid and u.tenant_id=${change.tenantId}::uuid`,
      );
      if (!unit) {
        errors.push('scope_org_unit_unknown:' + label);
        continue;
      }
      if (scope.orgTeamId && !unit.team_id) errors.push('scope_org_team_unknown:' + label);
      if (!scope.approvedRecipientPersonId) continue;
      const [person] = await pulseInputRows(
        tx,
        sql`select id from people where id=${scope.approvedRecipientPersonId}::uuid and tenant_id=${change.tenantId}::uuid`,
      );
      if (!person) {
        errors.push('scope_recipient_unknown:' + label);
        continue;
      }
      const owner = scope.kind === 'team' ? unit.team_lead_person_id : unit.manager_person_id;
      if (String(owner ?? '') !== scope.approvedRecipientPersonId)
        warnings.push('recipient_not_current_scope_owner:' + label);
    }
    return { errors, warnings };
  }

  async read(tenantId: string, tx: PulseReportExecutor = this.db.client): Promise<PulseReportActivationState> {
    const [c] = await pulseInputRows(
      tx,
      sql`select tenant_id,mode,revision,approval_reference,expires_at,updated_by from pulse_report_activation_controls where tenant_id=${tenantId}::uuid`,
    );
    const scopes = await pulseInputRows(
      tx,
      sql`select kind,org_unit_id,org_team_id,approved_recipient_person_id from pulse_report_activation_scopes where tenant_id=${tenantId}::uuid order by kind,org_unit_id,org_team_id nulls first`,
    );
    const control: PulseReportActivationControl | null = c
      ? {
          tenantId,
          mode: c.mode as PulseReportActivationMode,
          revision: Number(c.revision),
          approvalReference: String(c.approval_reference),
          expiresAt: toDate(c.expires_at),
          updatedBy: String(c.updated_by),
        }
      : null;
    return {
      control,
      scopes: scopes.map((s) => ({
        kind: s.kind as PulseReportActivationScopeKind,
        orgUnitId: String(s.org_unit_id),
        orgTeamId: s.org_team_id ? String(s.org_team_id) : null,
        approvedRecipientPersonId: s.approved_recipient_person_id ? String(s.approved_recipient_person_id) : null,
      })),
    };
  }

  /** Live, undelivered snapshots that the current controls would not send; partial ones carry partial_delivery_held. */
  async held(tenantId: string): Promise<PulseReportHeldSnapshot[]> {
    const rows = await pulseInputRows(
      this.db.client,
      sql`select o.id obligation_id,sn.id snapshot_id,o.scope_id,s.kind,o.status from survey_report_obligations o join survey_report_native_snapshots sn on sn.obligation_id=o.id and sn.tenant_id=o.tenant_id and sn.purged_at is null and sn.expires_at>clock_timestamp() join survey_report_scopes s on s.id=o.scope_id where o.tenant_id=${tenantId}::uuid and o.status in ('snapshot_ready','delivering') order by o.id`,
    );
    const held: PulseReportHeldSnapshot[] = [];
    for (const row of rows) {
      const { decision } = await this.decide(tenantId, String(row.obligation_id));
      if (!decision.deliver)
        held.push({
          obligationId: String(row.obligation_id),
          snapshotId: String(row.snapshot_id),
          scopeId: String(row.scope_id),
          kind: String(row.kind),
          status: String(row.status),
          holdReason: decision.holdReason,
        });
    }
    return held;
  }

  async change(input: PulseReportActivationChange): Promise<PulseReportActivationChangeResult> {
    const change = normalizePulseReportActivationChange(input);
    return this.db.client.transaction(async (tx) => {
      const [clock] = await pulseInputRows(tx, sql`select clock_timestamp() now`);
      const errors = validatePulseReportActivationChange(change, toDate(clock!.now)!);
      if (errors.length) return { status: 'invalid' as const, errors };
      const checked = await this.inspect(change, tx);
      if (checked.errors.length) return { status: 'invalid' as const, errors: checked.errors };
      const [locked] = await pulseInputRows(
        tx,
        sql`select revision from pulse_report_activation_controls where tenant_id=${change.tenantId}::uuid for update`,
      );
      const before = locked ? await this.read(change.tenantId, tx) : null;
      const current = locked ? Number(locked.revision) : 0;
      if (current !== change.expectedRevision)
        return { status: 'revision_conflict' as const, currentRevision: current };
      const revision = current + 1,
        expiresAt = change.expiresAt?.toISOString() ?? null;
      const [written] = locked
        ? await pulseInputRows(
            tx,
            sql`update pulse_report_activation_controls set mode=${change.mode},revision=${revision},approval_reference=${change.approvalReference.trim()},expires_at=${expiresAt}::timestamptz,updated_by=${change.operator.trim()},updated_at=clock_timestamp() where tenant_id=${change.tenantId}::uuid and revision=${current} returning revision`,
          )
        : await pulseInputRows(
            tx,
            sql`insert into pulse_report_activation_controls(tenant_id,mode,revision,approval_reference,expires_at,updated_by) values(${change.tenantId}::uuid,${change.mode},${revision},${change.approvalReference.trim()},${expiresAt}::timestamptz,${change.operator.trim()}) on conflict(tenant_id) do nothing returning revision`,
          );
      if (!written) {
        const [now] = await pulseInputRows(
          tx,
          sql`select revision from pulse_report_activation_controls where tenant_id=${change.tenantId}::uuid`,
        );
        return { status: 'revision_conflict' as const, currentRevision: Number(now?.revision ?? 0) };
      }
      await tx.execute(sql`delete from pulse_report_activation_scopes where tenant_id=${change.tenantId}::uuid`);
      for (const scope of change.scopes)
        await tx.execute(
          sql`insert into pulse_report_activation_scopes(tenant_id,kind,org_unit_id,org_team_id,approved_recipient_person_id) values(${change.tenantId}::uuid,${scope.kind},${scope.orgUnitId}::uuid,${scope.orgTeamId}::uuid,${scope.approvedRecipientPersonId}::uuid)`,
        );
      const after = await this.read(change.tenantId, tx);
      await tx.execute(
        sql`insert into pulse_report_activation_events(tenant_id,revision,operator,approval_reference,before,after) values(${change.tenantId}::uuid,${revision},${change.operator.trim()},${change.approvalReference.trim()},${before ? JSON.stringify(auditState(before)) : null}::jsonb,${JSON.stringify(auditState(after))}::jsonb)`,
      );
      return { status: 'applied' as const, revision, warnings: checked.warnings };
    });
  }

  async events(tenantId: string) {
    return pulseInputRows(
      this.db.client,
      sql`select revision,operator,approval_reference,before,after,created_at from pulse_report_activation_events where tenant_id=${tenantId}::uuid order by revision`,
    );
  }
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}
function auditState(state: PulseReportActivationState) {
  return {
    mode: state.control?.mode ?? 'off',
    revision: state.control?.revision ?? 0,
    approvalReference: state.control?.approvalReference ?? null,
    expiresAt: state.control?.expiresAt?.toISOString() ?? null,
    scopes: state.scopes satisfies PulseReportActivationScope[],
  };
}
