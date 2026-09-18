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
- Status: fixed

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
