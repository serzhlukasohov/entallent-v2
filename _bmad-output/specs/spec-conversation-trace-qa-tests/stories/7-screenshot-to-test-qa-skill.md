---
title: 'Screenshot-to-test QA skill'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4' # HEAD; the tree was already dirty (stories 1-6 uncommitted)
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/stories/6-precondition-from-a-traced-turn.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 5-6 let QA find, view and extract a traced turn, but only by typing fragments, reading trace-row ids and running three CLI modes by hand. QA holds a Slack screenshot, not ids (SPEC CAP-9).

**Approach:** A Claude Code project skill `.claude/skills/qa-screenshot-to-test/` reads the screenshot, finds the conversation and turn through `pnpm trace:export` only, renders the conversation, summarises the chosen turn, extracts the CAP-8 draft, helps QA write `expected` and hard checks, and promotes the finished file into `qa-tests/`. The CLI gains machine output and multi-fragment search so the skill parses data instead of prose; the sim package gains a non-LLM promote command.

## Boundaries & Constraints

**Always:**
- The skill reaches trace data only through `pnpm trace:export` (admin API, tenant-scoped, audited). Allowed tools: that CLI, `pnpm sim:qa:promote`, reading/editing files under `packages/conversation-sim/{qa-tests,preconditions/traced}` and the export it wrote under `runs/trace-exports/`.
- Tenant: `--tenant` falls back to `TRACE_TENANT_ID`; when neither is known the skill asks QA once and reuses the answer in the session.
- Matching uses 2-3 distinctive fragments (employee messages first, 3-8 words, no emoji, no quotes or digits OCR may garble), searched in one CLI call; the candidate conversation is confirmed by comparing the export's message order with the screenshot before any extraction. The turn is the bot reply QA marked; when unmarked or ambiguous, the skill asks with a numbered list.
- Zero matches: retry once with shorter fragments, bot fragments and `--days 30`, then report the prerequisites (tracing flag, admin routes, retention) instead of guessing. Several conversations tied: show them (time, snippets) and ask.
- Machine output (`--json`) goes to stdout as one JSON document; human messages and the HTML renderer's output go to stderr.
- `expected` is written in QA's words (observable behavior, one item per line); the skill proposes, QA confirms.

**Never:**
- No `psql`, Drizzle, `DATABASE_URL`, `.env` reads, `env`/`printenv`, or printing `ADMIN_API_KEY`; no API calls other than through the CLI.
- No live sims, `pnpm sim`, `sim:gate`, `harness:check`; the skill only tells QA the command that runs the test.
- No API, schema, worker or bot-behavior change; no MAF or `agent-service`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Multi search | `--search a --search b --json` | one JSON: per-search counts; conversations sorted by fragments hit, each with its matches | a failed search aborts with the API status |
| Single search | one `--search` | unchanged human output; with `--json` the API response | N/A |
| Tenant default | no `--tenant`, `TRACE_TENANT_ID` set | used | invalid uuid → usage error |
| Conversation index | `--conversation c --json` | `{reportJson, reportHtml, conversationId, turns:[{step, traceRowId, status, employee, bot, missing}]}` | turn without a readable trace id → `traceRowId: null` |
| Turn detail | `--conversation c --turn t --json` | index plus `detail` (sections, badges) of that turn | unknown `t` → exit 2, nothing printed on stdout |
| Extract | `--extract t --json` | `{name, preconditionPath, draftPath, gaps}` | API refusal → stderr with code, exit 2 |
| Promote | `sim:qa:promote qa-tests/drafts/x.json` | validates via `loadQaTest`, moves to `qa-tests/x.json` | invalid draft or existing target → error, file stays |

</frozen-after-approval>

## Code Map

- `scripts/trace-export.mjs` -- CLI of stories 5-6; add `--json`, repeatable `--search` (max 5), `--turn`, `TRACE_TENANT_ID` fallback; renderer stdout to stderr in json mode.
- `scripts/trace-export-lib.mjs` (new) -- pure helpers `groupSearchResults`, `conversationIndex`, `turnDetail`; trace row id read from the bot step's `Трейс ходу` section (`трейс` row, first uuid).
- `packages/conversation-trace/src/report/trace-export.ts` -- `buildTraceExportReport`, source of the step/section shape; do not change.
- `packages/conversation-sim/src/qa/load.ts` -- `loadQaTest`, `QA_TESTS_DIR`, `PRECONDITIONS_DIR`; reuse for promote.
- `packages/conversation-sim/src/recording/approve-cli.ts` -- CLI pattern (INIT_CWD, fail helper) for the promote CLI.
- `packages/conversation-sim/src/scenarios/qa-tests.sim.test.ts` -- live runner; QA command `pnpm --filter @entalent/conversation-sim sim -- src/scenarios/qa-tests.sim.test.ts -t <id>`.
- `packages/conversation-sim/qa-tests/README.md` -- runbook of story 6; add the screenshot section.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/trace-export-lib.mjs`, `scripts/trace-export.test.mjs` -- helpers and node:test tests (fixture built with the real `buildTraceExportReport` from the package dist).
- [x] `scripts/trace-export.mjs`, `package.json` -- flags above; add the test to `test:scripts:non-maf`.
- [x] `packages/conversation-sim/src/qa/promote.ts`, `promote-cli.ts`, test, `package.json` (`sim:qa:promote`), root `package.json` passthrough.
- [x] `.claude/skills/qa-screenshot-to-test/SKILL.md` (+ `reference.md` for hard-check phrasing) -- workflow.
- [x] `packages/conversation-sim/qa-tests/README.md`, `.env.example` -- screenshot section and prerequisites; `TRACE_TENANT_ID`.

**Acceptance Criteria:**
- Given a local stub API serving synthetic search/export/extract responses, when the CLI runs as the skill instructs (multi search → conversation index + turn detail → extract → promote), then every step produces the documented JSON and files, and nothing prints the admin key.
- Given existing suites, when script tests and conversation-sim tests run, then all pass; lint and typecheck pass.

## Implementation Notes

- The implementing subagent finished the code and the stub dry run, then stopped before review (session interruption). The parent session ran review and verification. Stub output left in `preconditions/traced/` and `qa-tests/drafts/` was moved out of the repo.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | Skill `allowed-tools` pre-approves unscoped Read/Edit (e.g. `.env`) and `--out`/`--qa-tests` to any path | medium | patch | Read/Edit scoped to qa-tests, preconditions/traced, runs/trace-exports, drafts; skill forbids `--out`/`--qa-tests` |
| 2 | blind | `fetch` follows redirects, forwarding `x-api-key` and search body cross-origin, past the https check | medium | patch | `redirect: 'error'` |
| 3 | verification | CLI matrix rows (stdout purity, exit codes, tenant fallback, refusals) tested only by a manual stub run | medium | defer | Needs a spawn-based stub-API test; deferred-work.md |
| 4 | edge | One `--search` returns the raw API shape, the skill documents only the grouped one | low | patch | Skill requires at least 2 fragments; frozen matrix row kept |
| 5 | edge | Skill ignores min fragment length, `match_limit` and the 100-turn export cap | low | patch | Skill text: 3-char minimum, `--limit 50`, `--turns 200` |
| 6 | edge | Ties between conversations not marked in JSON | low | patch | `tiedWithNext` per conversation + test; skill asks on tie |
| 7 | edge | JSON `step` differs from the HTML `крок N` ordinal | low | defer | Skill now refers to turns by text/traceRowId; exposing the ordinal deferred |
| 8 | edge | Skill calls every `missing: true` turn non-extractable | low | patch | Skill tries extract and relays the API refusal |
| 9 | blind | Promote overwrite check races (`rename` replaces) and accepts drafts from anywhere | low | patch | link+unlink (EEXIST), only `qa-tests/drafts/` accepted; tests |
| 10 | edge | Promote accepts the placeholder `DRAFT -` title | low | patch | Refused in `promoteDraft`; test |
| 11 | edge | Malformed `TRACE_TENANT_ID` reported as missing | low | patch | Separate message |
| 12 | verification | `node --test scripts/trace-export.test.mjs` needs conversation-trace dist in a fresh checkout | low | defer | Turbo builds first in prepush; deferred-work.md |

## Design Notes

Decisions taken without a human (checkpoints waived by Illia): tenant comes from `TRACE_TENANT_ID` or one question, because the admin API has no tenant listing and QA should not handle ids beyond that; fragment intersection lives in the CLI so it is deterministic and tested, not re-derived by the model each run; the trace row id is read from the export's own section instead of widening the API (story 5 stays frozen), and a test with the real report builder catches label drift; promotion validates with the runner's own loader so an unfinished draft cannot enter `qa-tests/`.

## Verification

**Commands:**
- `node --test scripts/trace-export.test.mjs` -- pass.
- `pnpm --filter @entalent/conversation-sim test` -- pass.
- `pnpm lint`, `pnpm exec turbo run typecheck --force --concurrency=1` -- pass.

**Manual checks:**
- Dry walkthrough against a 127.0.0.1 stub with synthetic fixtures; stub output removed afterwards.
