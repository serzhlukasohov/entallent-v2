import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  pulseInputRows,
  pulsePublicationHash,
  boundPulsePublicationLocks,
} from '@entalent/database';
import {
  PULSE_INPUT_CONTRACT,
  PULSE_REPORT_CALCULATION_CONTRACT,
  PULSE_REPORT_PRIVACY_POLICY_VERSION,
  ENGAGEMENT_ANSWER_CONTRACT,
  PULSE_PRESENTATION_CONTRACT,
  PULSE_LABEL_VERSION,
  PULSE_DELIVERY_CONTRACT,
  type PulseAssemblyLease,
  type BuildPulseReportResult,
} from '@entalent/contracts';
import { pulseUsedCandidateIds, type PulseReportTransportPort } from '@entalent/application';
import { renderPulseReportForSlack } from '@entalent/channel-slack';
import { DatabaseService } from '../../database/database.service';
import { PulseReportPresentationRepository } from './pulse-report-presentation.repository';
import { PulseReportRecipientRepository } from './pulse-report-recipient.repository';
@Injectable()
export class PulseReportSnapshotRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly presentation: PulseReportPresentationRepository,
    private readonly recipients: PulseReportRecipientRepository,
    private readonly transport: PulseReportTransportPort,
  ) {}
  async freeze(
    lease: PulseAssemblyLease,
    built: Extract<BuildPulseReportResult, { status: 'built' }>,
  ): Promise<{ status: string; snapshotId?: string }> {
    if (
      pulsePublicationHash(built.provenance.context) !== pulsePublicationHash(lease.context) ||
      pulsePublicationHash(built.provenance.sections) !== pulsePublicationHash(lease.sections)
    )
      return { status: 'invalidated' };
    const [liveOwner] = await pulseInputRows(
      this.db.client,
      sql`select id from survey_report_obligations where id=${lease.obligationId}::uuid and tenant_id=${lease.tenantId}::uuid and assembly_token=${lease.token} and status='assembling' and lease_until>clock_timestamp()`,
    );
    if (!liveOwner) return { status: 'stale_lease' };
    const slack = renderPulseReportForSlack(built.presentation);
    const candidate = await this.recipients.resolve(lease.tenantId, lease.request.overallScopeId);
    if (!candidate) return { status: 'blocked' };
    const credential = await this.recipients.credential(candidate);
    if (!credential) return { status: 'blocked' };
    // No-message provider proof runs outside source/publication locks. Local tests inject a fake.
    const proof = await this.transport.prove(candidate, credential);
    if (!proof) return { status: 'blocked' };
    const route = await this.recipients.verify(candidate, proof);
    if (!route) return { status: 'blocked' };
    const [policy] = await pulseInputRows(
      this.db.client,
      sql`select c.scoring_policy_id,p.version from survey_cycle_scoring_policies c join survey_scoring_policies p on p.id=c.scoring_policy_id where c.id=${lease.request.cycleId}::uuid and c.tenant_id=${lease.tenantId}::uuid`,
    );
    if (!policy) return { status: 'blocked' };
    const usedCandidateIds = pulseUsedCandidateIds(lease.sections);
    const contracts = {
      sourceCandidateIds: usedCandidateIds,
      input: PULSE_INPUT_CONTRACT,
      calculation: PULSE_REPORT_CALCULATION_CONTRACT,
      privacy: PULSE_REPORT_PRIVACY_POLICY_VERSION,
      answer: ENGAGEMENT_ANSWER_CONTRACT,
      presentation: PULSE_PRESENTATION_CONTRACT,
      labels: PULSE_LABEL_VERSION,
      channel: 'pulse-slack-v1',
      delivery: PULSE_DELIVERY_CONTRACT,
      scoringPolicyId: String(policy.scoring_policy_id),
      scoringVersion: String(policy.version),
    };
    const artifactHash = pulsePublicationHash({
      contracts,
      presentation: built.presentation,
      provenance: built.provenance,
      manifest: slack.manifest,
      parts: slack.parts,
      route,
    });
    return this.db.client.transaction(
      async (tx) => {
        await boundPulsePublicationLocks(tx);
        if (
          !(await this.presentation.validateInTransaction(
            tx,
            lease.context,
            lease.sections,
            true,
          )) ||
          !(await this.recipients.validate(tx, route))
        )
          return { status: 'invalidated' };
        const [owner] = await pulseInputRows(
          tx,
          sql`select id from survey_report_obligations where tenant_id=${lease.tenantId}::uuid and id=${lease.obligationId}::uuid and status='assembling' and assembly_token=${lease.token} and lease_until>clock_timestamp() for update nowait`,
        );
        if (!owner) return { status: 'stale_lease' };
        const [existing] = await pulseInputRows(
          tx,
          sql`select id from survey_report_native_snapshots where obligation_id=${lease.obligationId}::uuid`,
        );
        if (existing) return { status: 'snapshot_ready', snapshotId: String(existing.id) };
        const ids = usedCandidateIds;
        const [expiry] = await pulseInputRows(
          tx,
          sql`select pulse_candidate_content_deadline(${lease.tenantId}::uuid,${'{' + ids.join(',') + '}'}::uuid[])::text expires_at`,
        );
        if (!expiry?.expires_at || expiry.expires_at === '-infinity')
          return { status: 'invalidated' };
        const snapshotId = randomUUID();
        await tx.execute(
          sql`insert into survey_report_native_snapshots(id,tenant_id,obligation_id,cycle_id,scope_id,purpose,artifact_hash,part_count,expires_at) values(${snapshotId}::uuid,${lease.tenantId}::uuid,${lease.obligationId}::uuid,${lease.request.cycleId}::uuid,${lease.request.overallScopeId}::uuid,${lease.request.purpose},${artifactHash},${slack.parts.length},${String(expiry.expires_at)}::timestamptz)`,
        );
        await tx.execute(
          sql`insert into survey_report_snapshot_payloads(snapshot_id,tenant_id,contracts,presentation,provenance,manifest,route) values(${snapshotId}::uuid,${lease.tenantId}::uuid,${JSON.stringify(contracts)}::jsonb,${JSON.stringify(built.presentation)}::jsonb,${JSON.stringify(built.provenance)}::jsonb,${JSON.stringify(slack.manifest)}::jsonb,${JSON.stringify(route)}::jsonb)`,
        );
        for (const [i, part] of slack.parts.entries()) {
          const partId = randomUUID();
          await tx.execute(
            sql`insert into survey_report_parts(id,tenant_id,snapshot_id,ordinal,body_hash) values(${partId}::uuid,${lease.tenantId}::uuid,${snapshotId}::uuid,${i + 1},${pulsePublicationHash(part)})`,
          );
          await tx.execute(
            sql`insert into survey_report_part_payloads(part_id,payload) values(${partId}::uuid,${JSON.stringify(part)}::jsonb)`,
          );
        }
        // Assembly completion is separate from transport; each metric must satisfy its OWN floor.
        if (lease.request.purpose === 'final' && lease.sections[0]!.finalGate === 'eligible')
          for (const section of lease.sections) {
            let supported = false;
            for (const metric of section.metrics.filter(
              (m) => m.status === 'eligible' && m.completeCount >= 5 && m.rawMean !== null,
            )) {
              await tx.execute(
                sql`insert into survey_report_completion_supports(snapshot_id,candidate_id,tenant_id,cycle_id,history_key,metric_key,context_hash) values(${snapshotId}::uuid,${section.candidateId}::uuid,${lease.tenantId}::uuid,${lease.request.cycleId}::uuid,${section.context.historyKey},${metric.metricKey},${pulsePublicationHash(section.context)})`,
              );
              supported = true;
            }
            if (supported)
              await tx.execute(
                sql`insert into survey_report_final_completions(candidate_id,canonical_snapshot_id) values(${section.candidateId}::uuid,${snapshotId}::uuid) on conflict(candidate_id) do nothing`,
              );
          }
        await tx.execute(
          sql`update survey_report_obligations set status='snapshot_ready',lease_until=null,completed_at=clock_timestamp(),next_action_at=clock_timestamp() where id=${lease.obligationId}::uuid and assembly_token=${lease.token}`,
        );
        await tx.execute(
          sql`delete from survey_report_assembly_inputs where obligation_id=${lease.obligationId}::uuid`,
        );
        return { status: 'snapshot_ready', snapshotId };
      },
      { isolationLevel: 'read committed' },
    );
  }
}
