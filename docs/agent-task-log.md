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
