---
title: 'Dashboard Production Verification Workflow'
type: 'chore'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3e94b8fbc767cdc1cfbb638c7a3229ac764e1231'
context:
  - '{project-root}/docs/superpowers/railway-deploy.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-production-dashboard-verifier.md'
---

<frozen-after-approval reason="human-owned intent -- do not modify unless human renegotiates">

## Intent

**Problem:** The production dashboard verifier exists, but it is still run manually from a local machine where DNS/network behavior can make the result noisy. We need a GitHub-hosted regression workflow so production dashboard health, display-name, and dynamic rendering invariants are checked from CI after deploy.

**Approach:** Add a GitHub Actions workflow that installs project dependencies, waits for the Railway auto-deploy window when triggered by a `main` push, and runs the existing `pnpm run dashboard:prod:verify` script with GitHub secrets and variables.

## Boundaries & Constraints

**Always:** Reuse `scripts/verify-production-dashboard.ts`; keep `ADMIN_API_KEY` secret-only; make automatic push execution opt-in via repo variable; allow manual `workflow_dispatch`; use existing Node/pnpm setup patterns; avoid printing secrets.

**Ask First:** Do not add or rotate GitHub secrets, Railway tokens, or production tenant IDs through code. Do not introduce manual Railway deployment orchestration in this workflow.

**Never:** Do not hard-code production admin secrets. Do not duplicate verifier logic in YAML. Do not make normal PR CI depend on live production availability.

## I/O & Edge-Case Matrix

| Scenario        | Input / State                                                             | Expected Output / Behavior                                              | Error Handling                                       |
| --------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Manual run      | Maintainer starts `workflow_dispatch` with required secrets present       | Workflow runs verifier against configured production API/dashboard URLs | Fails with the verifier's invariant-specific message |
| Push gated off  | Push to `main` and `DASHBOARD_PROD_VERIFY_ENABLED` is unset/not `1`       | Workflow job is skipped                                                 | No CI failure                                        |
| Push gated on   | Push to `main`, variable enabled, secrets present                         | Workflow waits configured seconds, then verifies production             | Fails if live production breaks dashboard invariants |
| Missing secrets | Workflow runs without `DASHBOARD_ADMIN_API_KEY` or tenant variable/secret | Verifier exits non-zero before any privileged checks                    | Failure names the missing env var, no secret printed |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` -- Existing Node/pnpm GitHub Actions setup pattern.
- `.github/workflows/maf-production-regression.yml` -- Existing safe-by-default production regression workflow with manual and gated push execution.
- `scripts/verify-production-dashboard.ts` -- Existing production verifier to reuse unchanged unless CI ergonomics require a small fix.
- `package.json` -- Existing `dashboard:prod:verify` script entrypoint.
- `docs/superpowers/railway-deploy.md` -- Production deploy rules: GitHub auto-deploy is primary; manual Railway deploy is fallback only.

## Tasks & Acceptance

**Execution:**

- [x] `.github/workflows/dashboard-production-verify.yml` -- Add safe-by-default workflow for manual and gated post-push production dashboard verification.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Mark external GitHub dashboard regression workflow as completed or add any remaining repo-configuration follow-up.
- [x] `_bmad-output/implementation-artifacts/spec-dashboard-production-verification-workflow.md` -- Record implementation and verification results.

**Acceptance Criteria:**

- Given a maintainer manually runs the workflow with configured secrets, when the job reaches the verify step, then it executes `pnpm run dashboard:prod:verify`.
- Given a push to `main` with `DASHBOARD_PROD_VERIFY_ENABLED` not equal to `1`, when the workflow evaluates its job condition, then it skips without failing CI.
- Given a push to `main` with `DASHBOARD_PROD_VERIFY_ENABLED=1`, when the wait window finishes, then the workflow verifies the current production dashboard.
- Given the workflow logs are inspected, when secrets are present, then no admin key is printed by YAML or the verifier.

## Design Notes

Use the same safe-by-default shape as `.github/workflows/maf-production-regression.yml`: `workflow_dispatch` is available only from `main`, while push-triggered execution is guarded by a repo variable. Push-triggered verification uses Railway CLI only to poll auto-deploy status for the current GitHub SHA; it does not run a manual deployment.

Secrets and variables expected in GitHub:

```text
secrets.DASHBOARD_ADMIN_API_KEY
secrets.RAILWAY_TOKEN
secrets.RAILWAY_PROJECT_ID
vars.DASHBOARD_PROD_TENANT_ID or secrets.DASHBOARD_PROD_TENANT_ID
vars.DASHBOARD_PROD_VERIFY_ENABLED=1
```

Optional variables:

```text
vars.DASHBOARD_PROD_API_BASE
vars.DASHBOARD_PROD_BASE
vars.DASHBOARD_PROD_VERIFY_WAIT_SECONDS
vars.DASHBOARD_PROD_VERIFY_TRENDS_DAYS
```

## Verification

**Commands:**

- `pnpm typecheck` -- TypeScript graph remains valid.
- `pnpm lint` -- Workflow-adjacent repo lint remains valid.
- `pnpm test` -- Existing script/API tests remain valid.
- `git diff --check` -- No whitespace errors.

**Results:**

- `ruby -e "require 'psych'; Psych.load_file('.github/workflows/dashboard-production-verify.yml'); puts 'yaml ok'"` -- passed.
- `pnpm exec prettier --check .github/workflows/dashboard-production-verify.yml _bmad-output/implementation-artifacts/spec-dashboard-production-verification-workflow.md _bmad-output/implementation-artifacts/deferred-work.md` -- passed after formatting the spec markdown.
- `pnpm typecheck` -- passed.
- `pnpm lint` -- passed.
- `pnpm test` -- passed.
- `git diff --check` -- passed.
- `pnpm dlx actionlint .github/workflows/dashboard-production-verify.yml` -- not available via npm package binary (`ERR_PNPM_DLX_NO_BIN`); GitHub will still validate workflow syntax on push.

## Review Notes

**BMAD adversarial review completed:** Blind Hunter and Edge Case Hunter reviewed the workflow change from baseline commit `3e94b8f`.

**Resolved in this slice:**

- Replaced fixed push-delay-only verification with Railway polling that waits for `api` and `dashboard` deployments to reach `SUCCESS` for the current `GITHUB_SHA`.
- Added workflow-level validation for manual wait seconds, trend days, and tenant UUID.
- Added `environment: production` and a `github.ref == 'refs/heads/main'` manual-dispatch guard so production secrets are not exposed to branch-modified workflow code.

**Deferred / external configuration:**

- Automatic push execution remains gated until GitHub repo secrets and variables are configured.

## Suggested Review Order

**Workflow Boundary**

- Entry point: safe manual plus gated push execution.
  [`dashboard-production-verify.yml:24`](../../.github/workflows/dashboard-production-verify.yml#L24)

- Production secrets stay restricted to main/protected environment.
  [`dashboard-production-verify.yml:28`](../../.github/workflows/dashboard-production-verify.yml#L28)

**Deploy Readiness**

- Push runs install Railway CLI only for deploy polling.
  [`dashboard-production-verify.yml:43`](../../.github/workflows/dashboard-production-verify.yml#L43)

- Polls Railway for current SHA before verifier runs.
  [`dashboard-production-verify.yml:67`](../../.github/workflows/dashboard-production-verify.yml#L67)

**Verifier Inputs**

- Validates secret presence, tenant UUID, and trend window.
  [`dashboard-production-verify.yml:113`](../../.github/workflows/dashboard-production-verify.yml#L113)

- Reuses the existing production verifier script.
  [`dashboard-production-verify.yml:132`](../../.github/workflows/dashboard-production-verify.yml#L132)

**Follow-Up**

- Records GitHub repo configuration still required.
  [`deferred-work.md:64`](./deferred-work.md#L64)
