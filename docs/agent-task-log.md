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
| 2026-08-21 | Install Codex `grill-with-docs` skill | success | environment | `ls ~/.codex/skills/grill-with-docs`, `sed -n '1,120p' ~/.codex/skills/grill-with-docs/SKILL.md` | Prefer skill-installer helper when `npx` is unavailable |
| 2026-08-21 | Grill current TypeScript project and capture docs | success | none | Repo/docs/code inspection; added ADR/glossary/grill notes | Convert accepted grill conclusions into scoped cleanup stories |
| 2026-08-21 | Test Slack agent memory in DM | success | none | Slack DM `D0BJUPS0JUC`: context recall prompt plus explicit `синяя папка` marker recall | Add delayed/cross-session memory check if persistent memory needs validation |
| 2026-08-22 | Capture grill session product truths | success | none | Product truth notes and glossary terms updated; `git diff --check` docs-only pass | Turn confirmed privacy/consent rules into implementation acceptance criteria |
| 2026-08-22 | Refine grill insight pipeline and confirmation UX | success | none | Updated grill notes/glossary; `git diff --check` docs-only pass | Map temporary/permanent/team insight states to DB schema |
| 2026-08-22 | Capture temporary insight/report lifecycle rules | success | none | Updated grill notes/glossary; `git diff --check` docs-only pass | Define feature gating for dev dashboard vs customer reporting |
| 2026-08-22 | Capture organization hierarchy and reporting cohort rules | success | none | Updated grill notes/glossary; `git diff --check` docs-only pass | Model cohort roll-up and team-transfer reset rules in schema |
| 2026-08-24 | Prepare grill session handoff and PR package | partial | environment | Handoff doc added; docs commit created; push/PR blocked by missing GitHub auth/CLI | Configure GitHub auth, then push branch and open PR |
| 2026-08-31 | Consolidate collected grill requirements | success | none | Created English requirements document; `git diff --check` docs pass | Use requirements as source for implementation stories |
| 2026-09-02 | Attempt to open grill docs PR | partial | environment | Local branch/commits ready; `gh auth status` OK for `yjinia`; push blocked by repo write permission 403 | Grant repo write access or push to fork, then open PR |
| 2026-09-02 | Open grill docs PR after access grant | success | none | `git push -u origin codex/grill-session-docs`; `gh pr create` -> PR #5 | Continue review on PR #5 |
| 2026-09-03 | Audit PR #5 requirements against the TypeScript product and build a BMad/Ponytail remediation plan | success | none | CodeGraph, three BMad review layers, Ponytail review, typecheck, 317/318 application tests, API 91/91, worker 140/140, AI 56/56, DB integration 19/19, dashboard build | Fix the stale unit assertion, then implement the reportable-insight and cycle-scoped cohort boundaries |
| 2026-09-03 | Make PR #5 product requirements executable | success | none | 47 sequential requirements and traceability rows; BMad blind review; contract structure check; `git diff --check` | Use the progress table to implement one gap at a time |
| 2026-09-03 | Repair application test baseline for acknowledgement topic context | success | tooling | Focused application tests 38/38; full application tests 318/318 | Persist onboarding disclosure before reportable confirmation |
| 2026-09-03 | Implement REQ-015 reporting disclosure receipt | success | none | Application, worker, contracts, AI, Slack adapter, simulation receipt, lint, root typecheck, local DB integration, `git diff --check` | Bind the exact displayed summary next; keep report outbox as a separate slice |
| 2026-09-03 | Bind confirmation to the exact delivered summary | success | tooling/environment | Contracts 81/81, AI 63/63, application 336/336, worker 161/161, PostgreSQL integration 22/22, root typecheck/lint, `git diff --check` | Add typed de-identification acceptance before confirmation |
| 2026-09-03 | Run live Slack REQ-012 conversation smoke | blocked | tooling | `slack_read_channel` read `D0BJDC2MPE2`; approval review rejected outbound marker before delivery | Obtain renewed explicit approval for the exact Slack send and resume from one marker |
| 2026-09-03 | Retry live Slack REQ-012 smoke after explicit approval | partial | tooling | Sent one marker to `D0BJDC2MPE2`, Slack returned `ts=1788463829.146359` and message link, search found marker, read/search returned opaque `ccr:` transcript references | Get model-readable Slack transcript before follow-up turns |
| 2026-09-03 | Collect production DB evidence for Slack REQ-012 marker | partial | workflow | Production DB has inbound `06b8ec65-038f-4f06-8b10-f297614059c7` and outbound `6a9469a6-234e-4877-bcea-51ea1acde825`; outbound metadata is continuation with `replyShape.askedQuestion=true`, no confirmation summary | Use local branch deterministic confirmation test or deploy branch before live REQ-012 smoke |
| 2026-09-03 | Verify current branch REQ-012 exact displayed summary | success | none | AI provider 49/49, application orchestrator 43/43, worker confirmation delivery 16/16, contracts 81/81, root typecheck, PostgreSQL integration 22/22 | Proceed to typed de-identification acceptance gate |
| 2026-09-03 | Fix post-disclosure pending confirmation handoff | success | architecture | `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts`, `pnpm --filter @entalent/application typecheck`, `git diff --check` | Deploy api/worker and rerun real Slack confirmation cycle |
| 2026-09-03 | Harden delivered confirmation prompt state recovery | success | architecture | `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/message-send/message-send.processor.test.ts`, `pnpm --filter @entalent/worker typecheck`, `git diff --check` | Push/deploy worker and confirm real Slack agreement path |
| 2026-09-03 | Fix raw Date parameters in group confirmation SQL | success | architecture | `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/message-send/message-send.processor.test.ts`, `pnpm --filter @entalent/worker typecheck`, `git diff --check` | Push/deploy worker and rerun Slack agreement path |
