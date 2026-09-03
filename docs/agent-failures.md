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
- Status: open

```

## Open Failures

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
- Symptom: `pnpm exec dotenv -e .env -- pnpm test:integration` exits successfully while all 19 database tests are skipped because Turbo does not pass `DATABASE_URL` to the package task.
- Expected: With a local database URL present, the documented root command should execute the integration tests or fail clearly.
- Root cause layer: workflow
- Harness fix: Declare the integration environment in Turbo or load `.env` inside the database integration command; fail when every integration test is skipped in an intended DB run.
- Regression check: `pnpm exec dotenv -e .env -- pnpm test:integration` must report 19 executed tests, not 19 skipped.
- Status: open

## 2026-08-19: TS quality gate misclassifies repeated memory assertion
- Symptom: Story 11.2 made `terse-user` pass hard/judge, but `memory-recall` again failed its required-grounding assertion and the console again mislabeled the product assertion as `infra_failed`, causing an unnecessary retry.
- Expected: The gate should report the memory assertion as a hard product failure without an infrastructure retry; turn-taking scenarios should remain green.
- Root cause layer: verification
- Harness fix: Classify scenario assertion failures separately from model/network failures in the gate runner; address memory grounding in its own story rather than expanding Story 11.2.
- Regression check: `SIM_GATE_RUNS=1 pnpm sim:gate`
- Status: open

## 2026-08-19: packaged Python runtime schema drifted from canonical OpenAPI
- Symptom: `test_python_service_packages_shared_runtime_openapi_schema` fails because the packaged Python schema omits `greeting_opens_conversation`.
- Expected: The deployable Python artifact must exactly match `packages/contracts/runtime/openapi.json`.
- Root cause layer: workflow
- Harness fix: Generate or copy the packaged schema from the canonical file during build and run parity in the default CI/pre-push path.
- Regression check: `agent-service/.venv/bin/pytest agent-service/tests/unit/test_runtime_contract.py::test_python_service_packages_shared_runtime_openapi_schema -q`
- Status: open

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
