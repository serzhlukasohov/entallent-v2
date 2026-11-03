---
id: SPEC-conversation-trace-qa-tests
companions:
  - precondition-format.md
  - brownfield.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Conversation trace and QA tests from preconditions

## Why

A pain to solve. QA finds bad bot replies in Slack but holds only the chat text. The state behind a reply — memory, goals, pulse cycle progress, onboarding status, classified intent, reply plan, database writes and queued jobs — is invisible, so bugs cannot be analyzed or reproduced. QA can also write employee replies but cannot build that context, so they cannot author sim tests from scratch. The sim harness already records all of this per turn; production records none of it. All current conversations are test conversations, so production tracing is cheap in privacy terms now and must be safe before real users arrive.

## Capabilities

- **CAP-1**
  - **intent:** A sim test starts from a versioned precondition file holding the full state before the test (see `precondition-format.md`).
  - **success:** A test declared with only a precondition file runs in the harness, and its report's Given block shows exactly the file's state; an unknown `schemaVersion` fails the test with a clear message.
- **CAP-2**
  - **intent:** QA adds a test by writing a data file (precondition reference, employee replies, expected result, optional Jira key and BMad story id, tags) with no test code.
  - **success:** Dropping such a file into the QA tests folder adds a test to the next `pnpm sim` suite report with its Jira key, story and tags in the description block (missing ones show as a dash).
- **CAP-3**
  - **intent:** Expected results written in plain language are checked by the judge, plus optional hard checks chosen from a fixed menu.
  - **success:** Every expectation and hard check appears as its own row in the report's expected-vs-actual table with met or not met.
- **CAP-4**
  - **intent:** Named state presets cover states hard to reach by chatting (onboarding done, pulse cycle open with N of M topics closed, time elapsed since the last message) and compose into a precondition.
  - **success:** A precondition made only of presets runs, and the report Given block shows the preset-derived state.
- **CAP-5**
  - **intent:** QA records a precondition from scratch: their replies run live once, the state after them becomes a candidate precondition with a report, and QA approves it into a frozen file.
  - **success:** A test using an approved precondition makes no LLM calls for setup turns; candidates are never picked up by tests until approved.
- **CAP-6**
  - **intent:** The worker records every real conversation turn with the same data the sim trace has (inbound, model calls and results, classification, reply plan, response inputs including memory and cycle state, writes, queued jobs, warnings, errors), captured at turn time.
  - **success:** For a Slack turn in an enabled tenant, the stored trace holds every section the sim report shows for a turn; with tracing disabled, nothing is stored.
- **CAP-7**
  - **intent:** QA finds a traced turn by message text and opens its conversation as the same report page sims produce (chat, side-effect icons, per-turn details).
  - **success:** A text fragment from a test-tenant message finds its turn; the conversation export is report JSON the existing renderer turns into a page showing every traced turn.
- **CAP-8**
  - **intent:** QA picks a bot reply in a traced conversation and gets a test whose precondition is the state before that turn and whose first step is the employee message that triggered it.
  - **success:** Running the extracted test in the harness feeds the orchestrator the same history, memory, goals and cycle state as the original turn did.
- **CAP-9**
  - **intent:** QA hands Claude a screenshot of a Slack conversation; a project skill reads the messages, finds the matching traced conversation and turn, shows its trace, and produces the CAP-8 test draft for QA to finish with expected results.
  - **success:** From a screenshot of a test-tenant conversation, the skill names the matching turn, renders its trace, and writes a test draft without QA supplying any id or link.

## Constraints

- Trace state is captured at turn time, never rebuilt from current database state.
- Tracing is diagnostic only: a trace failure never blocks, delays or alters the turn, the reply, delivery or queued jobs.
- Tracing is off by default behind a per-tenant switch; text and state content are encrypted with `FIELD_ENCRYPTION_KEY`; traces are purged after a retention period; access is tenant-scoped, admin-key protected, and reads and exports are audited.
- `conversation_turn_effects` deliberately stores no text or meaning; the trace gets its own storage instead of widening it.
- The screenshot skill reaches data only through the admin API (tenant-scoped, audited), never by querying the production database; message text is encrypted, so text matching happens server-side.
- Extracting a precondition from a trace is allowed only for tenants marked as test tenants; real employee data never lands in repository fixtures.
- Sim and production share one trace event model, so one renderer serves both.
- Trace recording is wired at the composition root (decorators around ports); application use cases do not depend on trace storage.
- Active runtime stays TypeScript-only; nothing touches MAF or `agent-service`.
- Precondition files carry `schemaVersion`; the harness rejects unknown versions instead of guessing.
- A candidate precondition is never used by tests until explicitly approved, either by the tester's approve command or through a PR.
- Framework tests run without LLM calls; live runs (recording, sims) happen only on explicit request.
- Schema changes go through a new forward Drizzle migration.

## Non-goals

- No in-browser authoring UI for QA; tests and approvals are files plus commands.
- No backfill of traces for turns before tracing was enabled.
- No change to bot behavior, prompts or orchestration decisions.
- The trace does not replace `llm_runs` metrics or Langfuse.
- Anonymizing real employee data for fixtures is out of scope.

## Success signal

- QA gives Claude a screenshot of a bad reply in a test tenant's Slack, sees why the bot answered that way, and gets a test file that reproduces the turn and fails on the bug.
- QA writes a new test from replies alone, records it once, approves the precondition, and from then on `pnpm sim` runs it without setup LLM calls.

## Assumptions

- Approving a candidate is a tester-run command that marks it approved and moves it into the tracked fixtures folder; PR review is optional.
- The first trace view is an admin API export of report JSON rendered by the existing report template; a dashboard page can follow.
- Trace retention defaults to 30 days.
- The per-tenant switch reuses the existing `feature_flags` mechanism.
- Hard-check menu v1: no question asked, no pulse question, memory contains text, escalation raised or not, reply under N characters.
- Delivery order: CAP-1 to CAP-4, then CAP-5, then CAP-6 to CAP-9.
