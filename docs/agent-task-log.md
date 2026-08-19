# Agent Task Log

Use this file to measure harness quality. Add one row after each implementation, review, debugging, or operations task.

Result values:

- `success`: task met completion criteria.
- `partial`: task made progress but verification, environment, or scope is incomplete.
- `failure`: task did not meet completion criteria.

Failure layer values:

- `none`
- `instructions`
- `context`
- `architecture`
- `verification`
- `environment`
- `workflow`
- `tooling`

| Date | Task | Result | Failure layer | Verification | Next harness fix |
| --- | --- | --- | --- | --- | --- |
| 2026-08-15 | Create diagnostic loop harness | success | none | `git diff -- AGENTS.md docs/agent-failures.md` | Track task outcomes daily |
| 2026-08-15 | Review and harden Epic 10 MAF-first regression stories | success | none | API/worker/application/contracts targeted tests, agent-service prompt pytest, smoke self-check, `pnpm typecheck`, `pnpm maf:primary:app:smoke` | None |
| 2026-08-15 | Fix production MAF acceptance analytics cohort handling | success | none | `bash -n scripts/maf-production-acceptance.sh`, `pnpm run maf:prod:acceptance` | None |
| 2026-08-15 | Fix Slack mentor English-only engaged replies | success | none | `pytest` provider/workflow tests, `ruff check`, Cyrillic scan | None |
| 2026-08-15 | Deploy and smoke-test Slack mentor English-only fix | success | none | Railway deploy status, production user reset counts, Slack DM smoke, runtime DB evidence | None |
| 2026-08-15 | Fix contextual Slack mentor support replies | success | none | `pytest` provider/workflow tests, `ruff check`, Cyrillic scan | None |
| 2026-08-15 | Patch contextual Slack mentor support smoke regression | partial | verification | Slack DM smoke, targeted pytest, ruff, Cyrillic scan | Keep a production-shaped regression for stock support follow-up routing |
| 2026-08-15 | Let MAF replies follow user language | success | none | `pytest agent-service/tests/unit/test_model_provider_prompt.py`, `ruff check`, worker conversation test | None |
| 2026-08-15 | Deploy user-language fix and start real Slack prod check | partial | environment | GitHub push, Railway agent-service/worker deploy success; Slack connector DM not ingested | Keep a regression user token or documented manual Slack step for real-user event checks |
| 2026-08-15 | Retry real Slack prod language check via connector | partial | environment | Slack DM sent; prod DB poll returned no outbound; Slack history shows `Sent using ChatGPT` only | Use manual user DM or add regression user token for real Slack event checks |
| 2026-08-15 | Verify user-language fix in correct Slack prod DM | success | none | Slack `D0BJDC2MPE2` marker `20260815T1730Z`, DB `maf_primary/reply_committed`, Russian outbound | None |
| 2026-08-15 | Inspect Roman production Slack/runtime logs | success | none | Prod DB messages/runtime attempts; API/worker Railway logs for latest Roman traces | Replace Cyrillic-only locale override if Ukrainian must stay Ukrainian |
| 2026-08-15 | Add language detector for Roman locale routing | success | none | `pnpm --filter @entalent/worker test -- conversation.processor.test.ts`, `pnpm --filter @entalent/worker typecheck` | None |
| 2026-08-15 | Deploy language detector and verify Ukrainian Slack reply | success | none | GitHub push `4a709e9`, Railway api/worker success, Slack marker `20260815T1848Z`, DB `maf_primary/reply_committed` Ukrainian outbound | None |
| 2026-08-18 | Limit today's pulse test to autonomy questions | success | none | `pnpm --filter @entalent/application test -- pulse-backlog.service.test.ts`, `pnpm --filter @entalent/application typecheck`, `pnpm --filter @entalent/worker typecheck` | None |
| 2026-08-18 | Restore TS warm greeting opener and deploy prep | success | none | `pnpm --filter @entalent/application test -- reply-plan.test.ts`, `pnpm --filter @entalent/ai-openai test -- respond.test.ts`, `pnpm --filter @entalent/contracts typecheck`, `pnpm --filter @entalent/application typecheck`, `pnpm --filter @entalent/ai-openai typecheck`, `git diff --check` | Verify real Slack `Hi` after Railway auto-deploy |
| 2026-08-18 | Add TS language policy contract | success | none | `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`, `pnpm --filter @entalent/ai-openai test -- respond.test.ts openai-provider.test.ts`, `pnpm --filter @entalent/application typecheck`, `pnpm --filter @entalent/application build`, `pnpm --filter @entalent/ai-openai typecheck`, `pnpm --filter @entalent/worker typecheck`, `git diff --check` | None |
| 2026-08-18 | Extend language policy to valid profile languages | success | none | `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`, `pnpm --filter @entalent/ai-openai test -- respond.test.ts openai-provider.test.ts`, `pnpm --filter @entalent/application typecheck`, `pnpm --filter @entalent/application build`, `pnpm --filter @entalent/ai-openai typecheck`, `pnpm --filter @entalent/worker typecheck`, `git diff --check` | None |
| 2026-08-18 | Blind Hunter review of TS language policy diff | success | none | CodeGraph and targeted diff/call-site inspection | Add focused follow-up/reminder language-policy regression tests |
| 2026-08-18 | Edge Case Hunter review of TS language policy diff | success | none | CodeGraph, targeted diff inspection, language boundary scan | Reuse one language resolver across TS and MAF candidate paths |
| 2026-08-18 | Fix Slack connector ambiguous-turn language regression | success | verification | `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts` | Keep real Slack connector attribution in language-policy regressions |
| 2026-08-18 | Run live Slack acceptance pass for TS runtime | success | none | Slack DM `D0BJDC2MPE2`; prod DB messages/runtime/memory/survey/reminder checks | Track dialogue continuity findings from real user-like turns |
| 2026-08-18 | Continue live Slack acceptance for dialogue edge cases | partial | architecture | Slack DM `D0BJDC2MPE2`; prod DB runtime attempts; Railway worker logs | Fix classifier unsupported `closing` intent and tighten backchannel pacing |
| 2026-08-19 | Audit communication architecture with multi-agent BMad and Ponytail reviews | success | none | CodeGraph call paths, BMad spine lint, three reviewer reports, targeted runtime schema parity test (failure surfaced) | Harden auth/tenant/idempotency/ledger boundaries, then converge on one TypeScript prepare-render-commit path |
| 2026-08-19 | Audit Slack conversation architecture and run BMad good-spine gate | success | none | CodeGraph call paths; `lint_spine.py` zero findings; rubric/version/adversarial review | Update stale runtime ADs before the next architecture-led implementation |
| 2026-08-19 | Audit conversation state/read architecture and adversarial divergence | success | none | CodeGraph flow/node audit; BMad two-unit divergence review; `git diff --check` | Choose one attempt-context authority and make ledger phases reflect actual commits |
| 2026-08-19 | Review safe production traffic switch from MAF to TypeScript | success | none | CodeGraph flag/worker/Slack idempotency paths; Railway deploy runbook; smoke command relevance | Exercise global kill-switch rollback and add ingress recovery evidence before any MAF retirement |
| 2026-08-19 | Audit worker/MAF communication and run BMad version-reality gate | success | none | CodeGraph end-to-end trace; registry/version checks; spine lint; runtime-contract parity pytest (1 product failure found) | Repair packaged OpenAPI parity, then align ledger phases with idempotent TS commits |
| 2026-08-19 | Plan MAF retirement and TypeScript runtime restoration | success | none | PRD/epics/story/runbook review, CodeGraph runtime trace, three agent plans, Sprint Change Proposal review | Obtain explicit approval before backlog, code, flags, or Railway changes |
| 2026-08-19 | Replan from MAF cleanup to TypeScript mentor quality | success | none | CodeGraph TS flow review, dialogue spine/ADR review, three agent roadmaps, revised Sprint Change Proposal, `git diff --check` | Approve revised Epic 11; execute direct TS/measurement slice first |
| 2026-08-19 | Implement Story 11.1 direct TS path and decision baseline | partial | verification | application/worker focused tests and typechecks; script tests; local migrated-Postgres report; adversarial review; sim gate 6/8 scenarios green | Fix gate failure classification, then address terse pacing in Story 11.2 and reassess memory grounding |
