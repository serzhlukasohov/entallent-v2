# QA test workflow

How QA turns a bot bug or a new idea into a repeatable sim test. Details live in the linked READMEs; this page is the map. Where QA tests sit among the other test levels: `docs/testing/test-levels.md`.

## The pieces

- **Precondition**: a JSON file with the state before the test (history, memory, goals, style, onboarding, pulse cycle, scheduled actions, start time) plus presets for hard-to-reach states. Lives in `packages/conversation-sim/preconditions/`. Format: `packages/conversation-sim/report/README.md` (Preconditions).
- **QA test**: a JSON file with a precondition reference, the employee replies, expected results in plain language (checked by the judge) and optional hard checks. Lives in `packages/conversation-sim/qa-tests/`. Format: `packages/conversation-sim/qa-tests/README.md`.
- **Report**: `pnpm sim` writes a JSON suite report; `pnpm sim:report:html` renders it (Given, steps with side-effect icons, expected vs actual).
- **Trace**: for tenants with tracing on, the worker stores each turn's state and decisions (encrypted, 30 days). QA reads it only through the admin API.

## Path A: a bug seen in Slack (test tenant)

1. Give Claude the Slack screenshot (skill `qa-screenshot-to-test`; say "баг з слаку" or "screenshot to test").
2. Claude finds the conversation and the turn, renders its trace and explains why the bot answered that way.
3. Claude extracts the precondition (state before the bad reply) and a test draft whose first reply is the employee message that triggered it.
4. Write the expected behavior with Claude; it promotes the draft into `qa-tests/` (`pnpm sim:qa:promote`).
5. Run the test (it should fail while the bug exists) and attach the file to the ticket or PR.

Without Claude: `pnpm trace:export -- --tenant <uuid> --search "<text>"`, then `--conversation <id>` to view and `--extract <trace row id>` to write the files.

## Path B: a test from scratch

1. Write the employee replies in a recording file (`qa-tests/recordings/*.json`), optionally with a base precondition or presets.
2. `pnpm sim:record <recording.json> --live --html` runs them once against the real coach and writes a candidate precondition plus a report to `precondition-candidates/<name>/`.
3. Review the report. If the state is right, `pnpm sim:approve <candidate dir>` moves it to `preconditions/recorded/`.
4. Write the QA test with `"precondition": "recorded/<name>.json"`, your next replies and expected results. Setup turns are not replayed, so the run is cheaper and stable.

## Running

- One QA test: `pnpm --filter @entalent/conversation-sim sim -- src/scenarios/qa-tests.sim.test.ts -t <test id>`; add `pnpm sim:report:html` for the page.
- QA tests call the model (judge and coach). They are never part of `pnpm test`, `harness:check` or CI.

## Prerequisites

- Model credentials in `.env` (Azure OpenAI or OpenAI) for recording and running.
- For Path A: tracing on for the tenant (`feature_flags` key `conversation_trace`), the tenant marked as a test tenant (`conversation_trace_test_tenant`), admin trace routes enabled (`CONVERSATION_TRACE_ADMIN_ENABLED=true`), and `TRACE_API_BASE`, `ADMIN_API_KEY`, optionally `TRACE_TENANT_ID` in `.env`. Only turns traced after both flags were set can be used. See `docs/superpowers/railway-deploy.md` (Conversation trace).
- Never mark a tenant with real employees as a test tenant; traced conversations become repository fixtures.

## Known limits

- Proactive check-ins and the failed-turn fallback are not traced yet.
- A precondition cannot hold the active topic, pending confirmation bundles or clarifications; extraction lists them as gaps.
- During recording the pulse cycle does not progress; use the `cycle-open` preset for cycle states.
