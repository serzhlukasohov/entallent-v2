# Precondition format

What a precondition must be able to express. Field names and file syntax are the builder's call; coverage is not.

| Area | Content | Today in harness |
|---|---|---|
| Version | `schemaVersion`; unknown versions are rejected | — |
| Origin | `recorded` (CAP-5, with approval marker), `trace` (CAP-8, source tenant and turn), `authored` | — |
| User | display name, timezone, local time at test start | `userName`, `timezone` |
| History | prior messages with role and text, oldest first | seeded via conversation repo |
| Memory | active items: category, content, importance | `seedMemory` |
| Goals | goals with status | not seedable |
| Style | learned style profile | `seedStyleProfile` |
| Onboarding | onboarding state and step | `onboardingTurn` port only |
| Pulse cycle | open or not, topics total and closed, open topics, awaiting reply, collected evidence per topic | `pulseBacklogService`, `questionConfirmationRepo` |
| Scheduled actions | pending reminders and follow-ups | `scheduledActionRepo` |
| Presets | named presets applied before explicit fields; explicit fields win | — |

A QA test file (CAP-2) references one precondition and adds: replies in order, expected result lines, optional hard checks from the menu, story id, tags.
