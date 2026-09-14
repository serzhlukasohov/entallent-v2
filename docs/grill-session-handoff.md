# Grill Session Handoff

Updated: 2026-09-08

The canonical implementation contract is:

- `_bmad-output/specs/spec-pr5-persisted-reporting-cohort-lifecycle/SPEC.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/SPEC.md`

Latest implementation handoff:

- `_bmad-output/implementation-artifacts/handoff-2026-09-07-first-immutable-report-snapshot-delivery.md`

Current program state:

- Grill discovery and the 47-requirement product contract are complete.
- Phase 0 and Phase 1 are complete.
- Phase 2 is complete locally; disclosure and confirmation lifecycle work is production-verified.
- Phase 3 is in progress; persisted cohort scope, cycle opening, transfer rollover, active-member uniqueness, first immutable report snapshot/delivery lifecycle, later intermediate snapshot version gating, final one-message cycle aggregation, cycle-close expiry of unconfirmed temporary working insights, and retention cleanup are complete locally.
- Phase 5 dashboard isolation is complete locally: the internal dashboard, named employee admin routes, and manager-labelled admin trends route fail closed unless `INTERNAL_DASHBOARD_ENABLED=true` or `1`.
- Final deterministic local verification is complete.
- A delivery-time invalid snapshot is cancelled without regeneration in the same worker attempt; only a later explicit report trigger may create a replacement.
- An ambiguous Slack result becomes `delivery_unknown`; automatic retries and later snapshots for the same tenant/cohort/Pulse Index remain blocked until explicit reconciliation.
- Pre-send TypeScript validation failure cancels the snapshot; a Slack receipt with an external message ID marks it delivered; any exception after sending begins becomes `delivery_unknown`. No Slack provider taxonomy is added in this slice.
- A snapshot freezes its exact `(workspaceConnectionId, managerSlackUserId)` target; a changed binding cancels it, never retargets it, and requires a later explicit trigger for a new snapshot.
- The first snapshot is persisted only after AI returns; TypeScript revalidates, atomically inserts the completed payload and provenance under a database unique key, and only the insertion winner may call Slack. No pre-AI `generating` state is added.
- `survey:cycle:close` finds cohorts whose immutable `periodEnd` is at or before the close instant, expires unconfirmed temporary `survey_group_states`, and enqueues one final `GROUP_REPORT` job per cohort. The worker evaluates the five Pulse Indices through the existing report use case, omits ineligible indices, and sends one consolidated final manager message only when at least one index is eligible. The existing snapshot lifecycle blocks duplicate final cycle delivery per cohort.
- Numeric engagement is complete locally: engagement questions are eligible only during `[periodEnd - 14 calendar days, periodEnd)`, evidence extraction excludes engagement outside that interval, only explicit integer 1-10 values are accepted, assessment scores persist those values, and employee/team engagement scores use equal-weight 1-10 averages with one-decimal dashboard display.
- Same-index pulse prioritization is complete locally: when reactive or proactive evidence covers a question, remaining pending questions from that same Pulse Index move ahead of other pending questions while preserving their relative order.
- Skipped-topic pulse policy is complete locally: pending questions from a group with an unresolved active probe are not selected, and ignored groups are moved behind other pending topics after stale no-evidence replies.
- Retention cleanup is complete locally: `retention:cleanup` resolves active tenant policies, applies message/evidence/memory/risk/group-state/audit/snapshot cutoffs idempotently, and supports optional `TENANT_ID` scoping. The script has not been run against a live database in this slice.
- Final local gates passed outside the sandbox: `pnpm run prepush:non-maf` and `pnpm exec dotenv -e .env -- pnpm test:integration` with 25 executed database integration tests.
- Manager-of-Managers roll-up, HR/HRBP reporting, and the released customer manager/HR surface and auth model remain deferred.
- Live Slack, production smoke, deploy, push, and PR actions remain unrun and require explicit authorization.

The dated Phase 2 and Slack handoffs remain historical evidence of completed slices.
