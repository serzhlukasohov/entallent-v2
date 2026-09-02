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

## 2026-08-24: GitHub auth/permission unavailable for PR creation
- Symptom: `git push -u origin codex/grill-session-docs` failed with `could not read Username for 'https://github.com': Device not configured`; SSH push failed with `Permission denied (publickey)`; `gh` was not installed. Reproduced on 2026-09-02 after GitHub CLI auth was configured: account `yjinia` is authenticated, but push to `serzhlukasohov/entallent-v2` is denied with HTTP 403.
- Expected: A requested PR should be pushed and opened from the local branch.
- Root cause layer: environment
- Harness fix: Configure GitHub auth for an account with write access to the repo, grant `yjinia` write access, or push to a fork and open a cross-repo PR.
- Regression check: `git push -u origin <branch>` with the intended account or authenticated PR creation through the GitHub connector.
- Status: open

## Fixed Failures

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
