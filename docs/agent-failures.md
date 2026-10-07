# Agent Failure Log

Use this file to turn agent misses into harness improvements.

## Template

```md
## YYYY-MM-DD: short title
- Symptom:
- Expected:
- Root cause layer: instructions | context | architecture | verification | environment | workflow | tooling
- Harness fix:
- Regression check:
- Status: open | fixed | obsolete
```

## Open Failures

## 2026-09-26: default local database lacks hierarchy migration

- Symptom: A read-only local tenant inventory that included `people` failed because the existing `entalent` database has not received the hierarchy migrations.
- Expected: Inventory commands should identify schema readiness before querying new hierarchy tables.
- Root cause layer: environment
- Harness fix: Use the separate fully migrated `entalent_hierarchy_acceptance` database for integration acceptance; query legacy-only tables when inspecting the untouched default database.
- Regression check: Check `to_regclass('public.people')` and migration status before new-schema inventory; verify integration commands target the named acceptance database.
- Status: fixed

## 2026-09-26: hand-built backfill SQL fixture omitted Drizzle columns

- Symptom: The first synthetic backfill apply attempts failed because the temporary `audit_logs` and `org_units` tables omitted standard columns emitted by Drizzle inserts.
- Expected: A transaction check should exercise the intended backfill behavior with a schema matching the application.
- Root cause layer: verification
- Harness fix: Added full-schema local rollout integration coverage and ran backfill acceptance against the complete pgvector-capable migration chain instead of the abbreviated fixture.
- Regression check: On an isolated migrated PostgreSQL database, run reconciliation, dry-run, apply, and repeat apply; verify zero dry-run writes, one approved graph, and zero repeat inserts. Run `DATABASE_URL=<local-isolated-db> pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-rollout.integration.test.ts` for transactional rollout.
- Status: fixed

## 2026-09-25: required harness commands attempted dependency installation

- Symptom: Both `pnpm exec tsx scripts/agent-harness.ts reflection` and `pnpm harness:check -- --base origin/main` found no local dependencies, started a workspace install, and entered repeated npm registry retries that could not resolve in the managed network environment.
- Expected: Required reflection and final harness commands should use already provisioned tooling and must not mutate or install the workspace before a documentation-only task.
- Root cause layer: environment
- Harness fix: Provision workspace dependencies before the task or provide a dependency-independent reflection launcher that fails fast when its runtime is absent.
- Regression check: Run reflection and `harness:check` in a clean checkout with network disabled; each must produce its artifact or a clear no-runtime diagnostic without invoking `pnpm install`.
- Status: open

## 2026-09-18: local dashboard production verifier lacked the admin key

- Symptom: `pnpm dashboard:prod:verify` stopped before network access with `ADMIN_API_KEY is required` because the local `.env` does not contain the production dashboard credential.
- Expected: Production dashboard verification should use the target service environment without printing or copying secrets into the local shell.
- Root cause layer: environment
- Harness fix: When the local key is absent, run the existing read-only verifier through `railway run --service dashboard --environment production --`.
- Regression check: The Railway-backed rerun passes API health, manager team/trends, and all dashboard routes.
- Status: fixed

## 2026-09-08: production survey cycle open script rejects Date values

- Symptom: `railway run --service api -- ... pnpm exec tsx scripts/open-survey-reporting-cycle.ts` failed with `The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`.
- Expected: The production open-cycle helper should create a reporting cohort using the same Date inputs accepted by the application use case and Drizzle schema.
- Root cause layer: tooling
- Harness fix: Add a focused script regression or adjust the helper/repository boundary so production `survey:cycle:open` serializes timestamp inputs consistently.
- Regression check: `TENANT_ID=<tenant> SURVEY_DEFINITION_ID=<definition> CONFIRM_SURVEY_CYCLE_OPEN=<tenant> SURVEY_PERIOD_START=<iso> SURVEY_PERIOD_END=<iso> SURVEY_OPENED_AT=<iso> pnpm exec tsx scripts/open-survey-reporting-cycle.ts`
- Status: open

## 2026-09-08: terse style adaptation still asks a question every turn

- Symptom: Post-Grill `terse-user` scenario failed twice because the follow-up conversation produced question counts `1, 1, 1, 1`; the code comment says terse style should ask only every other turn, but `applyTerseStyle()` only shortens the response.
- Expected: A learned terse style should keep a normal colleague tone while allowing at least one short statement-only reply instead of interrogating every terse acknowledgement.
- Root cause layer: architecture
- Harness fix: Enforce question pacing in the shared reply strategy/plan boundary for confident terse profiles, not in scenario-specific prompt wording.
- Local fix: `applyTerseStyle()` now uses the already-loaded user-turn count to keep questions only on odd terse turns; focused orchestrator regressions and the live pacing assertions pass.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts`
- Status: fixed

## 2026-09-08: exact Annna replay still re-enters rejected pulse/report framing

- Symptom: Post-Grill `annna-intent-fidelity` failed twice: one gate sample kept answering with reporting disclosure after the user asked for chatbot-answer criteria, and the repeat classified the `No, you keep circling` correction turn as `closing` instead of `correction`.
- Expected: Consultation requests about another chatbot should be answered directly; when the employee rejects the prior frame, the corrected request should control the response and stale pulse/report assumptions should stay out.
- Root cause layer: architecture
- Harness fix: Narrow the reporting-disclosure route and harden latest-turn correction normalization/classification for mixed rejection-plus-request messages.
- Local fix: Provider normalization now accepts reporting-question evidence only from the raw latest user message, preserves explicit Russian reporting questions, and promotes mixed rejection requests misclassified as `closing` to `correction`; focused AI/application regressions and the final live sample pass.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/annna-intent-fidelity.sim.test.ts`
- Status: fixed

## 2026-09-08: scenario reports mark deterministic checks clear before post-report assertions

- Symptom: `memory-recall`, `terse-user`, and `annna-intent-fidelity` markdown reports show `Deterministic checks all clear` even though later test assertions fail the same scenario.
- Expected: Scenario artifacts should include post-report hard assertion failures so a failed gate cannot look clean when read from the per-scenario report.
- Root cause layer: verification
- Harness fix: Move scenario hard assertions into the reported deterministic check path or append assertion failures to the report before the test exits.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/memory-recall.sim.test.ts`
- Status: open

## 2026-09-03: BMad config resolver called without project root

- Symptom: `resolve_config.py` exited with a required `--project-root` argument error.
- Expected: BMad configuration resolves before planning the implementation slice.
- Root cause layer: tooling
- Harness fix: Use `python3 _bmad/scripts/resolve_config.py --project-root "$PWD"` and the customization resolver command from the skill.
- Regression check: Both resolver commands exit zero before creating the next spec.
- Status: fixed

## 2026-09-03: Local PostgreSQL check blocked by sandbox socket policy

- Symptom: the first Docker status and localhost database test attempts returned permission errors.
- Expected: approved local integration verification reaches the existing Postgres container.
- Root cause layer: environment
- Harness fix: Run read-only Docker status and local integration tests with the required sandbox escalation, without changing container state.
- Regression check: `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration`
- Status: fixed

## 2026-09-03: Index inspection used unsafe shell quoting

- Symptom: the first ad hoc PostgreSQL index query was parsed incorrectly before the successful schema check.
- Expected: inspect the generated active-confirmation index without shell interpolation errors.
- Root cause layer: tooling
- Harness fix: Pass inspection SQL through a quoted heredoc or a migration-aware test instead of nested command-line quoting.
- Regression check: the integration test asserts staged-candidate uniqueness directly.
- Status: fixed

## 2026-09-03: ambiguous one-line patch changed the wrong test fixture
- Symptom: A patch intended for the acknowledgement assertion matched the first `topicAnchor: null` in the file and changed the shared base fixture; the targeted test stayed red.
- Expected: The patch should update only the assertion inside `passes acknowledgement dialogue state to response generation`.
- Root cause layer: tooling
- Harness fix: Include the enclosing test or assertion context when patching repeated literals, then inspect the focused file diff before running tests.
- Regression check: `git diff -- packages/application/src/use-cases/conversation-orchestrator.test.ts` must show only the intended assertion line before the targeted test runs.
- Recurrence: On 2026-09-05 an unscoped status-line patch changed the first failure entry; it was immediately corrected with heading-scoped context.
- Status: fixed

## 2026-09-03: GitHub PR metadata refresh blocked by network
- Symptom: Two consecutive `gh pr view 5 --repo serzhlukasohov/entallent-v2` refreshes failed with `error connecting to api.github.com` after the PR metadata had been captured earlier in the audit.
- Expected: A read-only PR metadata refresh should return the current branch, file, review, and check state.
- Root cause layer: environment
- Harness fix: Treat an earlier captured PR snapshot as evidence for the same audit run, report that the final live refresh was unavailable, and avoid repeated retries without a network-state change.
- Regression check: Run one `gh pr view 5 --repo serzhlukasohov/entallent-v2 --json state,headRefName,baseRefName,statusCheckRollup`; retry only after connectivity changes.
- Status: open

## 2026-09-03: acknowledgement reply-plan test contradicts its fixture
- Symptom: `pnpm test` fails because the acknowledgement fixture sets `topicAnchor` to `the release shipped over the weekend` while the assertion expects `topicAnchor: null`.
- Expected: The test should assert the intended typed plan and agree with the fixture and renderer pause behavior.
- Root cause layer: verification
- Harness fix: Correct the stale assertion or explicitly normalize acknowledgement anchors in `buildReplyPlan`, then keep one focused regression for the chosen behavior.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts -t "passes acknowledgement dialogue state"`
- Status: fixed

## 2026-09-03: root integration command silently drops database environment
- Symptom: `pnpm exec dotenv -e .env -- pnpm test:integration` exits successfully while all database tests are skipped because Turbo does not pass `DATABASE_URL` to the package task.
- Expected: With a local database URL present, the documented root command should execute the integration tests or fail clearly.
- Root cause layer: workflow
- Harness fix: `turbo.json` declares `DATABASE_URL` for `test:integration`, so package integration tests receive the database URL.
- Regression check: `pnpm exec dotenv -e .env -- pnpm test:integration` must report 25 executed tests, not 25 skipped.
- Status: fixed

## 2026-08-19: TS quality gate misclassifies repeated memory assertion
- Symptom: Story 11.2 made `terse-user` pass hard/judge, but `memory-recall` again failed its required-grounding assertion and the console again mislabeled the product assertion as `infra_failed`, causing an unnecessary retry.
- Expected: The gate should report the memory assertion as a hard product failure without an infrastructure retry; turn-taking scenarios should remain green.
- Root cause layer: verification
- Harness fix: Classify scenario assertion failures separately from model/network failures in the gate runner; address memory grounding in its own story rather than expanding Story 11.2.
- Regression check: `SIM_GATE_RUNS=1 pnpm sim:gate`
- Recurrence: On 2026-09-08 post-Grill verification, `memory-recall` reproduced twice: final replies remembered the payments-architecture defense, but `requiredGrounding` was empty.
- Harness fix: Require the planner's highest-priority memory anchor for unanchored emotional support; the focused unit regression and live Azure OpenAI/LangWatch scenario pass.
- Status: fixed

## Obsolete / Retired Failures

These entries are retained as historical evidence but are not active work because MAF and `agent-service` are no longer supported.

## 2026-08-19: packaged Python runtime schema drifted from canonical OpenAPI
- Symptom: `test_python_service_packages_shared_runtime_openapi_schema` fails because the packaged Python schema omits `greeting_opens_conversation`.
- Expected: The deployable Python artifact must exactly match `packages/contracts/runtime/openapi.json`.
- Root cause layer: workflow
- Harness fix: Keep the packaged schema synchronized whenever the canonical runtime schema changes.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_runtime_contract.py -q`
- Status: fixed

## 2026-08-20: Model-provider mypy baseline is not clean
- Symptom: Whole-file mypy reports three pre-existing errors at lines 721, 782, and 857 outside the engagement diff.
- Expected: Typed runtime verification should distinguish new errors from baseline debt.
- Root cause layer: verification
- Harness fix: None planned; do not spend current verification effort on the retired model-provider path.
- Regression check: Not active while MAF and `agent-service` remain unsupported.
- Status: obsolete

## 2026-09-03: BMad resolver scripts have different CLI contracts

- Symptom: `resolve_config.py` required `--project-root`, while passing that same flag to `resolve_customization.py` failed as an unknown argument.
- Expected: Resolve BMad config and skill customization without trial-and-error invocations.
- Root cause layer: workflow
- Harness fix: Call `resolve_config.py --project-root <root>` and run `resolve_customization.py --skill <path> --key workflow` from the project root.
- Regression check: Run both commands before entering the selected BMad workflow step.
- Status: fixed

## 2026-09-03: Worker SQL test read stale database declarations

- Symptom: A focused worker repository test compiled malformed SQL until `@entalent/database` was rebuilt after schema changes.
- Expected: Consumer tests resolve current workspace schema declarations.
- Root cause layer: workflow
- Harness fix: Build changed producer packages before running focused consumer tests.
- Regression check: `pnpm --filter @entalent/database build` before worker repository verification.
- Status: fixed

## 2026-09-03: Review agents failed after writing edits

- Symptom: Two REQ-015 agents ended with local `404 /v1/responses`, so they could not return their final reports although their filesystem edits remained.
- Expected: Agent completion returns both edits and a reviewable result.
- Root cause layer: tooling
- Harness fix: Treat the shared worktree as authoritative, inspect the diff locally, then restart failed agents for read-only review.
- Regression check: `collaboration.list_agents` followed by local `git diff` before reassigning failed work.
- Status: fixed

## 2026-09-03: Focused simulation command ran the full live suite

- Symptom: `pnpm --filter @entalent/conversation-sim sim -- <file>` passed an extra separator to Vitest, ran live scenarios, and hit blocked model/network calls.
- Expected: Run only the deterministic receipt regression.
- Root cause layer: workflow
- Harness fix: Use `pnpm --filter @entalent/conversation-sim exec vitest run <file>` for focused simulation tests.
- Regression check: Output must list only the requested test file.
- Status: fixed

## 2026-09-03: Local integration test blocked by sandbox network policy

- Symptom: The first local Postgres run failed with `connect EPERM` to `localhost:5434` despite the database being available.
- Expected: Execute migration and constraint tests against the confirmed local database.
- Root cause layer: environment
- Harness fix: Verify the redacted database target, then rerun the same test with local network escalation.
- Regression check: `pnpm --filter @entalent/database test:integration` reports executed tests rather than connection errors or skips.
- Status: fixed

## 2026-09-03: Simulation TypeScript target lacks Array.findLast

- Symptom: Root typecheck rejected `MessageRecord[].findLast` in the simulation receipt fake.
- Expected: The deterministic fake compiles under the repository's ES2022 target.
- Root cause layer: architecture
- Harness fix: Use the existing array APIs supported by ES2022.
- Regression check: `pnpm --filter @entalent/conversation-sim typecheck`.
- Status: fixed

## Fixed Failures

## 2026-09-26: onboarding delivery projection test lagged new receipt fields

- Symptom: Focused worker tests failed because the outbound delivery projection assertion omitted the newly selected Slack receipt and onboarding binding fields.
- Expected: The repository test should verify the fields consumed by the sender after the projection changes.
- Root cause layer: verification
- Harness fix: Update the projection assertion alongside the sender's required fields and keep the focused repository test in the worker check.
- Regression check: `pnpm --filter @entalent/worker test -- src/conversation/repositories/conversation.repository.test.ts`
- Status: fixed

## 2026-09-07: Homebrew Node drift left active node linked to a removed dylib

- Symptom: After installing `node@24`, active Homebrew `node` still pointed at `node` 25.2.1 and failed with `Library not loaded: /opt/homebrew/opt/simdjson/lib/libsimdjson.29.dylib`.
- Expected: The repo shell uses a working Node 24 runtime matching CI before running pnpm/tsx gates.
- Root cause layer: environment
- Harness fix: Add `.node-version`/`.nvmrc`, install `node@24`, and link Homebrew to `node@24` so `node`, `npm`, and `corepack` resolve to the CI major.
- Regression check: `node -v`, `pnpm -v`, and `pnpm run agent:preflight`.
- Status: fixed

## 2026-09-07: Full prepush aggregates a MAF script under non-MAF task boundaries

- Symptom: `pnpm prepush` passed typecheck, lint, and package tests, then reached `test:scripts`; rerunning `pnpm test:scripts` outside the sandbox was rejected because the aggregate includes `scripts/live-maf-primary-app-smoke.test.ts` while the task explicitly prohibited MAF and agent-service work.
- Expected: A non-MAF implementation slice should have a deterministic prepush-equivalent gate that does not execute MAF smoke scripts.
- Root cause layer: workflow
- Harness fix: Split `test:scripts` into MAF and non-MAF script-test commands, add `prepush:non-maf`, and add `agent:preflight` so scoped verification does not cross MAF boundaries.
- Regression check: `pnpm run agent:preflight` and `pnpm run prepush:non-maf`.
- Status: fixed

## 2026-09-07: Parallel BMad memlog appends race on a shared temp file

- Symptom: Two concurrent `memlog.py append` calls to the same workspace caused one append to fail with `.memlog.md.tmp` missing during `os.replace`.
- Expected: BMad decision logging should be append-only and reliable.
- Root cause layer: tooling
- Harness fix: Never run multiple `memlog.py append` calls for the same workspace in parallel; append sequentially.
- Regression check: BMad spec self-validation entries are appended one at a time.
- Status: fixed

## 2026-09-05: confirmation summary label leaked into Slack text

- Symptom: Real Slack confirmation prompt displayed the internal `confirmationSummary:` field label before the employee-facing summary.
- Expected: The employee sees only natural confirmation copy, while `metadata.confirmationSummary` remains available for exact-summary persistence.
- Root cause layer: architecture
- Harness fix: Reject label-bearing confirmation drafts at the OpenAI provider validation boundary and fail closed in the orchestrator if any provider returns one.
- Regression check: `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts` and `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`.
- Status: fixed

## 2026-09-03: channel-slack package has no Vitest dependency

- Symptom: The first Slack timestamp regression used Vitest and package typecheck could not resolve the import.
- Expected: A package-local timestamp check runs with declared dependencies.
- Root cause layer: tooling
- Harness fix: Use Node's built-in `node:test` and `node:assert` for the two adapter checks.
- Regression check: `node --import tsx --test packages/channel-slack/src/slack.adapter.test.ts`
- Status: fixed

## 2026-08-24: GitHub auth/permission unavailable for PR creation
- Symptom: `git push -u origin codex/grill-session-docs` failed with `could not read Username for 'https://github.com': Device not configured`; SSH push failed with `Permission denied (publickey)`; `gh` was not installed. Reproduced on 2026-09-02 after GitHub CLI auth was configured: account `yjinia` was authenticated, but push to `serzhlukasohov/entallent-v2` was denied with HTTP 403.
- Expected: A requested PR should be pushed and opened from the local branch.
- Root cause layer: environment
- Harness fix: Configure GitHub auth for an account with write access to the repo, grant `yjinia` write access, or push to a fork and open a cross-repo PR.
- Regression check: `git push -u origin <branch>` with the intended account or authenticated PR creation through the GitHub connector.
- Status: fixed on 2026-09-02 after repo write access was granted; push and PR creation succeeded.

## 2026-08-21: npx unavailable for skill install command
- Symptom: `npx skills add https://github.com/mattpocock/skills --skill grill-with-docs` failed with `zsh:1: command not found: npx`.
- Expected: A user-provided skill install command should either run directly or have a documented fallback.
- Root cause layer: environment
- Harness fix: Use the preinstalled skill-installer helper script to install GitHub skills when Node/npm shims are unavailable.
- Regression check: `python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo mattpocock/skills --path skills/grill-with-docs`
- Status: fixed

## 2026-08-20: TSX IPC socket blocks full pre-push inside sandbox
- Symptom: `pnpm prepush` passed monorepo typecheck, lint, and package tests, then `test:scripts` failed with `listen EPERM` for the TSX IPC socket.
- Expected: Complete script-test verification despite the sandbox IPC restriction.
- Root cause layer: environment
- Harness fix: Rerun the scoped `pnpm test:scripts` check outside the sandbox when TSX IPC is denied; the outside-sandbox verification passed.
- Regression check: `pnpm test:scripts`
- Status: fixed

## 2026-08-29: Initial autonomous harness review found boundary gaps
- Symptom: Independent review found that shallow/default diffs could miss committed retired changes, overrides were not receipted, malformed preflight had no receipt, and generated repair branches could recurse or validate with a self-modified harness.
- Expected: Every changed path and automation revision must stay inside the approved deterministic, retired-surface, connector, and human-review boundaries.
- Root cause layer: workflow
- Harness fix: Pin complete/source revisions, use merge-base and no-renames, validate trusted copied harness code, record safe override/path evidence, block recursive repairs, and keep connector/model-provider guards aligned.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts`, workflow YAML parse, and manual workflow permission/guard inspection.
- Status: fixed

## 2026-08-29: Workflow YAML smoke used a newer Psych option
- Symptom: The first local YAML parse failed because system Ruby 2.6 does not support `YAML.load_file(..., aliases: true)`.
- Expected: The dependency-free workflow syntax smoke should run on the repository host Ruby.
- Root cause layer: tooling
- Harness fix: Use the compatible plain `YAML.load_file(file)` call; these workflows do not use YAML aliases.
- Regression check: `ruby -e "require 'yaml'; ARGV.each { |f| YAML.load_file(f) }" .github/workflows/*.yml`
- Status: fixed

## 2026-08-20: Local Slack connector smoke blocked by sandbox infra limits
- Symptom: API/worker dev processes fail to start (`AggregateError ... connect EPERM ... 127.0.0.1:5432/6380`) and `curl /api/v1/channel/slack/events` returns `000` because local services are unreachable in this environment.
- Expected: A signed Slack event should be accepted and processed, producing conversation queue work and outbound commit metadata.
- Root cause layer: environment
- Harness fix: `pnpm harness:preflight` now verifies safe PostgreSQL/Redis host-port targets and blocks before connector payloads.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts`
- Status: fixed

## 2026-08-19: TS quality gate misclassifies scenario assertions
- Symptom: A scenario assertion containing network/timeout wording was mislabeled `infra_failed` and retried.
- Expected: A report or assertion is a hard product failure; only report-free transport failures retry.
- Root cause layer: verification
- Harness fix: Route the gate through the pure report-first failure classifier.
- Regression check: `pnpm --filter @entalent/conversation-sim test -- src/gate/failure-classifier.test.ts`
- Status: fixed

## 2026-08-28: Mixed rejection plus request escaped correction policy
- Symptom: One exact Annna sample classified `No, you keep circling` plus the corrected criteria request as `request`, allowing an unnecessary rubric offer after the direct answer.
- Expected: An explicit rejection controls response shape even when the same message contains a new request: answer it directly, ask zero questions, and stop.
- Root cause layer: architecture
- Harness fix: Add a classifier example and a deterministic provider-boundary normalization for unambiguous rejection-prefixed requests; keep the exact scenario strict on `correction`, zero questions, and no extra offer.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts prompts/classify.test.ts prompts/respond.test.ts` plus turn 13 of the exact Annna scenario.
- Status: fixed

## 2026-08-28: Explicit `No, forget` varied into acknowledgement
- Symptom: The third exact Annna sample classified the final `No, forget` as `acknowledgement`, reopened the discussion, and asked another question.
- Expected: Unambiguous stop phrases must always become typed `closing` with no topic anchor, follow-up, or additional offer.
- Root cause layer: architecture
- Harness fix: Normalize bounded explicit stop phrases at the provider boundary to `closing` while preserving safety fields; keep the scenario's closing-plan and zero-question assertions.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus turn 15 of the exact Annna scenario.
- Status: fixed

## 2026-08-28: Exact evaluator rejected valid correction wording
- Symptom: Hard assertions rejected valid acknowledgements such as `overreading`, `earlier read was too far off`, and `over-reading`; the post-fix judge also explicitly said no third-person violation was visible but still marked that binary criterion false.
- Expected: The evaluator should accept semantically equivalent admissions and use deterministic checks for exact pronoun constraints without weakening the required correction, direct answer, or no-circling contracts.
- Root cause layer: verification
- Harness fix: Expand only the acknowledgement-synonym matcher, move the no-third-person criterion to a deterministic assertion across all 15 coach replies, and retain typed-plan, content, question, stale-frame, memory, and closing assertions.
- Regression check: `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/annna-intent-fidelity.sim.test.ts`
- Status: fixed

## 2026-08-28: Memory extraction copied mentor-authored conclusions into employee state
- Symptom: Exact Annna replay stored `Employee thinks belonging is probably the hardest` after the employee said `have no idea`; another sample turned `No, forget` into a goal.
- Expected: Only the employee's latest explicit assertion or adoption may create or change employee memory; the just-generated mentor reply and closing language are never evidence or goals.
- Root cause layer: architecture
- Harness fix: Bound each extraction to the latest employee message, structurally omit the trailing mentor reply, keep earlier turns as context only, and explicitly reject closing/rejection goals.
- Regression check: `pnpm --filter @entalent/ai-openai test -- prompts/memory.test.ts` plus the exact Annna scenario's mentor-sourced-memory and invalid-closing-goal assertions.
- Status: fixed

## 2026-08-28: Rejected framing returned from stored memory after correction
- Symptom: The correction reply dropped pulse-check/report framing, but two turns later stored project context caused the bot to ask whether criteria should target regular chat or pulse-check answers.
- Expected: A rejected frame must remain suppressed through the immediate corrected exchange without deleting otherwise valid project context.
- Root cause layer: architecture
- Harness fix: Persist correction evidence in outbound decision metadata, suppress response memory for the next two mentor replies, and add a responder-level recent-correction contract that follows the latest request without reviving pre-correction topics.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` and `pnpm --filter @entalent/ai-openai test -- prompts/respond.test.ts`.
- Status: fixed

## 2026-08-28: Slack Socket Mode explicit disconnect crashed the production API
- Symptom: The production API exited while the Slack client was connecting because `@slack/socket-mode@1.3.6`/`finity` treated `server explicit disconnect` as an unhandled state-machine event; restarting the API restored service.
- Expected: A transient or explicit Socket Mode disconnect should reconnect or fail without terminating the API process.
- Root cause layer: architecture
- Harness fix: Upgrade `@slack/socket-mode` to `2.0.7`, which removes the Finity lifecycle and handles server disconnect through the WebSocket close/reconnect path; keep a regression for disconnect-before-handshake.
- Regression check: `pnpm --filter @entalent/api test -- slack-socket-mode.lifecycle.test.ts`
- Status: fixed

## 2026-08-28: Leading acknowledgement hid a substantive correction
- Symptom: In the exact Annna replay, the message beginning with `yes` and then rejecting the pulse-check interpretation was classified as `acknowledgement / continue_existing_thread`, so the next reply retained manager/report framing.
- Expected: A substantive clarification or rejection must be `correction` even when it begins with a backchannel such as `yes`.
- Root cause layer: instructions
- Harness fix: Restrict `acknowledgement` to messages that are entirely backchannels and state that an explicit correction wins over a leading acknowledgement.
- Regression check: `pnpm --filter @entalent/ai-openai test -- prompts/classify.test.ts prompts/respond.test.ts`; production exact replay must persist `dialogueAct=correction` for the combined `yes`/correction turn.
- Status: fixed

## 2026-08-28: Slack acceptance targeted the wrong app DM
- Symptom: A connector-authored marker appeared in `D09GVMU5S3G` at Slack timestamp `1787867291.624999`, but no enTalent ingress followed because that DM belongs to the separate `AI Agent Bot` app. The production EnTalent DM is `D0BJDC2MPE2`, with bot user `U0BJ018K3CP`.
- Expected: Live acceptance must resolve the product app identity and channel before treating missing ingress as connector or filtering behavior.
- Root cause layer: workflow
- Harness fix: Verify the DM title and bot author before replay. Use `D0BJDC2MPE2` for EnTalent; both authenticated Slack Web and the ChatGPT Slack connector reach the product there, so do not weaken the production anti-loop filter.
- Regression check: Send one connector marker to `D0BJDC2MPE2` and confirm a reply authored by `U0BJ018K3CP` before continuing.
- Status: fixed

## 2026-08-20: metadata trace test expected unsorted keys
- Symptom: `conversation-orchestrator.test.ts` failed after adding `continuityDecision` and `goalDecision` because the test sorted actual metadata keys but the expected list was not sorted.
- Expected: Metadata shape regression should verify keys without failing on a mechanical ordering mismatch.
- Root cause layer: verification
- Harness fix: Keep expected key lists sorted whenever the assertion calls `Object.keys(...).sort()`.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-20: Story 11.3 review patch missed fixture and timestamp propagation
- Symptom: Focused orchestrator tests failed after review fixes because owner-aware fixtures were incomplete, an acknowledgement assertion was stale, and the computed inbound timestamp was not passed to continuity resolution.
- Expected: Review patches and their production-shaped fixtures should pass the focused regression before broader verification.
- Root cause layer: workflow
- Harness fix: Run the focused test immediately after each review patch and keep required conversation identity fields in the shared fixture.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-20: TSX IPC socket blocks full pre-push inside sandbox
- Symptom: `pnpm prepush` passes monorepo typecheck, lint, and package tests, then `test:scripts` fails with `listen EPERM` for the TSX IPC socket. On 2026-08-29 the escalation also exposed that the default script suite still included a retired live-MAF smoke test.
- Expected: Complete ordinary pre-push verification without invoking retired MAF tooling.
- Root cause layer: workflow
- Harness fix: Remove the retired live-MAF test from `test:scripts`; rerun `pnpm prepush` outside the sandbox only for the remaining TypeScript-owned script checks when TSX IPC is denied.
- Regression check: `pnpm test:scripts`
- Status: fixed

## 2026-08-19: Story 11.2 consumer typecheck read stale declarations
- Symptom: The focused `ai-openai` typecheck rejected new `ReplyPlan` reasons before `application` declarations were rebuilt.
- Expected: Consumer verification should use declarations generated from the current source.
- Root cause layer: workflow
- Harness fix: Build changed upstream packages before focused consumer typechecks, or use root `pnpm typecheck` which orders the dependency graph.
- Regression check: `pnpm --filter @entalent/application build` then `pnpm --filter @entalent/ai-openai typecheck`
- Status: fixed

## 2026-08-19: Story 11.2 test mock missed lint suppression
- Symptom: The first full pre-push stopped on one new `as any` test mock without the repository's required local ESLint suppression.
- Expected: Focused implementation verification should catch lint errors before the broad handoff check.
- Root cause layer: verification
- Harness fix: Run lint for each changed package after focused tests and before the full pre-push.
- Regression check: `pnpm --filter @entalent/application lint`
- Status: fixed

## 2026-08-19: Cross-contract rollback left one stale test reason
- Symptom: After removing two story-local reason enums to avoid MAF/OpenAPI expansion, one reply-plan test still expected the removed acknowledgement reason.
- Expected: Mechanical contract rollback should update every source and test occurrence before verification.
- Root cause layer: workflow
- Harness fix: Run an exact removed-symbol scan before rerunning focused tests.
- Regression check: `rg 'acknowledgement_pauses_conversation|closing_ends_conversation' packages`
- Status: fixed

## 2026-08-18: classifier emits unsupported closing intent
- Symptom: Live Slack closing turn ("Спасибо, пока достаточно. Вернусь к этому позже.") was retried three times and produced no outbound reply.
- Expected: Closing/stop-style turns should map to a valid intent and produce a short, question-free close.
- Root cause layer: architecture
- Harness fix: Normalize known misplaced dialogue-act labels at the classifier boundary and keep closing as a typed `dialogueAct`.
- Regression check: `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` plus `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-18: Slack connector attribution flipped ambiguous turn language
- Symptom: Production Slack smoke answered `ok` in English after a Russian conversation.
- Expected: Short ambiguous turns should inherit the recent Russian user-turn language.
- Root cause layer: verification
- Harness fix: Add a production-shaped regression with Slack connector attribution appended to an ambiguous user turn.
- Regression check: `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`
- Status: fixed

## 2026-08-15: contextual support smoke repeated stock fallback
- Symptom: Production Slack smoke repeated the stock support phrase after the user pushed back that the reply was too generic.
- Expected: A context-rich support turn should route through the model path instead of repeating deterministic support fallback.
- Root cause layer: verification
- Harness fix: Add a production-shaped regression where a previous stock support reply forces the next support-emotion turn onto the model path.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider.py -q`
- Status: fixed

## 2026-09-03: Live Slack smoke write rejected by approval review

- Symptom: Slack channel history was readable, but the approved REQ-012 marker message was rejected before delivery; a schema-probe retry was also rejected.
- Expected: One explicitly authorized marker reaches `D0BJDC2MPE2`, then channel history provides delivery and agent-reply evidence.
- Root cause layer: tooling
- Harness fix: Treat connector write rejection as a hard stop; surface the exact target and message for renewed user approval instead of probing or switching tools.
- Regression check: Read the target first, invoke one direct Slack send only after explicit approval, then verify the unique marker through `slack_read_channel`.
- Status: open

## 2026-09-03: Live Slack smoke transcript hidden after approved send

- Symptom: After renewed explicit approval, one REQ-012 marker delivered to `D0BJDC2MPE2`, but Slack read/search transcript content was returned to Codex as opaque `ccr:` references, so the agent reply text and confirmation summary could not be inspected.
- Expected: Slack smoke should expose model-readable channel history after delivery so follow-up turns can be sent only in response to actual agent text.
- Root cause layer: tooling
- Harness fix: Require a model-readable transcript source before continuing live Slack follow-up turns; use connector message links/search only as delivery evidence.
- Regression check: Send one approved marker, verify returned Slack `ts`, then verify read/search output contains text before sending any reply.
- Status: open

## 2026-09-03: Reporting disclosure receipt did not advance pending confirmation

- Symptom: Live Slack after delivered reporting disclosure repeated disclosure-only text and left `survey_group_states.status = pending_confirmation`.
- Expected: Once current reporting disclosure is delivered before the inbound turn, the next safe non-closing turn should surface the exact displayed confirmation prompt and stage `awaiting_confirmation`.
- Root cause layer: architecture
- Harness fix: Add orchestrator regression for acknowledgement after delivered disclosure and avoid passing disclosure policy hints after current receipt exists.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`
- Status: fixed

## 2026-09-03: Delivered confirmation prompt stayed pending after Slack delivery

- Symptom: Slack delivered a confirmation prompt with valid `confirmationSummary`, but `survey_group_states.status` stayed `pending_confirmation` with `confirmation_prompt_message_id` set.
- Expected: A delivered prompt with a valid displayed summary should be treated as awaiting confirmation, including rows that missed the delivery activation hook.
- Root cause layer: architecture
- Harness fix: Make delivered-prompt queries accept both staged pending and awaiting states, guarded by `messages.sent_at IS NOT NULL` and summary validity.
- Regression check: `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/message-send/message-send.processor.test.ts`
- Status: fixed

## 2026-09-03: Confirmation state SQL passed JS Date through raw template

- Symptom: Real Slack confirmation reply retried and failed with `TypeError [ERR_INVALID_ARG_TYPE]: ArrayBuffer. Received an instance Date` in `ConversationProcessor`.
- Expected: Group confirmation SQL should compare timestamps without passing raw JS `Date` values through untyped SQL template parameters.
- Root cause layer: architecture
- Harness fix: Convert raw timestamp parameters to ISO `::timestamptz` and keep disclosure-before-confirmation check in TypeScript before the SQL update.
- Regression check: `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/message-send/message-send.processor.test.ts`
- Status: fixed

## 2026-09-05: Confirmation label retry failed closed without Slack reply

- Symptom: After the first label-leak fix, a production Slack turn reached `pending_confirmation`, but worker job 390 failed closed when the model repeated a confirmation draft containing the technical `confirmationSummary:` label; no outbound Slack prompt was delivered.
- Expected: A simple exposed provider label should be normalized before confirmation validation so the user receives the clean confirmation prompt, while invalid summaries still fail closed.
- Root cause layer: architecture
- Harness fix: Strip the simple `confirmationSummary:` label at the OpenAI provider boundary before validation and keep the orchestrator contract guard as the cross-provider safety net.
- Regression check: `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts`
- Status: fixed

## 2026-09-05: Additional pending groups repeat disclosure without confirmation prompt

- Symptom: Full production Slack smoke created `belonging` and `engagement` pending confirmation states, but repeated the reporting disclosure message after acknowledgement and never surfaced a confirmation prompt.
- Expected: Once a pending group has enough evidence and disclosure is delivered, the next safe acknowledgement should show the exact confirmation summary prompt.
- Root cause layer: architecture
- Harness fix: Normalize stale `reporting_explanation` intent at the shared orchestrator boundary only for a substance-free acknowledgement after a delivered disclosure, with a multi-group regression.
- Regression check: Real Slack smoke or orchestrator test covering `belonging`/`engagement` pending states after existing confirmed groups.
- Status: fixed

## 2026-09-05: Confirmation lifecycle copy breaks language and acknowledgement

- Symptom: The full Slack lifecycle confirmed both `engagement` and `belonging`, but both Russian prompts ended with `did I get that right?`; after the second explicit agreement, the bot continued the topic with another question instead of visibly acknowledging confirmation.
- Expected: Confirmation prompts stay in the resolved response language, and an accepted confirmation produces a clear, question-free acknowledgement before normal conversation resumes.
- Root cause layer: architecture
- Harness fix: Remove the literal English confirmation exemplar, disable ordinary follow-up after a successful confirmation, and revalidate the corrected zero-question draft at the provider boundary.
- Regression check: Focused orchestrator/provider tests plus a real Slack confirmation cycle.
- Status: fixed

## 2026-09-05: Documented deterministic harness command does not exist

- Symptom: `pnpm harness:check -- --base HEAD` failed because the root package exposes no `harness:check` script.
- Expected: The specification should name a runnable deterministic repository gate.
- Root cause layer: workflow
- Harness fix: Use the current root `pnpm prepush` gate and verify available scripts from `package.json` before copying older handoff commands.
- Regression check: `jq -e '.scripts.prepush and (.scripts["harness:check"] | not)' package.json` followed by `pnpm prepush`.
- Status: fixed

## 2026-09-06: De-identification gate missed delivery activation and strict accepted proof

- Symptom: Initial typed gate allowed a delivered staged confirmation to become `awaiting_confirmation` without row/message `deidentificationDecision`, accepted malformed decisions with non-empty reasons, and omitted known team identifiers.
- Expected: No candidate reaches confirmation or reporting unless TypeScript records `accepted`, exact `deidentification-v1`, and `reasons: []`, bound to the delivered candidate.
- Root cause layer: architecture
- Harness fix: Share one accepted-proof predicate across stage, delivery activation, confirm, report projection, and parser/type guard; include existing team identifiers in policy input.
- Regression check: `pnpm --filter @entalent/application test -- src/utils/deidentification-policy.test.ts src/use-cases/conversation-orchestrator.test.ts` and `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts`
- Status: fixed

## 2026-09-06: Withdrawal columns appended to already-applied migration

- Symptom: Database integration failed after adding `withdrawn_at` and `withdrawal_message_id` to existing `0012` because the local test database had already recorded that migration.
- Expected: New persisted columns apply through a forward migration when any environment may have already applied the previous migration.
- Root cause layer: workflow
- Harness fix: Before editing an uncommitted migration, check whether local integration DB has recorded it; if yes, add the new persistence change as the next migration.
- Regression check: `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration`
- Status: fixed

## 2026-09-06: Dependent package checks used missing or stale dist output

- Symptom: Parallel affected builds briefly failed with missing `@entalent/contracts` / `@entalent/ai-openai` declarations while sibling builds rewrote `dist`; later worker typecheck also missed a newly exported application type until application was rebuilt.
- Expected: Package builds that consume sibling package `dist` artifacts run after those dependencies finish building.
- Root cause layer: workflow
- Harness fix: After changing a package export, build that dependency before any consumer typecheck/build; keep parallelism only for checks that do not read sibling `dist` output.
- Regression check: Sequential dependency builds, then `pnpm --filter @entalent/worker typecheck` and `pnpm --filter @entalent/worker build`.
- Status: fixed

## 2026-09-06: Exclusion verdict schema lacked prompt semantics

- Symptom: Confirmation interpreter schema accepted `exclude`, but the system prompt still listed only `agree`, `correct`, and `unclear` verdict meanings.
- Expected: Prompt and typed schema define the same machine-readable verdict set so explicit withdrawal language can reach the TypeScript withdrawal path.
- Root cause layer: architecture
- Harness fix: Add prompt-rendering regression test for new structured verdict semantics, not only parser/schema tests.
- Regression check: `pnpm --filter @entalent/ai-openai test -- src/prompts/confirm-interpret.test.ts src/openai-provider.test.ts`
- Status: fixed

## 2026-09-06: Malformed awaiting de-identification proof could hold confirmation slot

- Symptom: A delivered awaiting group with missing or malformed accepted proof returned early in the orchestrator without clearing `confirmation_prompt_message_id`, blocking later pending confirmations for the user.
- Expected: Confirmation cannot proceed without typed accepted proof, and invalid awaiting proof returns the row to pending so a new accepted candidate can be generated.
- Root cause layer: architecture
- Harness fix: Add orchestrator regression for awaiting group state with `deidentificationDecision: null`.
- Regression check: `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`
- Status: fixed

## 2026-09-06: Cohort membership patch changed the wrong focused test mock

- Symptom: The focused team repository suite failed with `this.db.client.select is not a function` after the test mock for the current-membership lookup was changed to `selectDistinct`, while only the historical cycle lookup had changed in production.
- Expected: The patch and its test double target the exact changed method without altering a sibling query path.
- Root cause layer: workflow
- Harness fix: Use symbol-qualified CodeGraph context before each same-file patch and rerun the smallest affected test immediately after the edit.
- Regression check: `pnpm --filter @entalent/worker test -- src/survey/repositories/team.repository.test.ts`
- Status: fixed

## 2026-09-06: BMad uv activation could not initialize the home cache in sandbox

- Symptom: `uv run _bmad/scripts/resolve_customization.py` failed with `Operation not permitted` while opening `/Users/serzh/.cache/uv/sdists-v9/.git`.
- Expected: BMad customization resolution should run inside the workspace sandbox without requiring writes to the user cache.
- Root cause layer: tooling
- Harness fix: Set `UV_CACHE_DIR` to a task-scoped writable directory under `/private/tmp` for BMad `uv run` commands.
- Regression check: `UV_CACHE_DIR=/private/tmp/entalent-bmad-uv-cache uv run _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-spec --key workflow`
- Status: fixed

## 2026-09-06: Grill decision patches repeatedly failed before application

- Symptom: Multiple documentation patches assumed non-matching paragraph context or had malformed orchestration/patch syntax. Failed attempts did not change files partially.
- Expected: Decision capture should use the current on-disk requirement text and apply atomically.
- Root cause layer: tooling/context
- Harness fix: Read exact target paragraphs in the immediately preceding command, then apply one file per patch with a validated terminator and minimal JavaScript wrapper.
- Regression check: `git diff --check`
- Status: fixed

## 2026-09-06: BMad spec customization references missing project context

- Symptom: BMad spec activation resolved `file:{project-root}/project-context.md` as a persistent fact, but that file does not exist in the checkout.
- Expected: Every configured persistent-fact file exists and can be loaded before the workflow starts.
- Root cause layer: workflow/configuration
- Harness fix: Either generate the canonical root project context or remove the stale persistent-fact reference after confirming which source should own it.
- Regression check: `test -f project-context.md`
- Status: open

## 2026-08-20: MAF prompt rewrite changed a regression marker's case
- Symptom: The focused prompt test failed because `Do not paraphrase` replaced the asserted lowercase marker.
- Expected: Engagement wording changes should preserve unrelated prompt contracts.
- Root cause layer: verification
- Harness fix: Preserve the existing marker while extending the sentence and run the focused prompt test immediately.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q`
- Status: fixed

## 2026-08-28: Numeric probe metadata was passed to an unused persistence shape
- Symptom: Root typecheck rejected `responseType` on the hidden proactive-request persistence payload.
- Expected: New metadata should cross only boundaries that consume it.
- Root cause layer: architecture
- Harness fix: Remove the unused field and keep `responseType` only in the runtime candidate context.
- Regression check: `pnpm --filter @entalent/worker typecheck`
- Status: fixed

## 2026-08-28: Agent-service verification used an unavailable global pytest
- Symptom: `pytest tests/unit/test_model_provider_prompt.py` failed with `command not found` despite the repository virtualenv being present.
- Expected: Python verification should use the project-owned interpreter.
- Root cause layer: workflow
- Harness fix: Use `agent-service/.venv/bin/python -m pytest` in local verification commands.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q`
- Status: fixed

## 2026-08-28: Narrow response type widened in a prompt fixture
- Symptom: Root typecheck rejected a numeric-probe fixture because its `responseType` literal widened to `string` after the runtime contract became an enum.
- Expected: Fixtures for closed contract values should retain literal types.
- Root cause layer: verification
- Harness fix: Mark the fixture discriminator `as const` and keep root typecheck in the handoff gate.
- Regression check: `pnpm typecheck`
- Status: fixed

## 2026-08-28: Python scope guard matched a harmless word substring
- Symptom: The full Python suite rejected validator prose because the word “requests” contains the forbidden substring `requests`.
- Expected: Runtime policy wording should not trip the repository's coarse forbidden-fragment scan.
- Root cause layer: verification
- Harness fix: Use equivalent wording without the forbidden fragment and always run the full Python suite after prompt changes.
- Regression check: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_scope.py -q`
- Status: fixed

## 2026-08-20: Targeted conversation sim command ran the full suite
- Symptom: Passing `-- terse-user.sim.test.ts` through the package script made Vitest run nine scenario files; live cases then failed on blocked DNS.
- Expected: Only the requested terse-user scenario should run.
- Root cause layer: workflow
- Harness fix: Use `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/terse-user.sim.test.ts` for one scenario.
- Regression check: Confirm Vitest reports exactly one test file before treating the run as evidence.
- Status: fixed

## 2026-08-20: Live model verification lacked authorized egress
- Symptom: The corrected live terse-user simulation was rejected because it would send scenario text to Azure OpenAI without explicit egress authorization; later direct-intent and exact Annna reruns repeated this when they also included LangWatch telemetry.
- Expected: Live prompt verification should run only with an explicitly approved destination and payload.
- Root cause layer: environment
- Harness fix: Keep exact private-transcript scenarios out of LangWatch, request explicit approval for the remaining Azure scenario egress, and use deterministic prompt regressions as the safe default.
- Regression check: Before a live sim with private transcript text, confirm LangWatch reporting is disabled and explicit approval exists for the model-provider destination; otherwise do not run it.
- Recurrence: On 2026-09-08, a post-fix `memory-recall` run hit sandbox DNS and the outside-sandbox retry was rejected because Azure OpenAI and LangWatch scenario egress had not been explicitly approved.
- Status: open

## 2026-08-28: Closing turn created durable anti-goal memories
- Symptom: The production Annna replay classified `No, forget` as `closing` and replied without a question, but memory extraction stored four active `goal` items phrased as “Employee no longer wants to continue…” from that closing turn.
- Expected: A closing turn may cancel or complete an existing goal, but must not create durable memory, a new goal, or a follow-up from the decision to stop the current thread.
- Root cause layer: architecture
- Harness fix: Enforce the closing boundary in `MemoryExtractionUseCase` using the persisted outbound `dialogueAct`; discard memory items, goal creates, and follow-ups while retaining explicit cancel/complete proposals.
- Regression check: `pnpm --filter @entalent/application test -- memory-extraction.use-case.test.ts`; the exact Annna scenario rejects paraphrased “no longer wants to continue” goal memories.
- Status: fixed

## 2026-08-28: Git staging initially ran without repository-write escalation
- Symptom: `git add -u` failed because the managed sandbox could not create `.git/index.lock`.
- Expected: Explicitly authorized commit operations should write the Git index successfully.
- Root cause layer: tooling
- Harness fix: Run Git index mutations with repository-write escalation in the managed desktop sandbox.
- Regression check: `git diff --cached --check` after staging.
- Status: fixed

## 2026-08-28: Railway readiness initially ran inside the network sandbox
- Symptom: The first production readiness run failed DNS lookup for Railway's API.
- Expected: The read-only deployment verification should reach Railway after an authorized push.
- Root cause layer: environment
- Harness fix: Run Railway-backed readiness with network escalation in the managed desktop sandbox.
- Regression check: `pnpm maf:agent-service:readiness` completes with service, variable, and deployment-envelope checks.
- Status: fixed

## 2026-08-28: MAF-only smoke was used for a TypeScript feature
- Symptom: `maf-proactive-selected-probe-smoke.ts` reported `selected_probe_missing` while the supported TypeScript path was under acceptance.
- Expected: Retired MAF smoke and `agent-service` verification must not be used for TypeScript-only product work.
- Root cause layer: verification
- Harness fix: Exclude MAF smoke from the verification plan and use TypeScript selector/outbound evidence instead.
- Regression check: The task verification list contains no `maf:*`, `agent-service`, Python runtime, or MAF OpenAPI command.
- Status: obsolete

## 2026-08-28: Survey evaluator omitted an explicit numeric rating field
- Symptom: Production evaluation recognized the employee's reply `7` but omitted optional `numericValue`, leaving `survey_assessments.score` null and the engagement backlog incomplete.
- Expected: An explicit 0–10 answer to the exact preceding numeric probe should persist even when the model omits the redundant structured number.
- Root cause layer: architecture
- Harness fix: Treat the deterministically parsed inbound rating as source of truth, require exact probe binding, and reject any conflicting model-provided value (`b4a583f`).
- Regression check: `pnpm --filter @entalent/application test -- survey-evidence.use-case.test.ts`; production replay stores `7.00`, while qualitative-only text stores no score.
- Status: fixed

## 2026-08-28: Inline queue-cleanup script used shell-interpreted template literals
- Symptom: Backticks in a `tsx -e` command were expanded by the outer shell, producing `command not found` diagnostics and suppressing the script's removal summary; the guarded removal itself completed.
- Expected: Production cleanup commands should preserve JavaScript source exactly and report every removed target.
- Root cause layer: tooling
- Harness fix: Avoid template literals in shell-embedded scripts; use string concatenation or a reviewed temporary script, then perform an independent read-only absence check.
- Regression check: Query the exact job IDs after cleanup and require `remaining=[]`; the verification passed for all seven jobs.
- Status: fixed

## 2026-08-28: Engagement implementation crossed the retired MAF boundary
- Symptom: Commit `b2fec85` added numeric-probe behavior to `agent-service`, the MAF runtime contract, and proactive MAF worker wiring even though MAF is unsupported and out of scope.
- Expected: Engagement scheduling, quantitative extraction, persistence, and focus changes must remain in the supported TypeScript application/worker/AI path.
- Root cause layer: instructions
- Harness fix: Restore every MAF-facing file to its pre-feature bytes and add an explicit no-MAF boundary check to engagement verification.
- Regression check: Diff the final tree against `b2fec85^` for `agent-service`, runtime OpenAPI/contracts, `agent-runtime.port.ts`, and proactive MAF `responseType` wiring; require no feature delta.
- Status: fixed

## 2026-08-29: Worker suite required retired MAF wiring
- Symptom: The first full worker test run failed because a source-inspection test still required `recordShadowCandidate` and primary/canary MAF wiring in `ConversationModule`.
- Expected: The worker must remain TypeScript-only even while retired MAF artifacts stay available as unreferenced archive code.
- Root cause layer: verification
- Harness fix: Replace the obsolete rollout assertion with a quarantine regression that rejects MAF router, client, and proactive-branch references in the active worker module and processor.
- Regression check: `pnpm --filter @entalent/worker test` passes 117/117 and includes the TypeScript-only module/processor boundary assertions.
- Status: fixed

## 2026-08-30: Broad application test command crossed the retired MAF boundary
- Symptom: A TypeScript pulse-backlog verification used the broad `@entalent/application` test command, which also executed archived MAF unit and smoke test files; a delegated worker had also opened one archived runtime-ledger test while searching for a database mock pattern.
- Expected: Ordinary product work must use an active-runtime allowlist and neither inspect nor execute retired MAF tests, even when they are colocated in a supported TypeScript package.
- Root cause layer: verification
- Harness fix: Derive existing colocated tests from changed paths, run them through their owning package, and reject any derived retired target; never fall back to root `pnpm test`.
- Regression check: `pnpm exec tsx scripts/agent-harness.test.ts` proves a changed package source runs only its colocated active test while an adjacent archived test and root broad test remain untouched.
- Recurrence: On 2026-09-08, the documented `prepush:non-maf` script still called `turbo run test`, which executed archived MAF unit tests despite its name; no MAF service or live runtime was invoked.
- Status: open

## 2026-08-30: Harness reflection IPC was blocked by the managed sandbox
- Symptom: The first focused reflection command failed with `listen EPERM` while creating the local tsx IPC socket.
- Expected: Required read-only reflection should run before review without a false product failure.
- Root cause layer: environment
- Harness fix: Run this local reflection command with the narrowly scoped managed-sandbox escalation.
- Regression check: The same focused reflection command exits `2` with `eligible=false`, not an IPC error.
- Recurrence: On 2026-09-17, CAP-6 closeout reflection for four Markdown paths hit the same `listen EPERM`; all four narrowly escalated read-only reruns completed successfully with `eligible=true`.
- Recurrence: On 2026-09-18, CAP-11 reflection and the focused `tsx --test` run hit the same IPC restriction; both narrowly escalated reruns passed.
- Recurrence: On 2026-09-26, Company Admin OIDC reflection and `pnpm harness:check` hit the same IPC restriction. `node --import tsx scripts/agent-harness.ts reflection --changed-path apps/api/src/company-auth` and `node --import tsx scripts/agent-harness.ts check --base 2e12d5b` passed without an IPC socket.
- Recurrence: On 2026-09-27, `pnpm harness:check` again hit `listen EPERM`; the direct `node --import tsx scripts/agent-harness.ts check --base a189ed2776853a23c3315ffc23da348d4af3e235` passed and wrote a receipt.
- Harness fix: `harness:check` and `harness:preflight` now use the direct `node --import tsx` launcher, avoiding the tsx CLI socket; use the same launcher for manual reflection.
- Recurrence: On 2026-09-27, the instruction-mandated `pnpm exec tsx` reflection again hit `listen EPERM`; the direct Node launcher passed. `AGENTS.md` now names the direct launcher for reflection.
- Regression check: Run `pnpm harness:check --base <base-revision>` under the managed sandbox and verify it emits a structured receipt. The 2026-09-27 rerun passed.
- Status: open

## 2026-08-30: Broad formatting check mixed harness code with inherited docs
- Symptom: A combined Prettier check failed on existing BMad and agent-log Markdown while validating the two changed harness scripts.
- Expected: Harness implementation formatting should be verified without rewriting unrelated dirty documentation.
- Root cause layer: workflow
- Harness fix: Scope formatting verification to `scripts/agent-harness.ts` and its test.
- Regression check: `pnpm exec prettier --check scripts/agent-harness.ts scripts/agent-harness.test.ts` passes.
- Status: fixed

## 2026-08-30: Production aggregate check assumed a root pg dependency
- Symptom: The first post-deploy read-only aggregate command stopped locally with `Cannot find module 'pg'` before connecting to production.
- Expected: Operational verification should reuse an installed repository database client without adding a dependency.
- Root cause layer: tooling
- Harness fix: Run one-off read-only database checks through `@entalent/database` and its existing `postgres` client.
- Regression check: `pnpm --filter @entalent/database exec node -e 'console.log(require.resolve("postgres"))'` resolves locally before the Railway command runs.
- Status: fixed

## 2026-09-08: Live conversation scenarios lacked explicit destination approval
- Symptom: The post-deploy `memory-recall` and `terse-user` live run was rejected before execution because its test dialogue and context would be sent to Azure OpenAI and LangWatch.
- Expected: External model/evaluation payloads run only after the user explicitly approves the payload class and named destinations.
- Root cause layer: instructions
- Harness fix: Before the live command, request one explicit approval that names test dialogue/context, Azure OpenAI, and LangWatch; note that Annna disables LangWatch.
- Regression check: The approval text and the exact focused scenario command are present before any external run.
- Status: fixed

## 2026-09-08: Conversation simulation used a stale built workspace dependency
- Symptom: The first Annna repeat after changing `packages/ai-openai/src` still exercised the previous `dist` behavior and repeated the reporting-disclosure failure.
- Expected: A live conversation simulation should exercise the current affected workspace package source.
- Root cause layer: workflow
- Harness fix: Build each changed workspace dependency consumed through its package entry point before running conversation simulations.
- Regression check: `pnpm --filter @entalent/ai-openai build` succeeds before the focused Annna command.
- Status: fixed

## 2026-09-17: CAP-6 resolved-detail re-extraction was nondeterministic

- Symptom: Three model-backed D04-03 replays alternated between carrying the earlier “reconstruct the whole flow” detail and returning only facts from the latest turn; when carried, conflicting generic question directives still reopened the resolved branch until they were made optional.
- Expected: A detail explicitly resolved in the active thread remains available to the next reply plan and cannot be reopened as a clarification.
- Root cause layer: architecture
- Harness fix: Stop relying on prompt-only re-extraction on every turn; carry the bounded resolved-detail receipt through existing outbound message metadata for eligible same-session dialogue acts, while clearing it on topic replacement, correction, closing, any safety turn, confirmation, or a new session and prioritizing all current details within the cap.
- Regression check: Contracts 89/89, application reply-plan/orchestrator 187/187, AI 145/145, worker 175/175, repeated model-backed D04-03 plus unresolved-detail control runs, and final harness `runs/harness/receipt-1789670481321-c35ba0e7.json` pass; final blind review reported no findings.
- Recurrence: The first post-review model replay hit sandbox DNS `ENOTFOUND`; the explicitly approved Azure OpenAI rerun passed, so no product change was made for the transport failure.
- Recurrence: Pre-push model replays returned `resolvedDetails=[]` for the explicit whole-flow statement, varied its dialogue act, and once evicted the newer prior detail when four current details filled the cap, correctly blocking the push. The shared orchestrator now falls back to typed `latestUserSubstance` only for same-session/same-topic substantive turns and retains the most recent prior details in remaining cap slots; focused application tests pass 187/187 without phrase matching or another model call.
- Status: fixed

## 2026-09-18: CAP-9 review tests initially encoded two invalid assumptions

- Symptom: The hardened API test expected a hand-converted Slack timestamp two hours late, and worker typecheck rejected a one-argument `orderBy` mock after the query began asserting three sort keys.
- Expected: Review coverage should preserve the real Unix event time and model the called variadic query-builder method.
- Root cause layer: verification
- Harness fix: Derive the expected `Date` from Unix milliseconds and make the `orderBy` mock variadic.
- Regression check: Focused API/worker tests plus API/worker typecheck pass.
- Status: fixed

## 2026-09-26: Person integration gate lacked a pgvector-capable local database

- Symptom: The focused Person integration suite could not complete: local PostgreSQL 14 lacks `vector.control`, and Docker was not running. The initial socket-only connection also failed because the test client attempted TCP.
- Expected: The complete migration chain and Person constraints run against a local PostgreSQL with pgvector.
- Root cause layer: environment
- Harness fix: Provide a reproducible pgvector-capable local integration target and an explicit connection URL in the database test setup.
- Regression check: `DATABASE_URL=<local-pgvector-url> pnpm --filter @entalent/database exec vitest run --config vitest.integration.config.ts src/__tests__/people.integration.test.ts`.
- Recurrence: The organization schema suite also needs the same pgvector-capable full migration chain; its new migration and targeted constraints passed in an isolated PostgreSQL fixture without the earlier migrations.
- Status: open

## 2026-09-26: Application suite gave a non-reproducible survey assessment failure

- Symptom: The full application suite failed one existing numeric-survey assessment assertion (`upsertAssessment` had zero calls); the focused survey file then passed all 22 tests unchanged.
- Expected: The same survey test should pass reliably in both package and focused runs.
- Root cause layer: verification
- Harness fix: Reproduce under the full suite and isolate any shared clock, mock, or test-order dependency before changing product code; the hierarchy slice did not touch survey evidence files.
- Regression check: Compare the focused survey file with the full application suite under an isolated test-worker configuration.
- Status: open

## 2026-09-26: CSV verification fixtures initially missed required schema and header fields

- Symptom: The focused CSV test initially omitted the `pulseParticipant` header; the isolated SQL check initially lacked runtime `users` columns and counted prior rejected audit attempts as new events.
- Expected: Test fixtures match the CSV contract and the Drizzle table shape, and audit assertions isolate events from the current run.
- Root cause layer: verification
- Harness fix: Keep a reusable CSV fixture builder with the complete header set and a pgvector-backed integration database migrated through the normal chain; scope audit assertions to a fresh tenant or baseline count.
- Regression check: Run focused CSV application/API tests and a valid plus invalid import on a clean migrated integration database.
- Status: open

## 2026-09-26: Slack link service first pass left an unused transaction type

- Symptom: API typecheck and lint failed on an unused `Transaction` alias after the Slack link service was introduced.
- Expected: The focused service passes static checks before harness completion.
- Root cause layer: verification
- Harness fix: Keep API typecheck and lint in the focused change loop; remove unused scaffolding before widening the verification scope.
- Regression check: `pnpm --filter @entalent/api typecheck` and `pnpm --filter @entalent/api lint`.
- Status: fixed

## 2026-09-26: Isolated inbound SQL fixture omitted the users ID default

- Symptom: The first real-SQL inbound identity check failed because the minimal temporary `users` table did not generate IDs, although the repository schema does.
- Expected: The temporary fixture mirrors required defaults so a fallback-user transaction can run.
- Root cause layer: environment
- Harness fix: Prefer a database built from the full migration chain; while pgvector is unavailable, include schema defaults in any isolated fixture before testing writes.
- Regression check: Run concurrent fallback identity creation on a fresh migrated PostgreSQL database and assert one user plus one account.
- Status: open

## 2026-09-26: Worker typecheck read stale application package declarations

- Symptom: Worker typecheck initially reported that the new shared runtime eligibility export was missing, while application source tests passed.
- Expected: The worker compiles against freshly built application declarations.
- Root cause layer: workflow
- Harness fix: Build `@entalent/application` after changing its exports and before package-scoped worker typecheck; the repository-wide harness already orders builds through Turbo.
- Regression check: `pnpm --filter @entalent/application build` followed by `pnpm --filter @entalent/worker typecheck`.
- Status: fixed

## 2026-09-26: Worker harness found stale delivery projection assertion

- Symptom: The repository-wide harness failed because the delivery repository test expected the old projection without `userId` after the worker eligibility guard added that field.
- Expected: The projection test checks the user identity and conversation/user join used by the delivery guard.
- Root cause layer: verification
- Harness fix: Update projection assertions whenever a runtime guard adds a required identity field; keep the repository test in the harness gate.
- Regression check: `pnpm --filter @entalent/worker exec vitest run src/conversation/repositories/conversation.repository.test.ts`.
- Status: fixed

## 2026-09-26: Activation SQL check loaded stale database package output

- Symptom: The first onboarding-intent SQL check failed inside Drizzle because the API service imported a new table that was absent from the old built `@entalent/database` output.
- Expected: Runtime checks load the current schema export after a schema change.
- Root cause layer: workflow
- Harness fix: Build `@entalent/database` after schema/migration generation and before direct `node --import tsx` integration probes; keep repository-wide harness ordering as the final gate.
- Regression check: `pnpm --filter @entalent/database build` followed by the isolated activation/intent SQL check.
- Status: fixed

## 2026-09-26: Company Admin bootstrap script at repository root could not resolve package dependencies

- Symptom: Direct Node execution failed with `Cannot find module 'drizzle-orm'` from the root `scripts/` directory.
- Expected: The operator bootstrap uses the API package's declared dependencies and is typechecked with it.
- Root cause layer: workflow
- Harness fix: Place the script under `apps/api/scripts/` and include its dedicated tsconfig in the API typecheck command.
- Regression check: `pnpm --filter @entalent/api typecheck` and run the bootstrap CLI without arguments; it should report the missing input argument, not a module error.
- Status: fixed

## 2026-09-26: OIDC session test omitted join predicates

- Symptom: A test failed while asserting that the WHERE predicate contained the subject/provider join condition.
- Expected: The test inspects the JOIN predicate where that condition actually lives.
- Root cause layer: verification
- Harness fix: Capture JOIN and WHERE predicates separately in the query mock and assert each SQL clause in its own location.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-identity.service.test.ts`.
- Status: fixed

## 2026-09-26: Isolated PostgreSQL initialization needs host shared memory

- Symptom: `initdb` inside the sandbox failed at bootstrap with `shmget: Operation not permitted`; Docker daemon was not running.
- Expected: A temporary local database supports migration SQL checks without touching an existing database.
- Root cause layer: environment
- Harness fix: Use the installed Homebrew PostgreSQL 14 in an isolated `/private/tmp` cluster with approved host shared-memory access. Use a minimal base-schema fixture for migrations `0021` and `0022`; do not call that a full pgvector migration test.
- Regression check: Apply `0021` and `0022` with `psql -v ON_ERROR_STOP=1`, then verify single-use state, revocation, draft admin, and cross-tenant FK in the fixture.
- Status: fixed

## 2026-09-26: postgres-js fixture URL did not use the Unix socket

- Symptom: the read-only legacy reconciliation command exited with `ECONNREFUSED` against an isolated socket-only PostgreSQL fixture.
- Expected: the command connects to the intended temporary database and emits a tenant report.
- Root cause layer: tooling
- Harness fix: Start temporary PostgreSQL with a localhost listener when testing scripts that use postgres-js, and use an explicit `postgresql://localhost:<port>/<db>` URL; stop the host-started server with approved host access before deleting its data directory.
- Regression check: Run `company-hierarchy:reconcile` against a synthetic localhost PostgreSQL fixture and assert one Team, one active member, and one manager candidate.
- Status: fixed
## 2026-09-26: Draft edit mock returned unrelated ownership rows

- Symptom: the new role-change test reported a Team owner reference instead of its intended Employee placement reference; its inferred mixed-table `Map` also failed TypeScript compilation.
- Expected: the fixture models only the references owned by the edited Person and compiles with mixed table keys.
- Root cause layer: verification.
- Harness fix: Type mixed-table fixture maps explicitly and clear unrelated table rows in each role-reference case.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-draft.service.test.ts` and `pnpm --filter @entalent/api typecheck`.
- Status: fixed.

## 2026-09-26: Local PostgreSQL integration test blocked by sandbox TCP policy

- Symptom: the Company Admin session integration test failed with `connect EPERM` on `127.0.0.1:5434` and `::1:5434` inside the managed sandbox. The same local TCP restriction recurred for the owner replacement integration test on 2026-09-27; the scoped host-access rerun passed.
- Expected: the test connects to the separate local `entalent_hierarchy_acceptance` database and exercises the migrated schema.
- Root cause layer: environment.
- Harness fix: Rerun only the local database test with scoped host access; keep its `DATABASE_URL` pointed at the isolated acceptance database.
- Regression check: with scoped host access, run `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-session.integration.test.ts src/hierarchy/hierarchy-mutation.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Owner replacement left stale onboarding intents

- Symptom: promoting a new Team Lead or Manager with the explicit `deactivate` action disabled the previous Person but left their `pending` or `failed` first-contact intent eligible for repeated worker preparation.
- Expected: deactivation during owner replacement cancels unsent first-contact intents in the same transaction.
- Root cause layer: architecture.
- Harness fix: Apply the same onboarding cancellation rule as standalone Person, Team, and Unit deactivation; cover both owner replacements on the migrated PostgreSQL schema.
- Regression check: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-mutation.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Draft HRBP role correction was blocked by its own scope row

- Symptom: removing all selected Unit assignments from a draft HRBP left a draft `org_hrbp_scopes` row, so a subsequent draft Person role edit still failed with `hrbp_scope_reference`.
- Expected: Company Admin can explicitly clear a draft selected scope and then correct an imported draft role.
- Root cause layer: architecture.
- Harness fix: Interpret an empty selected scope for a draft HRBP as an inactive scope record, retain the active HRBP minimum, and document the clear action in setup.
- Regression check: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-advisor-scope.service.test.ts src/hierarchy/hierarchy-advisor-scope.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Company Admin session survived OIDC subject rotation

- Symptom: a session stored only tenant and Person IDs; after the Person's issuer/subject binding changed, the old session still passed the any-binding check.
- Expected: a session stays valid only while the exact OIDC identity used at login remains bound to that Person under an active provider and capability.
- Root cause layer: architecture.
- Harness fix: Persist a SHA-256 fingerprint of the verified issuer/subject pair in each new session, compare it on every resolve, and fail closed for pre-migration sessions without a fingerprint.
- Regression check: apply migration `0025` to isolated PostgreSQL and run `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/company-auth/company-admin-session.integration.test.ts`.
- Status: fixed.

## 2026-09-26: Persisted Slack receipt could leave onboarding in sending

- Symptom: if a worker stopped after persisting `messages.sent_at` and `external_message_id` but before updating `org_onboarding_deliveries`, the intent remained `sending` with no scheduled scan retry.
- Expected: an operator can safely reconcile a confirmed database receipt without resending; intents without a receipt remain untouched for Slack verification.
- Root cause layer: workflow.
- Harness fix: Add a tenant-scoped read-only inventory and confirmed apply path that validates the outbound message and writes an audit event; document the manual path for uncertain sends.
- Regression check: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent_hierarchy_acceptance pnpm --filter @entalent/api exec vitest run src/hierarchy/onboarding-reconciliation.integration.test.ts`.
- Status: fixed.
## 2026-09-26: Empty optional setup fields reached draft validation as strings

- Symptom: setup forms send empty strings for optional Manager, Team Lead, and Team fields; the controller passed them through, causing draft creation to reject an intentionally empty assignment.
- Expected: an empty optional form field means no assignment.
- Root cause layer: architecture.
- Harness fix: Normalize empty optional strings to null at the customer setup controller boundary.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/company-setup.controller.test.ts`.
- Status: fixed.
## 2026-09-26: SQL eligibility test expected parameters for inline literals

- Symptom: the SQL compilation test failed because its expected `active` and `false` values were not in the parameter array.
- Expected: verify the generated predicate regardless of whether the SQL builder inlines fixed literals.
- Root cause layer: verification.
- Harness fix: Assert the compiled SQL text for fixed literals and column correlations.
- Regression check: `pnpm --filter @entalent/database exec vitest run src/person-eligibility.test.ts`.
- Status: fixed.

## 2026-09-27: Concurrent hierarchy transactions surfaced PostgreSQL serialization aborts

- Symptom: two of six parallel PostgreSQL integration files failed with `40001` while the same files passed serially.
- Expected: independent hierarchy operations finish under normal database concurrency without recording a false rejected mutation for a transient serialization abort.
- Root cause layer: architecture.
- Harness fix: Retry the complete serializable database transaction a bounded number of times on PostgreSQL `40001`, before recording any final rejection. Keep the retry wrapper free of external side effects.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/serializable-retry.test.ts src/hierarchy/hierarchy-mutation.service.test.ts`, then run the six Company Hierarchy PostgreSQL integration files in parallel against the isolated local acceptance database.
- Status: fixed.

## 2026-09-27: Hierarchy audit omitted structured transitions for active operations

- Symptom: rollout audit stored counts without affected Person/Team IDs, owner replacement and deactivation audit lacked structured before/after values, and invalid Unit selection bypassed the rejected rollout audit.
- Expected: each invoked hierarchy mutation records its actor, affected IDs, structured transition, or rejection reason.
- Root cause layer: verification.
- Harness fix: Add affected IDs and structured before/after state to rollout, owner replacement, deactivation, Slack-link, and Company Admin capability audit records; move rollout selection validation inside its audited boundary.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/hierarchy-rollout.service.test.ts src/hierarchy/hierarchy-mutation.service.test.ts src/hierarchy/hierarchy-deactivation.service.test.ts src/hierarchy/hierarchy-slack-link.service.test.ts src/hierarchy/hierarchy-capability.service.test.ts`.
- Status: fixed.

## 2026-09-27: New hierarchy identifiers absent from confirmation safety check

- Symptom: a newly provisioned active Person without legacy Team membership supplied no Unit/Team or colleague identifiers to confirmation deidentification.
- Expected: confirmation safety uses current active organizational identifiers while legacy cohort and report routing remain unchanged.
- Root cause layer: architecture.
- Harness fix: Add a separate tenant-scoped active hierarchy identifier read to the Survey repository and include it in the existing deidentification decision. Keep the reporting Team lookup intact.
- Regression check: `pnpm --filter @entalent/application exec vitest run src/use-cases/conversation-orchestrator.test.ts` and the worker `team.repository.integration.test.ts` against the isolated migrated local PostgreSQL database.
- Status: fixed.

## 2026-09-27: Production legacy report required schema detection and export approval

- Symptom: the report reader queried hierarchy tables and `channel_accounts.link_status` that are absent before migration; a later attempt to export the full production tenant report to a local file was rejected by automatic approval review.
- Expected: pre-migration inventory works read-only and sensitive membership/Slack data is exported only to an explicitly approved destination.
- Root cause layer: workflow.
- Harness fix: Detect complete old versus migrated schema, treat old Slack accounts as linked when `link_status` is absent, fail on partial schema or unknown tenant, and mark report `schemaReady`; retain the full production export as an approval-gated operation with its payload and destination stated beforehand.
- Regression check: `pnpm --filter @entalent/api exec vitest run src/hierarchy/legacy-reconciliation.read.test.ts src/hierarchy/legacy-reconciliation.test.ts`, followed by a read-only local report on the isolated migrated acceptance database.
- Status: fixed (the user granted access and the restricted read-only production report was exported).

## 2026-09-27: pnpm banner polluted redirected hierarchy JSON

- Symptom: Redirecting `pnpm --filter @entalent/api company-hierarchy:reconcile` to a JSON report file included pnpm's command banner before the JSON, so parsing the restricted production report failed.
- Expected: The read-only report command should produce one valid JSON document with no wrapper output.
- Root cause layer: tooling.
- Harness fix: The reconciliation and backfill runbook now invokes the TypeScript scripts directly with `node --import tsx` when JSON is redirected to a file.
- Regression check: Redirect `node --import tsx apps/api/scripts/reconcile-legacy-hierarchy.ts` to a restricted file and parse the whole file as JSON.
- Status: fixed.

## 2026-09-27: quarantine reason widened past its validated union

- Symptom: The first quarantine manifest parser passed its focused tests but API typecheck rejected `reason: string` where the validated reason union was required.
- Expected: The parsed quarantine reason remains typed as the two accepted values.
- Root cause layer: verification.
- Harness fix: Narrow the validated reason explicitly and keep API typecheck in the implementation gate.
- Regression check: `pnpm --filter @entalent/api typecheck`.
- Status: fixed.
## 2026-09-27: Hierarchy rollout could not adopt a legacy Slack User

- Symptom: The designated test Employee already has a linked Slack account, one conversation, and 102 messages. Setup draft creation would allocate a new User ID, while Slack linking rejects assigning that account to a second User.
- Expected: Explicit hierarchy reconciliation should retain the existing User ID, channel account, and conversation history, then activate the Person and Unit atomically without interrupting the active conversation runtime.
- Root cause layer: architecture
- Harness fix: Add an audited, operator-scoped legacy adoption path inside the serializable Unit rollout transaction, with exact Slack email and account ownership checks. Keep legacy Team membership and report routing unchanged.
- Regression check: A migrated PostgreSQL test starts with an active legacy User and historical conversation, rejects a failed rollout with no Person row, then activates the same User ID and verifies history, account ownership, onboarding uniqueness, and runtime eligibility.
- Status: open

## 2026-09-27: First-contact intents waited for the hourly proactive scan

- Symptom: A successful Unit rollout created two pending onboarding intents, but the production worker's scheduled scan runs only once an hour, delaying live acceptance and first contact.
- Expected: An operator should be able to process only the selected Unit's pending first contacts promptly, without triggering normal proactive candidates for the tenant.
- Root cause layer: workflow
- Harness fix: Add a distinct `onboarding-only` queue job requiring both tenant and Unit IDs; filter onboarding dispatch by both IDs and skip the proactive scheduler for that job.
- Regression check: Worker processor tests reject missing scope and prove the proactive scheduler is not called; PostgreSQL/BullMQ onboarding integration proves an unrelated Unit filter queues nothing and the selected intent delivers once.
- Status: open

## 2026-09-27: Slack bot lacked DM creation scope during first-contact preparation

- Symptom: The selected Manager and Employee onboarding intents failed before outbound message creation because Slack `conversations.open` returned `missing_scope`; the bot lacked `im:write`.
- Expected: The connected bot opens each selected DM and delivers one first contact with a durable Slack receipt.
- Root cause layer: environment
- Harness fix: Verify the installed bot token's actual `x-oauth-scopes` and both recipient DM opens before scoped dispatch. Reinstall the app after adding `im:write`, reconcile stored workspace scope metadata with an audit record, and retry only an exact failed intent set with no outbound message or external receipt.
- Regression check: Production preflight, both `conversations.open` probes, exact retry dry-run, targeted `onboarding-only` job, and receipt readback for the two selected Persons; migrated PostgreSQL retry test rejects an existing outbound message.
- Status: fixed

### 2026-10-04: Requirements PR interpreted as implementation
- Symptom: onboarding requirements discussion produced an unsolicited implementation PR.
- Expected: document the grilled requirements only.
- Root cause layer: context; PR artifact type was inferred incorrectly.
- Harness fix: preserve the artifact requested by the discussion; implementation requires its own user instruction.
- Regression check: compare PR changed files against the requested artifact before pushing.
- Status: fixed; implementation reverted and PR converted to documentation.
