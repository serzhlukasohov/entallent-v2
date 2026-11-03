# Test report

Every `pnpm sim` run writes its report as JSON. The HTML page is built from that JSON only when asked.

```bash
pnpm sim                      # sims + report/runs/sim-<time>.json (default)
pnpm sim -- --html            # also report/runs/sim-<time>.html
pnpm sim:report:html          # HTML for the newest report/runs/sim-*.json
pnpm sim:report:html -- path/to/report.json [path/to/report.html]
```

Extra arguments after `pnpm sim --` go to Vitest (for example a scenario file). Paths are relative to
`packages/conversation-sim`. `SIM_REPORT_LIVE_ONLY=1` keeps only
tests that called a real model. The run's exit code is Vitest's; a failed report only prints a warning.
`report/runs/` is git-ignored.

Templates kept here:

- `test-report.template.html`: the page. It renders itself from the JSON injected by `render-report.mjs`.
- `suite-report.schema.json`: JSON Schema of the suite report that `pnpm sim` writes.
- `examples/suite-report.example.json`: a two-test suite report (one red, one green) built from a real run.
- `examples/data-use-mixed-disclosure.json`: the older step-by-step single-test format the template still renders.

## Data shape

Only `meta.title` is required. Each other key adds one section; leave it out to drop the section.
Every text field accepts `` `code` `` and `**bold**`.

| Key | Section | Shape |
|---|---|---|
| `meta` | Header | `{ eyebrow, title, summary, details: string[] }` |
| `verdict` | Overall verdict | `{ status: "pass" \| "fail" \| "partial", text }` |
| `stats` | Number tiles | `[{ value, label, tone?: "ok" \| "bad" \| "warn" }]` |
| `scope` | What was checked | `{ title?, panels: [{ title, items: string[] }] }` |
| `pipeline` | How it works | `{ title?, explain?, steps: [{ label, isNew? }], notes?: string[], legend? }` |
| `checks` | All checks | `{ title?, explain?, rows: [{ name, status: "passed" \| "failed" \| "error" \| "partial" \| "skipped" \| "not_run", result, command?, note? }] }` |
| `tables` | Free tables (live runs, before/after) | `[{ title, explain?, columns: string[], rows: Cell[][] }]`, a cell is a string or `{ text, tone?: "ok" \| "bad" \| "warn" \| "muted", kind?: "num" \| "wide" }` |
| `cases` | Scenario cases | `[{ id, eyebrow?, title, subtitle?, verdict, steps: Step[] }]` |
| `notRun` | Not run | `[{ what, why, howToClose? }]` |
| `findings` | Findings and risks | `[{ title, text, status: "open" \| "fixed" \| "bad" }]` |
| `files` | Files and reproduction | `[{ label, path }]` |
| `suite` | Suite report (what `from-sim-run.mjs` writes) | see below |

A case step is one of:

- `{ type: "user" | "bot", title, text, fixedText? }`: a message bubble; `fixedText` is shown muted after the text.
- `{ type: "kv", title, rows: [{ key, value, tone?: "ok" \| "bad" }] }`: classifier output, side effects, decisions.
- `{ type: "judge" | "checks", title, items: [{ met, text }], reasoning? }`: judge criteria or deterministic assertions.
- `{ type: "dialogue", title, items: [{ role: "user" \| "bot", text, label?, notes?: string[], sections?: [{ title, rows: [{ key, value: string \| string[], tone? }], empty? }], seed?, missing? }] }`: a chat; `sections` render as collapsed dropdowns under a message (the turn breakdown), objects as readable key/value trees; an item `{ divider: "text" }` draws a labelled rule and `tested: true` marks a message under test; `seed` marks history that existed before the test, `missing` a message that got no reply; `badges: [{ icon, label, tone?, details: string[] }]` draws small icons under the message (details show on hover).
- `{ type: "info", title, groups: [{ title, items: string[], code? }] }`: titled lists; `code` shows items as source lines.
- `{ type: "raw", title, items: [{ title, json }] }`: collapsed blocks that show JSON as a key/value tree.
- `{ type: "note", title, text }`.

Any step may add `intro` (text shown under the title) and `asides: [{ text, tone?: "warn" \| "bad" }]` (shown after the content).

## Suite report

`suite` renders a test-suite page: one counts line (total / green / red, plus ERROR and skipped when present),
then one collapsed row per test. Opening a test shows four blocks, all open:

- **Опис**: case id, Jira, story, suite, tags, type, purpose, scenario, models, run time. Missing values show as `—`.
  A QA test (`qa-tests/*.json`) takes Jira, story, tags and purpose from its file.
- **Given**: state before the test: user, onboarding, memory, goals, pulse cycle, collected pulse answers, seeded history.
  A run built from a precondition shows the file's name, origin, presets and every state area from it instead.
- **Кроки**: the conversation, bot on the left and employee on the right; under each bot reply, icons for the turn's notable side effects
  (🧠 memory, 🎯 goal, ⏰ reminder/follow-up, 🚨 escalation, 🧵 active topic, ✍️ style, 📊 pulse, 🛡️ risk, ⛔/⚠️ error/warning, 💾/📨 other writes and queues;
  routine message save/delivery and standard background jobs get no icon), then the turn breakdown behind «деталі».
- **Фактичний результат**: expected vs actual for every code check, judge criterion and harness heuristic, then the judge's reasoning.
  A QA test shows one `суддя` row per expected result and one `жорстка перевірка` row per hard check instead of the runner's code checks.

Shape: `{ counts: { total, passed, failed, error, skipped }, tests: [{ id, name, status, duration,
descriptionSummary, description: Row[], given: { summary, rows: Row[], history: DialogueItem[] }, stepsSummary,
steps: DialogueItem[], stepsEmpty?, actual: { summary, failure?, comparisons: [{ source, expected, actual, met: true | false | "info" }],
judge: { title, reasoning? } } }] }`, where `Row` is `{ key, value }` and `DialogueItem` is a `dialogue` step item.

## Preconditions

A precondition file describes the full state before a test, so the Given block shows where a run
started. Example: `preconditions/examples/cycle-open-with-history.json`. Format (validated in
`src/preconditions/schema.ts`; a wrong `schemaVersion` or field fails with the file name and field path):

- `schemaVersion: 1` (required), `name`, `description`, `origin` (`authored`, `recorded`, or `trace` with `tenantId`/`turnId`).
  A `recorded` precondition loads only when `approved: true` with `approvedBy` and `approvedAt`; see "Recording a precondition" in `qa-tests/README.md`.
- `presets`: applied first, in order; explicit fields override them (an object area such as `pulseCycle` merges one level deep, so explicit `topics` replace a preset's).
  `"onboarding-done"`, `{ "name": "cycle-open", "topicsTotal": 3, "topicsClosed": 1 }`, `{ "name": "elapsed", "minutes": 90 }`.
- `user` (`name`, `timezone`) and `startTime` (ISO): the test process clock starts there and keeps running.
- `history`: `{ role: "employee" | "bot", text, minutesBeforeStart?, metadata? }`, oldest first. Without `minutesBeforeStart`
  messages are one minute apart; `elapsedMinutes` (or the `elapsed` preset) moves the whole history so the last message is that old.
- `memory` (`category`, `content`, `importance`), `goals` (`title`, `category`, `status: active | completed | cancelled`), `styleProfile`.
- `onboarding`: `role` plus any `OnboardingState` field to override `initialOnboardingState(role)`.
- `pulseCycle`: `topics: [{ group, questions: [{ id, status }], evidence: [{ summary, status, sourceHistoryIndexes }] }]`,
  `nextProbe: { questionId, focus }`, `open`. Statuses are working-insight statuses; closed = `confirmed`/`declined`.
- `scheduledActions`: `{ type, intent, dueInMinutes, reason?, context? }`, saved as pending.

Use it from a test with a scripted or live provider:

```ts
const harness = await harnessFromPrecondition(loadPrecondition('preconditions/examples/cycle-open-with-history.json'), { aiProvider });
await harness.send('...');
// afterEach: restoreClock();
```

## QA tests

QA adds a test by dropping a JSON file into `qa-tests/` (format and hard-check menu: `qa-tests/README.md`).
`src/scenarios/qa-tests.sim.test.ts` turns each top-level file into one live test; the run report
(`runs/*.json`) gets a `qa` section with Jira, story, tags, every expected result with the judge's
verdict and every hard check with its outcome, written before anything is asserted.

## From an existing run by hand

`run-sim.mjs` does this for `pnpm sim`; use it directly to rebuild a report or merge a rerun:

```bash
pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios --no-file-parallelism \
  --reporter=default --reporter=json --outputFile.json=/tmp/vitest.json
node packages/conversation-sim/report/from-sim-run.mjs --vitest /tmp/vitest.json \
  --runs packages/conversation-sim/runs --since <run start, ISO> --live-only --out report.json
node packages/conversation-sim/report/render-report.mjs report.json report.html
```

`--vitest` takes several files comma-separated; a later file's result replaces an earlier one for the same test
(use it when part of the suite was rerun). `--live-only` keeps only tests where the bot answered through a real model.
Run the command from `packages/conversation-sim` so test file paths resolve.

`--no-file-parallelism` keeps the scenarios under the provider's rate limit. A test that fails on a
rate limit, timeout or 5xx is reported as ERROR (infrastructure), not FAIL (behavior).

The turn breakdown («деталі» sections and side-effect icons) comes from `@entalent/conversation-trace`, which
`from-sim-run.mjs` loads from its built `dist`: on a fresh checkout run `pnpm --filter @entalent/conversation-trace build`
first. The same code renders production trace exports.

## Production conversation traces

`pnpm trace:export` (root) finds a traced turn by message text or exports a traced conversation through the admin API
(`POST admin/conversation-traces/search`, `GET admin/conversation-traces/conversations/:id/export`) and renders it with
`render-report.mjs` as the same page. It needs `TRACE_API_BASE`, `ADMIN_API_KEY` and an API started with
`CONVERSATION_TRACE_ADMIN_ENABLED=true`; exports go to `runs/trace-exports/` and must never be committed.
