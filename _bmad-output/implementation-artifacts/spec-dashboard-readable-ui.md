---
title: 'Dashboard readability: light theme, shared UI kit, topic-aligned current cycle'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: 'f361c8a8de3d836e953c22ac4bc2ca042d531a3c' # working-tree snapshot after uncommitted specs 1-3 (refs/bmad/spec4-baseline); untracked files are not in it
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dashboard is hard to read:
- low-contrast 12–13px grey text on a dark background;
- long technical status sentences;
- "Нет данных по теме" noise;
- each page hand-rolls its own inline styles;
- on "Текущий цикл", working insights are grouped by person while Team Signals are grouped by topic, about 2000px apart, so the PO cannot compare a draft with its de-identified result.

**Approach:**
- Switch to a light theme with a readable type scale.
- Add a small shared UI kit and use it on all pages.
- Rebuild "Текущий цикл" around topics: one row per topic, with temporary drafts (named) on the left and Team Signals (anonymous) on the right, a group filter, and empty topics collapsed.
- Restyle "Циклы" and "Команда" with the same kit: status badges, participation bar, unit cards with initials and role badges.

The approved mockup is the topic-row layout shown in chat on 2026-10-14.

## Boundaries & Constraints

**Always:**
- Dashboard-only change. No API, contract, or database changes.
- Keep every existing data gate (QA flag, tenant gate) and the empty, unavailable, and 404 states. Copy may be rewritten shorter, but each state stays distinct.
- Colors as CSS tokens in `globals.css` (light only). Body text ≥15px; secondary text meets WCAG AA (≥4.5:1) on its background.
- Status meaning is never conveyed by color alone: badges carry text.
- Server components stay server components. Interactivity (group filter, expand) uses URL search params or native `<details>`, with no client state library.
- No new dependencies. UI copy in Russian.
- Layout works down to 768px wide without horizontal page scroll, except inside the cycle-roster table wrapper.

**Ask First:** Adding a dependency (icon set, CSS framework), changing any API, or removing a page or route.

**Never:**
- Do not change data semantics or counts.
- Do not show names in the Team Signals column, and do not visually pair a specific draft with a specific signal. Rows align by topic only.
- Do not introduce Tailwind or CSS-in-JS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Topic with both | Drafts and signals for a topic | One row: drafts left (quote, first name + last initial, status badge), signals right (summary, direction · score · severity badge) | N/A |
| Topic one-sided | Only drafts, or only signals | The other side shows a muted "Нет черновиков" / "Пока нет сигналов" | N/A |
| Topic empty | Neither | Collapsed into "Ещё N тем без данных" (native details) | N/A |
| Group filter | `?group=autonomy` | Only that group's topics; invalid value → all groups | Ignore unknown values |
| Insufficient evidence | Signal with `insufficient_evidence` | Grey badge "Недостаточно данных", no direction color | N/A |
| Gate off / API down | Null data | Existing distinct notices, restyled | null-safe |

</frozen-after-approval>

## Code Map

- `apps/dashboard/src/app/globals.css` -- dark tokens to replace with light tokens and the base type scale
- `apps/dashboard/src/app/components/Nav.tsx` -- tabs; restyle with the kit
- `apps/dashboard/src/app/pulse/page.tsx` -- person-grouped working view plus topic-grouped signals; becomes topic rows
- `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- person detail; restyle, keep it as the click-through from names
- `apps/dashboard/src/app/cycles/page.tsx`, `cycles/[cohortId]/page.tsx` -- list and detail; badges, participation bar, roster stage badges
- `apps/dashboard/src/app/page.tsx` -- hierarchy cards
- `apps/dashboard/src/app/v2-pilot-progress.ts` (+ test) -- label helpers; add pure view-model helpers here

## Tasks & Acceptance

**Execution:**
- [x] `globals.css` -- light tokens (bg, surface, border, text, text-secondary, success/warning/danger/accent bg+text pairs), 15px body, heading scale, table and link base styles.
- [x] `components/ui.tsx` -- `PageHeader`, `Stat`, `Badge` (tone: neutral|success|warning|danger|accent), `Card`, `ProgressBar`, `Initials`; plus `Nav` restyle.
- [x] `v2-pilot-progress.ts` -- pure `buildTopicRows(people, signals, group?)` returning rows `{stableKey, title, group, drafts[], signals[]}` and a collapsed-empty count; plus `shortName()`, a draft status → badge tone/label helper, a person stage → badge helper, and a signal → badge helper. Cover them with tests in `v2-pilot-progress.test.ts`, including the matrix rows and the invalid group filter.
- [x] `pulse/page.tsx` -- stats row, group filter links (`?group=`), topic rows per the mockup, collapsed empty topics, names linking to `/pulse/[userId]`.
- [x] `pulse/[userId]/page.tsx`, `cycles/page.tsx`, `cycles/[cohortId]/page.tsx`, `page.tsx` -- adopt the kit: badges instead of status sentences, a participation bar in the cycle list, a stage badge in the roster, unit cards with `Initials` and a role badge in a responsive grid.

**Acceptance Criteria:**
- Given the local fixture, when the PO opens "Текущий цикл", then for each Autonomy topic the draft and its signals sit in the same row, with no name in the signal column.
- Given any page, when measured in the browser, then body text is ≥15px and secondary text contrast is ≥4.5:1.

## Verification

**Commands:**
- `pnpm exec tsx apps/dashboard/src/app/v2-pilot-progress.test.ts` -- expected: all pass
- `pnpm --filter @entalent/dashboard typecheck && pnpm --filter @entalent/dashboard lint && pnpm --filter @entalent/dashboard build` -- expected: success

**Manual checks:**
- Browser pass over `/`, `/cycles`, a cycle detail, `/pulse` (all groups and `?group=autonomy`), and `/pulse/[userId]` against the local fixture, at 1280px and 768px widths.

## Suggested Review Order

**Topic-aligned current cycle (entry point)**

- Drafts and Team Signals aligned by group+topic only; filter applies only to present groups
  [`v2-pilot-progress.ts:251`](../../apps/dashboard/src/app/v2-pilot-progress.ts#L251)

- Page: stats, participant links, group filter, topic rows, collapsed empty topics
  [`pulse/page.tsx:85`](../../apps/dashboard/src/app/pulse/page.tsx#L85)

**Shared UI kit and theme**

- Light tokens, 15px body, AA secondary text, color-scheme light
  [`globals.css:3`](../../apps/dashboard/src/app/globals.css#L3)

- Badge always carries text; ProgressBar clamps and labels per cycle
  [`ui.tsx:26`](../../apps/dashboard/src/app/components/ui.tsx#L26)

**Other pages on the kit**

- Cycle list with participation bar and report badge
  [`cycles/page.tsx:10`](../../apps/dashboard/src/app/cycles/page.tsx#L10)

- Cycle detail: report badge row, roster stage badges
  [`[cohortId]/page.tsx:12`](../../apps/dashboard/src/app/cycles/%5BcohortId%5D/page.tsx#L12)

- Hierarchy unit cards with initials; no duplicate role badges
  [`page.tsx:77`](../../apps/dashboard/src/app/page.tsx#L77)

**Peripherals**

- Tests: topic rows, filters, null sources, badges, names
  [`v2-pilot-progress.test.ts:1`](../../apps/dashboard/src/app/v2-pilot-progress.test.ts#L1)
