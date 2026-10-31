import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  pulseInputRows,
  pulsePublicationHash,
  boundPulsePublicationLocks,
  type PulseReportExecutor,
} from '@entalent/database';
import {
  PulseReconciliationSchema,
  type PulseRecipientBinding,
  type PulseAssemblyProvenance,
  type PulseReconciliation,
  type PulseTransportOutcome,
} from '@entalent/contracts';
import type { PulseReportTransportPort } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';
import { PulseReportPresentationRepository } from './pulse-report-presentation.repository';
import { PulseReportRecipientRepository } from './pulse-report-recipient.repository';
interface Grant {
  tenantId: string;
  snapshotId: string;
  partId: string;
  attemptId: string;
  token: number;
}
interface Artifact {
  id: string;
  obligationId: string;
  hash: string;
  route: PulseRecipientBinding;
  provenance: PulseAssemblyProvenance;
  parts: { id: string; ordinal: number; hash: string; payload: unknown; status: string }[];
}
/** Optional in-transaction re-check of the frozen route (RPT-10 activation); false holds without side effects. */
export type PulseDeliveryActivationGuard = (
  tx: PulseReportExecutor,
  frozen: { obligationId: string; route: PulseRecipientBinding },
) => Promise<boolean>;
/**
 * RPT-10 fence-only passes (scan of held snapshots, outside BullMQ jobId dedup) may run concurrently with another
 * process's claim->dispatch. They treat an attempt_started/dispatching attempt as abandoned only after this DB-clock
 * age, comparable to the default assembly lease window (120 s). The deliver-job claim path is unchanged.
 */
export const PULSE_FENCE_ABANDONED_ATTEMPT_MS = 120_000;
/** Process-local authority is deliberately not serializable/recoverable from PostgreSQL IDs. */
const freshGrants = new WeakSet<object>();
@Injectable()
export class PulseReportDeliveryRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly presentation: PulseReportPresentationRepository,
    private readonly recipients: PulseReportRecipientRepository,
    private readonly transport: PulseReportTransportPort,
    private readonly reconciliationEnabled = false,
  ) {}
  private async artifact(
    tx: PulseReportExecutor,
    tenantId: string,
    snapshotId: string,
  ): Promise<Artifact | null> {
    const [s] = await pulseInputRows(
      tx,
      sql`select s.id,s.obligation_id,s.artifact_hash,s.part_count,p.contracts,p.presentation,p.provenance,p.manifest,p.route from survey_report_native_snapshots s join survey_report_snapshot_payloads p on p.snapshot_id=s.id and p.tenant_id=s.tenant_id where s.id=${snapshotId}::uuid and s.tenant_id=${tenantId}::uuid and s.purged_at is null and s.expires_at>clock_timestamp()`,
    );
    if (!s) return null;
    const rows = await pulseInputRows(
      tx,
      sql`select p.id,p.ordinal,p.body_hash,p.status,b.payload from survey_report_parts p join survey_report_part_payloads b on b.part_id=p.id where p.tenant_id=${tenantId}::uuid and p.snapshot_id=${snapshotId}::uuid order by p.ordinal`,
    );
    if (
      rows.length !== Number(s.part_count) ||
      rows.some(
        (r, i) => Number(r.ordinal) !== i + 1 || pulsePublicationHash(r.payload) !== r.body_hash,
      )
    )
      return null;
    if (
      pulsePublicationHash({
        contracts: s.contracts,
        presentation: s.presentation,
        provenance: s.provenance,
        manifest: s.manifest,
        parts: rows.map((r) => r.payload),
        route: s.route,
      }) !== s.artifact_hash
    )
      return null;
    return {
      id: snapshotId,
      obligationId: String(s.obligation_id),
      hash: String(s.artifact_hash),
      route: s.route as PulseRecipientBinding,
      provenance: s.provenance as PulseAssemblyProvenance,
      parts: rows.map((r) => ({
        id: String(r.id),
        ordinal: Number(r.ordinal),
        hash: String(r.body_hash),
        payload: r.payload,
        status: String(r.status),
      })),
    };
  }
  private async authorize(tx: PulseReportExecutor, artifact: Artifact) {
    if (
      !(await this.presentation.validateInTransaction(
        tx,
        artifact.provenance.context,
        artifact.provenance.sections,
        true,
      ))
    )
      return false;
    return this.recipients.validate(tx, artifact.route);
  }
  private async lockLogical(tx: PulseReportExecutor, tenantId: string, a: Artifact) {
    const [o] = await pulseInputRows(
      tx,
      sql`select status from survey_report_obligations where tenant_id=${tenantId}::uuid and id=${a.obligationId}::uuid for update nowait`,
    );
    await tx.execute(
      sql`select id from survey_report_native_snapshots where tenant_id=${tenantId}::uuid and id=${a.id}::uuid for update nowait`,
    );
    await tx.execute(
      sql`select id from survey_report_parts where tenant_id=${tenantId}::uuid and snapshot_id=${a.id}::uuid order by ordinal for update nowait`,
    );
    return o ? String(o.status) : 'missing';
  }
  private async cancel(tx: PulseReportExecutor, tenantId: string, a: Artifact, reason: string) {
    await tx.execute(
      sql`update survey_report_obligations set status=case when exists(select 1 from survey_report_attempts where snapshot_id=${a.id}::uuid and state in ('attempt_started','dispatching','unknown')) then 'reconciliation_required' else 'canceled' end,disposition=${reason} where tenant_id=${tenantId}::uuid and id=${a.obligationId}::uuid and status<>'delivered'`,
    );
    await tx.execute(
      sql`update survey_report_parts set status='canceled' where tenant_id=${tenantId}::uuid and snapshot_id=${a.id}::uuid and status='pending'`,
    );
  }
  async claim(tenantId: string, snapshotId: string): Promise<Grant | null> {
    const grant = await this.claimGuarded(tenantId, snapshotId);
    return grant === 'held' ? null : grant;
  }
  private async claimGuarded(
    tenantId: string,
    snapshotId: string,
    guard?: PulseDeliveryActivationGuard,
    fenceOnly = false,
  ): Promise<Grant | 'held' | null> {
    const grant = await this.db.client.transaction(
      async (tx): Promise<Grant | 'held' | null> => {
        await boundPulsePublicationLocks(tx);
        const a = await this.artifact(tx, tenantId, snapshotId);
        if (!a) return null;
        if (!(await this.authorize(tx, a))) {
          await this.cancel(tx, tenantId, a, 'authorization_invalid');
          return null;
        }
        const status = await this.lockLogical(tx, tenantId, a);
        if (!['snapshot_ready', 'delivering'].includes(status)) return null;
        const [unresolved] = await pulseInputRows(
          tx,
          sql`select id,state in ('attempt_started','dispatching') and started_at>clock_timestamp()-${PULSE_FENCE_ABANDONED_ATTEMPT_MS}*interval '1 millisecond' live from survey_report_attempts where tenant_id=${tenantId}::uuid and snapshot_id=${snapshotId}::uuid and state in ('attempt_started','dispatching','unknown') for update nowait`,
        );
        // A fence pass never escalates a possibly in-flight attempt of another process.
        if (unresolved && fenceOnly && unresolved.live === true) return 'held';
        if (unresolved) {
          await tx.execute(
            sql`update survey_report_attempts set state='unknown',reason='abandoned_attempt' where id=${String(unresolved.id)}::uuid and state in ('attempt_started','dispatching')`,
          );
          await tx.execute(
            sql`update survey_report_parts set status='unknown' where id=(select part_id from survey_report_attempts where id=${String(unresolved.id)}::uuid) and status<>'delivered'`,
          );
          await tx.execute(
            sql`update survey_report_obligations set status='reconciliation_required',disposition='unresolved_attempt' where id=${a.obligationId}::uuid`,
          );
          return null;
        }
        const [part] = await pulseInputRows(
          tx,
          sql`select id,ordinal,body_hash,attempt_token from survey_report_parts where snapshot_id=${snapshotId}::uuid and tenant_id=${tenantId}::uuid and status<>'delivered' order by ordinal limit 1`,
        );
        if (!part) {
          await tx.execute(
            sql`update survey_report_obligations set status='delivered',delivered_at=coalesce(delivered_at,clock_timestamp()) where id=${a.obligationId}::uuid`,
          );
          return null;
        }
        const prior = await pulseInputRows(
          tx,
          sql`select state,retryable,next_attempt_at<=clock_timestamp() due from survey_report_attempts where part_id=${String(part.id)}::uuid order by token desc limit 1`,
        );
        if (
          prior.length &&
          (prior[0]!.state !== 'definitely_not_sent' ||
            !prior[0]!.retryable ||
            prior[0]!.due === false)
        )
          return null;
        // RPT-10: after every RPT-07 fence (authorize/cancel, abandoned attempt, retry gate) and immediately
        // before the attempt row, so a held snapshot is still cancelled/escalated but never claimed.
        if (guard && !(await guard(tx, { obligationId: a.obligationId, route: a.route })))
          return 'held';
        const attemptId = randomUUID(),
          token = Number(part.attempt_token) + 1;
        await tx.execute(
          sql`insert into survey_report_attempts(id,tenant_id,snapshot_id,part_id,token,artifact_hash,body_hash,route_hash,authorization_receipt) values(${attemptId}::uuid,${tenantId}::uuid,${snapshotId}::uuid,${String(part.id)}::uuid,${token},${a.hash},${String(part.body_hash)},${pulsePublicationHash(a.route)},${pulsePublicationHash(a.provenance)})`,
        );
        await tx.execute(
          sql`update survey_report_parts set status='attempt_started',attempt_token=${token} where id=${String(part.id)}::uuid`,
        );
        await tx.execute(
          sql`update survey_report_obligations set status='delivering' where id=${a.obligationId}::uuid`,
        );
        return { tenantId, snapshotId, partId: String(part.id), attemptId, token };
      },
      { isolationLevel: 'read committed' },
    );
    if (grant && grant !== 'held') freshGrants.add(grant);
    return grant;
  }
  async deliverNext(
    tenantId: string,
    snapshotId: string,
    guard?: PulseDeliveryActivationGuard,
  ): Promise<{ status: string }> {
    try {
      const grant = await this.claimGuarded(tenantId, snapshotId, guard);
      if (grant === 'held') return { status: 'held' };
      return grant ? this.dispatch(grant, guard) : { status: 'not_claimed' };
    } catch {
      return { status: 'blocked' };
    }
  }
  /** RPT-10 held snapshots: run the RPT-07 claim fences (cancel/escalate) without ever creating an attempt. */
  async fence(tenantId: string, snapshotId: string): Promise<{ status: string }> {
    try {
      const result = await this.claimGuarded(tenantId, snapshotId, async () => false, true);
      return { status: result === 'held' ? 'held' : 'not_claimable' };
    } catch {
      return { status: 'blocked' };
    }
  }
  /** Consumes authority before await. A rollback, duplicated object, or database lookup cannot restore it. */
  async dispatch(grant: Grant, guard?: PulseDeliveryActivationGuard): Promise<{ status: string }> {
    if (!freshGrants.delete(grant)) return { status: 'no_fresh_dispatch_grant' };
    let invoked = false;
    try {
      return await this.db.client.transaction(
        async (tx) => {
          await boundPulsePublicationLocks(tx);
          const a = await this.artifact(tx, grant.tenantId, grant.snapshotId);
          if (!a) return this.noInvocation(tx, grant, 'artifact_unavailable', false);
          if (!(await this.authorize(tx, a))) {
            await this.noInvocation(tx, grant, 'authorization_invalid', false);
            await this.cancel(tx, grant.tenantId, a, 'authorization_invalid');
            return { status: 'canceled' };
          }
          const logical = await this.lockLogical(tx, grant.tenantId, a);
          if (logical === 'reconciliation_required') return { status: 'unknown' };
          if (!['delivering', 'snapshot_ready'].includes(logical))
            return this.noInvocation(tx, grant, 'logical_stopped', false);
          const [attempt] = await pulseInputRows(
            tx,
            sql`update survey_report_attempts set state='dispatching' where id=${grant.attemptId}::uuid and tenant_id=${grant.tenantId}::uuid and snapshot_id=${grant.snapshotId}::uuid and part_id=${grant.partId}::uuid and token=${grant.token} and state='attempt_started' and artifact_hash=${a.hash} and route_hash=${pulsePublicationHash(a.route)} returning id`,
          );
          if (!attempt) return { status: 'stale_attempt' };
          await tx.execute(
            sql`update survey_report_parts set status='dispatching' where id=${grant.partId}::uuid and attempt_token=${grant.token}`,
          );
          const part = a.parts.find((p) => p.id === grant.partId);
          const credential = await this.recipients.credential(a.route, tx);
          if (!part || !credential)
            return this.noInvocation(tx, grant, 'credential_or_part_unavailable', false);
          // Recheck time-dependent authorization immediately before one bounded provider invocation.
          const [live] = await pulseInputRows(
            tx,
            sql`select expires_at>clock_timestamp() and purged_at is null live from survey_report_native_snapshots where id=${a.id}::uuid`,
          );
          if (!live?.live || !(await this.authorize(tx, a)))
            return this.noInvocation(tx, grant, 'expired_before_dispatch', false);
          // RPT-10: activation switched off after the claim. Definitely not sent and immediately retryable, so a
          // later approved deliver claims the same part once; never reconciliation_required.
          if (guard && !(await guard(tx, { obligationId: a.obligationId, route: a.route }))) {
            await this.noInvocation(tx, grant, 'activation_held', true, false);
            return { status: 'held' };
          }
          invoked = true;
          const outcome = await this.transport.post(credential, a.route.channelId, part.payload);
          return this.recordOutcome(tx, grant, a, outcome);
        },
        { isolationLevel: 'read committed' },
      );
    } catch {
      // Commit ambiguity after provider invocation is UNKNOWN even when the receipt may have committed.
      try {
        await this.db.client.transaction(async (tx) => {
          const [attempt] = await pulseInputRows(
            tx,
            sql`select state from survey_report_attempts where id=${grant.attemptId}::uuid and tenant_id=${grant.tenantId}::uuid and token=${grant.token} for update`,
          );
          if (attempt?.state === 'delivered') return; // Verified committed receipt already owns the outcome.
          if (invoked) {
            await tx.execute(
              sql`update survey_report_attempts set state='unknown',reason='database_ambiguity' where id=${grant.attemptId}::uuid and state in ('attempt_started','dispatching')`,
            );
            await tx.execute(
              sql`update survey_report_parts set status='unknown' where id=${grant.partId}::uuid and status<>'delivered'`,
            );
            await tx.execute(
              sql`update survey_report_obligations set status='reconciliation_required',disposition='database_ambiguity' where id=(select obligation_id from survey_report_native_snapshots where id=${grant.snapshotId}::uuid) and status<>'delivered'`,
            );
          } else await this.noInvocation(tx, grant, 'local_not_invoked', true);
        });
      } catch {
        /* Durable unresolved write-ahead owner remains nonrecoverable automatically. */
      }
      return { status: invoked ? 'unknown' : 'blocked' };
    }
  }
  private async noInvocation(
    tx: PulseReportExecutor,
    g: Grant,
    reason: string,
    retryable: boolean,
    delayRetry = true,
  ) {
    await tx.execute(
      sql`update survey_report_attempts set state='definitely_not_sent',resolved_at=clock_timestamp(),reason=${reason},retryable=${retryable ? 1 : 0},next_attempt_at=clock_timestamp()+${delayRetry ? 60 : 0}*interval '1 second' where id=${g.attemptId}::uuid and tenant_id=${g.tenantId}::uuid and token=${g.token} and state in ('attempt_started','dispatching')`,
    );
    await tx.execute(
      sql`update survey_report_parts set status='pending' where id=${g.partId}::uuid and attempt_token=${g.token} and status in ('attempt_started','dispatching')`,
    );
    return { status: 'definitely_not_sent' };
  }
  private async recordOutcome(
    tx: PulseReportExecutor,
    g: Grant,
    a: Artifact,
    o: PulseTransportOutcome,
  ): Promise<{ status: string }> {
    if (o.status === 'accepted') {
      if (o.channel !== a.route.channelId || !/^\d{10,}\.\d{6}$/.test(o.timestamp))
        return this.recordOutcome(tx, g, a, { status: 'unknown', reason: 'unverified_response' });
      await tx.execute(
        sql`insert into survey_report_receipts(attempt_id,tenant_id,snapshot_id,channel,provider_timestamp) values(${g.attemptId}::uuid,${g.tenantId}::uuid,${g.snapshotId}::uuid,${o.channel},${o.timestamp})`,
      );
      await tx.execute(
        sql`update survey_report_attempts set state='delivered',resolved_at=clock_timestamp() where id=${g.attemptId}::uuid and token=${g.token}`,
      );
      await tx.execute(
        sql`update survey_report_parts set status='delivered' where id=${g.partId}::uuid and attempt_token=${g.token}`,
      );
      const [remaining] = await pulseInputRows(
        tx,
        sql`select count(*)::int n from survey_report_parts where snapshot_id=${g.snapshotId}::uuid and status<>'delivered'`,
      );
      if (Number(remaining?.n) === 0)
        await tx.execute(
          sql`update survey_report_obligations set status='delivered',delivered_at=clock_timestamp() where id=${a.obligationId}::uuid`,
        );
      return { status: Number(remaining?.n) === 0 ? 'delivered' : 'part_delivered' };
    }
    if (o.status === 'definitely_not_sent') {
      await tx.execute(
        sql`update survey_report_attempts set state='definitely_not_sent',resolved_at=clock_timestamp(),reason=${o.reason},retryable=${o.retryable ? 1 : 0},next_attempt_at=clock_timestamp()+${Math.min(3600, Math.max(1, o.retryAfterSeconds ?? 60))}*interval '1 second' where id=${g.attemptId}::uuid`,
      );
      await tx.execute(
        sql`update survey_report_parts set status='pending' where id=${g.partId}::uuid`,
      );
      await tx.execute(
        sql`update survey_report_obligations set status=${o.retryable ? 'snapshot_ready' : 'blocked'},disposition=${o.reason},next_action_at=clock_timestamp()+${Math.min(3600, Math.max(1, o.retryAfterSeconds ?? 60))}*interval '1 second' where id=${a.obligationId}::uuid`,
      );
      return { status: o.status };
    }
    await tx.execute(
      sql`update survey_report_attempts set state='unknown',reason=${o.reason} where id=${g.attemptId}::uuid`,
    );
    await tx.execute(
      sql`update survey_report_parts set status='unknown' where id=${g.partId}::uuid`,
    );
    await tx.execute(
      sql`update survey_report_obligations set status='reconciliation_required',disposition=${o.reason} where id=${a.obligationId}::uuid`,
    );
    return { status: 'unknown' };
  }
  async reconcile(input: PulseReconciliation): Promise<{ status: string }> {
    const parsed = PulseReconciliationSchema.safeParse(input);
    if (!this.reconciliationEnabled || !parsed.success) return { status: 'disabled_or_invalid' };
    const c = parsed.data;
    return this.db.client.transaction(
      async (tx) => {
        await boundPulsePublicationLocks(tx);
        await tx.execute(
          sql`select o.id from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id where s.id=${c.snapshotId}::uuid and s.tenant_id=${c.tenantId}::uuid for update of o nowait`,
        );
        await tx.execute(
          sql`select id from survey_report_native_snapshots where id=${c.snapshotId}::uuid and tenant_id=${c.tenantId}::uuid for update nowait`,
        );
        await tx.execute(
          sql`select id from survey_report_parts where snapshot_id=${c.snapshotId}::uuid and tenant_id=${c.tenantId}::uuid order by ordinal for update nowait`,
        );
        const [a] = await pulseInputRows(
          tx,
          sql`select a.*,p.ordinal,r.channel,r.provider_timestamp,s.obligation_id,payload.route from survey_report_attempts a join survey_report_parts p on p.id=a.part_id join survey_report_native_snapshots s on s.id=a.snapshot_id left join survey_report_snapshot_payloads payload on payload.snapshot_id=s.id left join survey_report_receipts r on r.attempt_id=a.id where a.id=${c.attemptId}::uuid and a.tenant_id=${c.tenantId}::uuid and a.snapshot_id=${c.snapshotId}::uuid and a.token=${c.token} for update of a nowait`,
        );
        if (
          !a ||
          !['unknown', 'attempt_started', 'dispatching'].includes(String(a.state)) ||
          a.body_hash !== c.evidence.bodyHash
        )
          return { status: 'stale_or_mismatched_evidence' };
        const route = a.route as PulseRecipientBinding | null;
        if (
          c.decision === 'confirmed_delivered' &&
          (!route || c.evidence.channel !== route.channelId)
        )
          return { status: 'stale_or_mismatched_evidence' };
        await tx.execute(
          sql`insert into survey_report_reconciliations(tenant_id,snapshot_id,attempt_id,token,decision,actor_id,authorization_ref,reason,evidence_ref,evidence) values(${c.tenantId}::uuid,${c.snapshotId}::uuid,${c.attemptId}::uuid,${c.token},${c.decision},${c.operator.actorId},${c.operator.authorizationRef},${c.reason},${c.evidenceRef},${JSON.stringify(c.evidence)}::jsonb)`,
        );
        if (c.decision === 'remain_unknown') {
          await tx.execute(
            sql`update survey_report_attempts set state='unknown',reason='explicit_unknown_reconciliation' where id=${c.attemptId}::uuid`,
          );
          await tx.execute(
            sql`update survey_report_parts set status='unknown' where id=${String(a.part_id)}::uuid and status<>'delivered'`,
          );
          await tx.execute(
            sql`update survey_report_obligations set status='reconciliation_required',disposition='explicit_unknown_reconciliation' where id=${String(a.obligation_id)}::uuid and status<>'delivered'`,
          );
          return { status: 'unknown' };
        }
        if (c.decision === 'confirmed_delivered') {
          await tx.execute(
            sql`insert into survey_report_receipts(attempt_id,tenant_id,snapshot_id,channel,provider_timestamp,evidence_ref) values(${c.attemptId}::uuid,${c.tenantId}::uuid,${c.snapshotId}::uuid,${c.evidence.channel!},${c.evidence.timestamp!},${c.evidenceRef})`,
          );
          await tx.execute(
            sql`update survey_report_attempts set state='delivered',resolved_at=clock_timestamp(),reason='explicit_positive_reconciliation' where id=${c.attemptId}::uuid`,
          );
          await tx.execute(
            sql`update survey_report_parts set status='delivered' where id=${String(a.part_id)}::uuid`,
          );
        } else {
          await tx.execute(
            sql`update survey_report_attempts set state='definitely_not_sent',resolved_at=clock_timestamp(),reason='explicit_negative_reconciliation',retryable=1,next_attempt_at=clock_timestamp() where id=${c.attemptId}::uuid`,
          );
          await tx.execute(
            sql`update survey_report_parts set status='pending' where id=${String(a.part_id)}::uuid`,
          );
        }
        const [state] = await pulseInputRows(
          tx,
          sql`select exists(select 1 from survey_report_attempts where snapshot_id=${c.snapshotId}::uuid and state in ('attempt_started','dispatching','unknown')) unresolved,not exists(select 1 from survey_report_parts where snapshot_id=${c.snapshotId}::uuid and status<>'delivered') done`,
        );
        await tx.execute(
          sql`update survey_report_obligations set status=${state?.unresolved ? 'reconciliation_required' : state?.done ? 'delivered' : 'snapshot_ready'},next_action_at=clock_timestamp(),delivered_at=case when ${Boolean(state?.done)} then coalesce(delivered_at,clock_timestamp()) else delivered_at end where id=${String(a.obligation_id)}::uuid`,
        );
        return { status: c.decision };
      },
      { isolationLevel: 'read committed' },
    );
  }
}
