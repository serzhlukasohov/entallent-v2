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
| 2026-08-19 | Implement Story 11.2 natural TypeScript turn-taking | success | none | adversarial/edge review; focused tests 80/80; package typecheck/lint; full pre-push; script tests; sim gate terse-user PASS | Keep memory grounding in Story 11.3 and fix gate failure classification separately |
| 2026-08-20 | Implement Story 11.3 minimal continuity and real goals | success | none | focused tests 90/90; application/AI/worker full tests 533/533; four-package typecheck/lint; adversarial and edge review; live sim gate 8/8 hard/judge | None |
| 2026-08-20 | Add continuity/goal decision metadata in TS outbound message trace | success | none | `pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts`; application/ai-openai/worker/conversation-sim typecheck+lint | None |
| 2026-08-20 | Verify Slack connector live path in current environment | partial | environment | `pnpm --filter @entalent/api dev`/worker dev start attempts; `curl` to `/api/v1/channel/slack/events` | Add/restore local infra precheck so DB/Redis are guaranteed reachable before connector smoke |
| 2026-08-20 | Verify live Slack connector through installed Slack app | success | none | Slack DM `D0BJDC2MPE2` marker `connector-smoke 2026-08-20 12:35 CEST`; EnTalent replied in Russian with current Atlas-9 focus | None |
| 2026-08-20 | Verify recent TS conversation work after Slack connector smoke | success | none | focused application/ai-openai/worker tests; package typecheck/lint; `git diff --check`; live `terse-user` sim outside sandbox PASS | None |
| 2026-08-20 | Restore question-led conversation engagement | partial | environment | application 49/49, AI 27/27, MAF prompt 16/16; TS typecheck/lint; worker typecheck; ruff | Run explicitly authorized live `terse-user` sim; clean pre-existing model-provider mypy errors |
| 2026-08-20 | Prepare exact Yjinia dialogue replay through Slack connector | partial | workflow | Read EnTalent DM; Railway api/worker/agent-service all run `194e21c`; fix exists only locally | Obtain explicit commit/push authorization, await auto-deploy, then replay three messages |
| 2026-08-20 | Deploy question-led engagement and replay exact Yjinia dialogue | success | none | commit `9ddd4a6`; pre-push 23/23 typecheck, 23/23 lint, 15/15 test tasks; Railway four-service SUCCESS; Slack DM `D0BJDC2MPE2` exact replay ends with a specific follow-up question | Add an isolated Slack regression identity/channel to prevent prior Atlas-9 grounding |
| 2026-08-22 | Package and push Story 11.3 branch | success | none | commit `926f895`; pre-push 23/23 typecheck, 23/23 lint, 15/15 test tasks; script regressions; branch pushed | None |
| 2026-08-22 | Fix direct address and current-intent fidelity in TypeScript mentor | partial | environment | BMad blind/edge review; AI 67/67; application 329/329; focused 34/34; typecheck/build/lint; sim typecheck/lint; `git diff --check` | Run an explicitly authorized live Annna-style replay without MAF |
| 2026-08-28 | Deploy and live-verify direct address/current-intent fix | success | workflow | commit `a4f031f`; full pre-push; Railway api/worker SUCCESS; Slack Web replay in `D0BJDC2MPE2`; four jobs `mode=normal`; connector marker `1787868032.128609` received and answered | Harden Socket Mode reconnect separately |
| 2026-08-28 | Hard-reset Serhii and replay the exact Annna dialogue | success | instructions | Production-scoped user cascade reset; original 15 turns recovered; first replay exposed leading-`yes` misclassification; commit `0186451`; second clean replay persisted `correction`, 30/30 messages, all TypeScript `mode=normal` | Add this exact transcript to a durable model-backed eval when approved |
| 2026-08-28 | Remove Annna replay state and harden Slack Socket Mode disconnect | success | architecture | Guarded production delete removed 1 conversation/30 messages; `@slack/socket-mode` 2.0.7; lifecycle regression; API 92/92; full typecheck/lint/tests; script tests outside sandbox; API build | Commit/push and run production health plus live Slack acceptance when approved |
