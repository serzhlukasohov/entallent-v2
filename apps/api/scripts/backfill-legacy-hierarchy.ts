import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, inArray, sql } from 'drizzle-orm';
import { auditLogs, createDbClient, orgEmployeePlacements, orgTeams, orgUnits,
  teamMemberships, teams, tenants } from '@entalent/database';
import { parseLegacyBackfillManifest, planLegacyDraftBackfill,
  LegacyBackfillValidationError } from '../src/hierarchy/legacy-backfill-plan';
import { readLegacyHierarchyInput } from '../src/hierarchy/legacy-reconciliation.read';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const tenantId = process.env['TENANT_ID'];
  const databaseUrl = process.env['DATABASE_URL'];
  const manifestPath = process.env['BACKFILL_MANIFEST_PATH'];
  const apply = process.argv.includes('--apply');
  if (!tenantId || !UUID_RE.test(tenantId)) throw new Error('TENANT_ID must be the explicit tenant UUID');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!manifestPath) throw new Error('BACKFILL_MANIFEST_PATH is required');
  if (process.argv.some((arg) => arg.startsWith('--') && arg !== '--apply')) throw new Error('unknown_argument');
  const operatorId = process.env['OPERATOR_ID'];
  if (apply && (!operatorId || !operatorId.trim())) throw new Error('OPERATOR_ID is required for apply');
  if (apply && process.env['CONFIRM_HIERARCHY_BACKFILL'] !== tenantId) {
    throw new Error('CONFIRM_HIERARCHY_BACKFILL must equal TENANT_ID for apply');
  }
  const manifest = parseLegacyBackfillManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  if (manifest.tenantId !== tenantId) throw new LegacyBackfillValidationError(['tenant_mismatch']);
  const client = createDbClient(databaseUrl);
  try {
    const plan = await client.db.transaction(async (tx) => {
      if (!apply) await tx.execute(sql`SET TRANSACTION READ ONLY`);
      else {
        const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
          .where(eq(tenants.id, tenantId)).for('update').limit(1);
        if (!tenant) throw new LegacyBackfillValidationError(['tenant_missing']);
        const lockedTeams = await tx.select({ id: teams.id }).from(teams)
          .where(eq(teams.tenantId, tenantId)).for('update');
        if (lockedTeams.length) await tx.select({ id: teamMemberships.id }).from(teamMemberships)
          .where(inArray(teamMemberships.teamId, lockedTeams.map((row) => row.id))).for('update');
      }
      const input = await readLegacyHierarchyInput(tx, tenantId);
      const plan = planLegacyDraftBackfill(input, manifest);
      if (!apply) return plan;

      const unitIds = new Map<string, string>();
      const newUnits = plan.units.filter((unit) => !unit.existingId).map((unit) => {
        const id = randomUUID();
        unitIds.set(unit.customerUnitKey, id);
        return { id, tenantId, customerUnitKey: unit.customerUnitKey,
          name: unit.name, managerPersonId: unit.managerPersonId, lifecycleStatus: 'draft' };
      });
      for (const unit of plan.units) if (unit.existingId) unitIds.set(unit.customerUnitKey, unit.existingId);
      if (newUnits.length) await tx.insert(orgUnits).values(newUnits);

      const teamIds = new Map<string, string>();
      const newTeams = plan.teams.filter((team) => !team.existingId).map((team) => {
        const id = randomUUID();
        teamIds.set(team.customerTeamKey, id);
        return { id, tenantId, customerTeamKey: team.customerTeamKey, name: team.name,
          unitId: unitIds.get(team.customerUnitKey)!, teamLeadPersonId: team.teamLeadPersonId,
          lifecycleStatus: 'draft' };
      });
      for (const team of plan.teams) if (team.existingId) teamIds.set(team.customerTeamKey, team.existingId);
      if (newTeams.length) await tx.insert(orgTeams).values(newTeams);

      const newPlacements = plan.teams.flatMap((team) => team.newPlacementPersonIds.map((personId) => ({
        tenantId, employeePersonId: personId, unitId: unitIds.get(team.customerUnitKey)!,
        teamId: teamIds.get(team.customerTeamKey)!, lifecycleStatus: 'draft' as const,
      })));
      if (newPlacements.length) await tx.insert(orgEmployeePlacements).values(newPlacements);

      const postcheck = planLegacyDraftBackfill(await readLegacyHierarchyInput(tx, tenantId), manifest);
      if (postcheck.counts.newUnits || postcheck.counts.newTeams || postcheck.counts.newPlacements) {
        throw new LegacyBackfillValidationError(['postcheck_incomplete']);
      }
      await tx.insert(auditLogs).values({ tenantId, actorType: 'internal_operator', actorId: operatorId!,
        action: 'org.legacy.backfill_draft', resourceType: 'tenant', resourceId: tenantId,
        metadata: { sourceFingerprint: plan.sourceFingerprint, counts: plan.counts,
          legacyTeamIds: plan.teams.map((team) => team.legacyTeamId),
          quarantinedTeams: plan.quarantinedTeams } });
      return { ...postcheck, counts: plan.counts };
    }, { isolationLevel: apply ? 'serializable' : 'repeatable read' });
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'applied' : 'dry_run', plan }, null, 2)}\n`);
  } catch (error) {
    if (apply) {
      const reason = error instanceof LegacyBackfillValidationError ? 'mapping_invalid' : 'persistence_error';
      await client.db.insert(auditLogs).values({ tenantId, actorType: 'internal_operator', actorId: operatorId!,
        action: 'org.legacy.backfill_draft.rejected', resourceType: 'tenant', resourceId: tenantId,
        reason, metadata: { sourceFingerprint: manifest.sourceFingerprint,
          issues: error instanceof LegacyBackfillValidationError ? error.issues : [] } });
    }
    throw error;
  } finally {
    await client.sql.end();
  }
}

main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' ? error.code : null;
  const message = error instanceof Error && error.message ? error.message : code ?? 'Legacy hierarchy backfill failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
