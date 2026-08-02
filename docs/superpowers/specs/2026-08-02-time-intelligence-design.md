# Time intelligence (timezone acquisition, session-aware greetings, quiet hours)

**Date:** 2026-08-02
**Status:** Approved (design)

## Problem

The agent doesn't reliably know the employee's local date/time, so:
- No time-appropriate greetings/sign-offs ("доброе утро", "хорошего вечера").
- Proactive check-ins can fire at night.
- `users.timezone` is never populated (defaults to UTC everywhere), so even the
  recently-added `localTime` hint greets by UTC — wrong for most users.

The plumbing already half-exists: `users.timezone` + `users.quiet_hours` columns,
`SlackAdapter.getUserProfile()` already returns `tz` (IANA) from `users.info`, and
`isInQuietHours(timezone, quietHours)` already guards proactive scheduling. The gap
is that nothing populates the timezone, and greetings guess on unknown tz.

Industry norm (Slack apps): read `users.info.tz` (IANA name, e.g. `Europe/Berlin`),
store the IANA name (DST-safe via `Intl`), fall back gracefully, refresh over time.

## Goal

Know each employee's local time reliably; greet/sign off appropriately only when it
fits; never message proactively during their night; degrade gracefully (never greet
wrong) when the timezone is genuinely unknown.

## Design

### Component 1: Timezone acquisition from Slack + graceful unknown

- **Async hydration job.** When the orchestrator handles a message for a user whose
  `timezone` is null OR stale (older than `TZ_REFRESH_DAYS = 30`), it enqueues a
  lightweight `profile-hydration` job. A worker processor calls the existing
  `SlackAdapter.getUserProfile(externalWorkspaceId, externalUserId)` and updates
  `users.timezone` + `users.timezone_updated_at`. The inbound reply path never waits
  on Slack; the tz is populated within seconds (in effect for the next reply).
- **Graceful unknown.** `describeLocalTime` returns `undefined` for a null/empty tz;
  the orchestrator passes `conversation.userTimezone` as-is (NOT `?? 'UTC'`). No tz →
  no `localTime` in the response context → the reply does not attempt a
  time-appropriate greeting (better silent than wrong).

### Component 2: Session-aware greetings

- The orchestrator computes `isSessionStart`: true when the gap between now and the
  most recent prior message (in `dbMessages`) exceeds `SESSION_GAP_HOURS = 5`, or
  there is no prior message.
- Passed into `ResponseContext.isSessionStart`. `respond.ts` only offers a
  time-appropriate greeting/sign-off when `isSessionStart` AND `localTime` is known.
  Mid-session replies get no greeting (fixes "доброе утро" on every turn).

### Component 3: Quiet hours — default window, dev toggle, tone

- **Default window.** When a user has not explicitly enabled quiet hours
  (`quietHours.enabled !== true`), treat 22:00–08:00 local as quiet. `isInQuietHours`
  applies this default window (still needs a known tz; if tz unknown, do not suppress
  — we can't compute local night, and proactive already requires an active channel).
- **Dev toggle.** New env `QUIET_HOURS_ENABLED` (default `true`). When `false`, the
  proactive scheduler skips the quiet-hours guard entirely (for local/dev testing).
- **Tone.** `describeLocalTime` already yields a part-of-day label ("ночь"), which
  steers the reply away from a chipper "доброе утро" at night; the greeting hint
  reinforces a wind-down tone late.

### Component 4: Timezone refresh (travel)

- **Lazy staleness refresh.** `timezone_updated_at` gates re-hydration: on contact,
  if the stored tz is older than `TZ_REFRESH_DAYS`, the same `profile-hydration` job
  re-fetches and updates it.
- Slack `user_change` event handling is out of scope for v1 (noted as a future
  enhancement if the socket service already receives it).

### Data model

- Add `users.timezone_updated_at timestamptz` (nullable) — generated migration.
- `users.timezone` stays the IANA name (e.g. `Europe/Berlin`).

### Shared/isolated units

- `describeLocalTime(tz)` (exists) → returns `undefined` for unknown tz.
- `isSessionStart(lastMessageAt, now)` — pure, unit-tested.
- `isInQuietHours(tz, quietHours)` (exists) → extended with the default window.
- Slack calls live ONLY in the worker hydration processor; the orchestrator stays
  provider-agnostic (it just enqueues the job and reads `users.timezone`).

### Data flow

```
inbound message → orchestrator:
  - if user.timezone null/stale → enqueue profile-hydration (async)
  - localTime = describeLocalTime(conversation.userTimezone)  // undefined if unknown
  - isSessionStart = gap(now, lastMessageAt) > 5h
  → generateResponse(context{ localTime, isSessionStart, ... })
      → greeting/sign-off only if isSessionStart && localTime

profile-hydration job → SlackAdapter.getUserProfile → update users.timezone + _updated_at

proactive scan → isInQuietHours(tz, quietHours || default 22–08), skipped if QUIET_HOURS_ENABLED=false
```

### Testing

- Unit: `describeLocalTime(null) → undefined`; part-of-day boundaries (05/12/18).
- Unit: `isSessionStart` — >5h true, <5h false, no prior true.
- Unit: `isInQuietHours` — default 22–08 window applies when not explicitly set;
  respects explicit config; DST-correct via IANA + Intl; `QUIET_HOURS_ENABLED=false`
  bypasses.
- Unit: hydration use case — mock Slack profile → upserts tz + timestamp; skips when
  fresh.
- Unit: respond.ts — greeting offered only when `isSessionStart` && `localTime` set.
- Orchestrator: enqueues hydration when tz missing/stale; not when fresh; passes
  `isSessionStart`/`localTime` correctly.

## Out of scope (v1)

- Slack `user_change` event-driven refresh (lazy refresh only).
- Slack DND (`dnd.info`) as the quiet-hours source (default window chosen).
- Inferring tz from activity patterns (Slack provides it directly).

## Notes / risks

- If Slack `users.info` fails (permissions), tz stays null → graceful unknown (no
  greeting); log and retry via job.
- Default quiet hours require a known tz; users still without tz won't be
  night-guarded until hydrated — acceptable, hydration is fast.
- Dev toggle mirrors the existing `PROACTIVE_MIN_*` env pattern.
