---
title: 'Slack Display Name Backfill Safety'
type: 'refactor'
created: '2026-08-12T00:00:00+02:00'
status: 'done'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** The Slack display-name backfill script is a production-facing repair tool, but it currently defaults to `DEFAULT_TENANT_ID`, writes immediately, has no bounded scope controls, and does not leave an audit record for applied changes.

**Approach:** Make the tool fail-closed by default: require explicit tenant selection, run as dry-run unless an apply flag is set, support narrow filters/limits, scope updates to the exact Slack workspace account, and append a safe audit summary when changes are applied.

## Boundaries & Constraints

**Always:** `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`, and explicit `TENANT_ID` must be required. Dry-run must perform no database writes. Apply mode must require `BACKFILL_SLACK_DISPLAY_NAMES_APPLY=1`. Updates must target `tenantId + userId + channelType + externalWorkspaceId + externalUserId`. Output and audit metadata must not include Slack bot tokens or raw decrypted credentials.

**Ask First:** Any change that adds a public admin endpoint, changes profile hydration queue behavior, or updates production data without the explicit apply flag.

**Never:** Do not use `DEFAULT_TENANT_ID` as an implicit tenant. Do not update every Slack account for a user across workspaces. Do not store Slack profile email/avatar details in audit metadata.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dry-run default | Required env is present, apply flag absent | Fetch profiles, print planned actions, do not update `channel_accounts`, `users`, or `audit_logs` | Missing Slack token/profile is reported as skipped |
| Explicit apply | `BACKFILL_SLACK_DISPLAY_NAMES_APPLY=1` | Apply planned display-name/profile updates and append one audit summary row | Per-account failures are counted and process exits non-zero |
| Missing tenant | `TENANT_ID` absent but `DEFAULT_TENANT_ID` present | Script exits before DB connection | Error states that explicit `TENANT_ID` is required |
| Multi-workspace user | Same user has multiple Slack accounts | Only the matched workspace/account row is updated | Other workspace rows remain untouched |

</frozen-after-approval>

## Code Map

- `scripts/backfill-slack-display-names.ts` -- production repair script to harden.
- `scripts/backfill-slack-display-names.test.ts` -- focused CLI safety and planning tests.
- `package.json` -- root test command must include the script safety tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the deferred hardening item done after verification.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/backfill-slack-display-names.ts` -- add explicit env parsing, dry-run/apply mode, filters, exact account update scope, safe summary output, and apply-mode audit logging.
- [x] `scripts/backfill-slack-display-names.test.ts` -- cover missing tenant, dry-run no writes, exact workspace scope, and audit metadata redaction.
- [x] `package.json` -- include script tests in the root test command so pre-push catches regressions.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the backfill hardening item done.

### Review Findings

- [x] [Review][Patch] Apply-mode DB updates and audit insert were not transactional; fixed by applying updates and appending audit inside one DB transaction.
- [x] [Review][Patch] Exact channel-account update success was assumed; fixed by requiring the update to return exactly one row before optional user preferred-name write.
- [x] [Review][Patch] Credential decrypt/JSON failures were swallowed as missing token; fixed by failing the run with a sanitized operational error.
- [x] [Review][Patch] Audit metadata retained per-user action details and possible PII; fixed by storing counts, filters, and sanitized failure samples only.
- [x] [Review][Patch] Fatal errors and operational reasons had incomplete redaction; fixed by sanitizing top-level errors, broader Slack token shapes, Bearer values, and email-like values.
- [x] [Review][Patch] Tests did not explicitly cover exact account scope and audit summary privacy; fixed with focused helper tests.

**Acceptance Criteria:**
- Given only `DEFAULT_TENANT_ID`, when the script starts, then it fails before connecting to the database.
- Given apply flag is absent, when eligible Slack profiles are resolved, then no update/audit write is executed and output marks actions as planned.
- Given apply flag is present, when an account is updated, then the `channel_accounts` update includes tenant, user, channel type, external workspace, and external user predicates.
- Given apply flag is present, when the run completes, then one audit row summarizes counts and filters without tokens, decrypted credentials, email addresses, or avatar URLs.

## Spec Change Log

## Verification

**Commands:**
- `pnpm typecheck` -- passed.
- `pnpm run test:scripts` -- passed outside sandbox; sandboxed `tsx` fails on IPC pipe permission (`EPERM`).
- `pnpm lint` -- passed.
- `pnpm test` -- passed outside sandbox; includes script safety tests.
