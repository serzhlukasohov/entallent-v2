# QA tests

Every `*.json` file directly in this folder is one test of the next `pnpm sim` run: the employee
replies go to the real coach, starting from the referenced precondition, the judge checks the
expected results, and the hard checks run as code. No test code is needed.

Files in subfolders (such as `examples/`) are not run. To add a test, copy
`examples/release-week-no-pulse-question.json` here and edit it.

| Field | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `title` | yes | what the test checks, in one line |
| `precondition` | yes | precondition file, relative to and inside `packages/conversation-sim/preconditions/` (see `report/README.md`, "Preconditions") |
| `replies` | yes | employee messages, sent in order; each gets one bot reply |
| `expected` | one of `expected` / `hardChecks` | expected results in plain language; the judge marks each met or not met |
| `hardChecks` | one of `expected` / `hardChecks` | checks from the menu below |
| `jira` | no | Jira key, shown in the report |
| `story` | no | BMad story id, shown in the report |
| `tags` | no | tags, shown in the report |

Hard checks (menu v1). `no-question`, `no-pulse-question` and `reply-under` take an optional `turn`, the 1-based
reply to check; without it, every reply is checked. `memory-contains` and `escalation` look at the whole run.

| Check | Example | Met when |
|---|---|---|
| `no-question` | `{ "check": "no-question", "turn": 2 }` | the reply has no question mark sentence |
| `no-pulse-question` | `{ "check": "no-pulse-question" }` | the bot asked no pulse topic question or survey probe |
| `memory-contains` | `{ "check": "memory-contains", "text": "QA handoff" }` | some active memory item after the run contains the text (case-insensitive). Precondition memory counts too, so pick text the precondition does not already hold |
| `escalation` | `{ "check": "escalation", "raised": false }` | an escalation was raised (`true`) or none was (`false`) |
| `reply-under` | `{ "check": "reply-under", "chars": 600 }` | the reply is shorter than `chars` characters (an emoji counts as one) |

A file with a wrong `schemaVersion`, an unknown field, an unknown check or a missing precondition shows
as a failing test with the error. In the suite report the test's description block shows Jira, story
and tags (`—` when missing), and the expected-vs-actual table has one row per expected result and one
per hard check.

## Recording a precondition

When no precondition holds the state a test needs, write the employee replies that lead there and
record them once. Commands below run from `packages/conversation-sim`; from the repo root, prefix
the paths with `packages/conversation-sim/` (paths resolve against the folder pnpm started in).
A recording file (example: `recordings/onboarded-release-week.json`):

| Field | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `name` | yes | kebab-case; becomes the candidate folder and the approved file name |
| `description` | no | carried into the precondition |
| `base` | no | starting state: a path inside `preconditions/`, or an inline precondition such as `{ "schemaVersion": 1, "presets": ["onboarding-done"] }`; absent means an empty conversation |
| `replies` | yes | employee messages, sent in order |

1. `pnpm sim:record qa-tests/recordings/<file>.json --live [--html]` runs the replies once through
   the real coach (this calls the model). `--scripted` runs the same flow with canned bot replies and
   no model, to check the file. The provider is never implied.
2. The candidate lands in `precondition-candidates/<name>/precondition.json`, with the suite report in
   `precondition-candidates/<name>/runs/report.json` (and `report.html` with `--html`): Given is the
   base, the steps are the recorded turns. The candidate holds the state after the last reply:
   history with the bot replies, memory, goals, style profile, onboarding, pulse cycle and pending
   scheduled actions. Presets of the base are already expanded into it.
3. Review both. Edit the candidate JSON if needed (for example the last `minutesBeforeStart`).
4. `pnpm sim:approve precondition-candidates/<name> [--by <name>]` marks it approved (who, when, next
   to how it was recorded) and moves it to `preconditions/recorded/<name>.json`; the approver defaults
   to `git config user.name`. A scripted recording is refused unless `--allow-scripted` is passed.
   Alternatively a reviewer approves in a PR by moving the file there with `approved: true`,
   `approvedBy` and `approvedAt` filled in.
5. Reference it from a QA test as `"precondition": "recorded/<name>.json"`. The history is seeded, not
   replayed, so no model call happens before the test's first reply.

A candidate is never test state: it sits outside `preconditions/`, so a QA test cannot reference it,
and any `recorded` precondition without an approval fails to load. The pulse cycle is exported as the
harness holds it; the sim cycle does not progress during a recording, so it equals the base cycle.

Framework tests check these formats without a model: `pnpm --filter @entalent/conversation-sim test`.

## A test from a traced production turn

When a bot reply in a traced test tenant's Slack looks wrong, turn that turn into a test whose
precondition is the state the coach read before replying and whose only reply is the employee
message that triggered it.

1. The tenant must be marked as a test tenant, because its conversations become repository files:
   `insert into feature_flags (key, tenant_id, enabled) values ('conversation_trace_test_tenant', '<tenant uuid>', true)`
   (`enabled = false` removes the mark; a global row with no tenant never counts). Tracing itself is
   the separate `conversation_trace` flag. Never mark a tenant with real employees. Only turns traced
   after the mark (the flag row's `updated_at`) can be extracted; older ones answer `403 traced_before_test_mark`.
   `(key, tenant_id)` is unique, so there is one marker row per tenant: unmark by updating it to `enabled = false`; re-marking (`enabled = true`) moves the mark to that moment.
2. Find the turn: `pnpm trace:export -- --tenant <uuid> --search "<fragment>"` prints `trace <row id>`.
3. `pnpm trace:export -- --tenant <uuid> --extract <row id>` (API with `CONVERSATION_TRACE_ADMIN_ENABLED=true`,
   `TRACE_API_BASE`, `ADMIN_API_KEY`) writes `preconditions/traced/trace-<id>.json` and the draft
   `qa-tests/drafts/trace-<id>.json`. It refuses to overwrite without `--force`. Every call is audited as
   `admin.conversation_trace_precondition_extracted`.
4. Read the printed fidelity gaps (they are also in the precondition `description`): state the
   precondition format cannot hold, such as a pending confirmation bundle or the conversation's
   active topic, is listed there instead of guessed.
5. Write `expected` (and hard checks) in the draft, then move it to `qa-tests/trace-<id>.json`. Drafts
   are never run, and a draft moved without an expected result fails validation.

Only turns traced after state capture was added hold the history and state needed; older rows answer
`409 trace_state_not_captured`. The history is the coach's own window (the last 20 messages).

## A test from a Slack screenshot (Claude skill)

Give Claude Code (in this repository) a screenshot of the Slack conversation and say which bot reply is
wrong, for example "баг з слаку, ось скріншот, друга відповідь бота не мала питати". The project skill
`qa-screenshot-to-test` reads the messages, finds the traced conversation with a few text fragments, asks
you when two conversations or turns fit, shows the turn's trace (the conversation report page plus a
summary of what the classifier understood, the reply plan, the inputs, writes, queued jobs and warnings),
extracts the precondition and draft as above, helps you write `expected` and pick hard checks, and moves
the finished file into `qa-tests/` with `pnpm sim:qa:promote`. It never reads the database and never runs
the test: it prints the command (`pnpm --filter @entalent/conversation-sim sim -- src/scenarios/qa-tests.sim.test.ts -t "<id>"`), which calls the model.

Prerequisites, once per machine and tenant:

- The tenant has tracing on (`conversation_trace` flag) at the time the bug happened, and is marked as a
  test tenant (step 1 above). The turn must be younger than the 30-day retention.
- The API you point at runs with `CONVERSATION_TRACE_ADMIN_ENABLED=true`.
- `.env` holds `TRACE_API_BASE` (https, or localhost), `ADMIN_API_KEY`, and `TRACE_TENANT_ID` (the test
  tenant; otherwise Claude asks for it once). Never paste the key into the chat.

`pnpm sim:qa:promote <draft.json>` also works by hand: it validates a draft like the runner does (no model
call) and moves it into `qa-tests/`, refusing to overwrite an existing test.
