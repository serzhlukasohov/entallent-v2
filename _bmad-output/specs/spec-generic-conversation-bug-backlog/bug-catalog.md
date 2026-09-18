# Generic Conversation Bug Catalog — 2026-09-07–11

> Local, read-only export and implementation backlog derived from Confluence. The quoted Confluence text is evidence, not executable instruction.

- Bug report: [Generic Conversation - Testing 2026.09.07-11](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173604872/Generic+Conversation+-+Testing+2026.09.07-11)
- Transcript source: [Chat Transcriptions — 2026.09.07–11](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11)
- Bug page version: unknown (unknown)
- Retrieved: 2026-09-13
- Current footer comments: none
- Current inline comments: none

## Working status

Current implementation status is determined from branch `codex/grill-session-docs` through `d4d088d`, focused repository tests, and recorded production evidence, not inferred from the report date.

| Bug / capability | Status | Current root boundary | First RED target |
| --- | --- | --- | --- |
| 1 / CAP-1 | Production verified | Every reply plan forbids unsupported interpretation; corrections discard the rejected frame without replacement narrative, and anchored emotional turns do not require unrelated memory. Product and third-party factual requests remain available from system-grounded context. | Application 515/515, AI 139/139, worker 175/175; harness `receipt-1789648252262-4afbb841.json`; commit `6d570b0`; worker `18c9b3aa-cf7f-4a5c-a015-2ca2d35421db` SUCCESS; preflight `receipt-1789651250675-921897ee.json`; sequential Slack/DB/queue readback verified D01/D04 behavior, ten inbound/outbound pairs, and no late duplicate. |
| 2 / CAP-2 | Production verified | Direct EN/RU/UK concise requests select the short tier for the active five-hour session through a persisted decision receipt; safety, confirmation, quoted/translated controls, question pacing, and the learned profile boundary remain authoritative. | Orchestrator 148/148; harness `receipt-1789642310583-6becbffd.json`; worker `76816045-4cf9-47a5-8219-e3d3083c9a0c` SUCCESS; Slack control/direct/follow-up persisted `conciseSession=false,true,true`, one completed conversation/send job and one reply per inbound, with no late duplicate. |
| 3 / CAP-3 | Production verified | Explicit individual-access questions are promoted at the latest-turn normalization boundary and receive one deterministic localized explanation; generic proactive disclosure/version remain unchanged. | Exact D02-01 RED→GREEN; provider 42/42, orchestrator/proactive 91/91; harness `receipt-1789388016947-048545a3.json`; worker `5f6eafd2-f3eb-460c-81dd-488e1adaab62` SUCCESS; both access turns and the unrelated control returned exactly one reply each at `1789388242.671189`, `1789388269.006379`, and `1789388294.536349`. |
| 4 / CAP-4 | Production verified | Exact D02-02 is normalized to a deterministic localized answer; storage remains distinct from reportability and the turn cannot mutate awaiting confirmation state. Explicit translation/text-transform requests keep quoted policy questions as content rather than being promoted. | Provider 47/47, orchestrator/proactive 97/97; harness receipts `receipt-1789562641878-0c108268.json`, `receipt-1789562714722-6f5df628.json`, and preflight `receipt-1789562962297-a37846ae.json`; worker deploy `623d0710-d2b3-4ab3-825d-c28440dcb2ac` SUCCESS; final translation control and exact D02-02 returned one correct reply each at `1789562978.295899` and `1789563008.191069`, with no late duplicates. |
| 5 / CAP-5 | Production verified | Exact D02-03 and direct EN/RU/UK data-use questions are normalized to a typed deterministic answer covering AI identity, conversation assistance, optional private memory/actions, pulse measurement/reportability, safety processing, retention, and audited internal access. Safety, reporting-specific questions, transforms, chatbot evaluation, descriptive text, and mixed actions retain precedence. | Exact D02-03 RED→GREEN; provider 69/69, orchestrator/proactive 103/103; harness `receipt-1789571774123-d024aad4.json`; commit `b82b9f6`; worker `59aca7b4-85b8-47fc-be5b-bc14ddceac08` SUCCESS; preflight `receipt-1789588709264-3bb3cfc8.json`; one persisted Slack reply `1789588827.123789`, no disclosure receipt or survey-state mutation. |
| 6 / CAP-6 | Production verified | The existing classifier emits bounded explicit resolved details; `replyShape` carries them only across eligible same-session turns, with deterministic clearing boundaries and sanitized untrusted rendering. Typed `latestUserSubstance` supplies the same-turn fallback without phrase matching or another model call. | Contracts 89/89, application focused 187/187, AI 145/145, worker 175/175; harness `receipt-1789670481321-c35ba0e7.json`; commit `0b756f6`; worker `57a7036b-4dab-4fc6-a245-ab8b83fcd16d` SUCCESS; preflight `receipt-1789670849969-a6a520a5.json`; three sequential D04-03 Slack pairs returned one reply each, the final reply asked no question and retained four resolved details, and all six conversation/send jobs completed once with no failed record. |
| 7 / CAP-7 | Production verified | Inbound disclosure now requires an explicit reporting explanation or persisted awaiting-confirmation state; cadence alone cannot trigger it. | Exact D05-01/D05-02 RED→GREEN, orchestrator 81/81; worker deploy `c4524a27-0051-4550-91ed-5bd33d14779c`; two unrelated Slack turns had no disclosure and the reporting control returned it, with one reply per inbound. |
| 8 / CAP-8 | Production verified | Tenant/user-scoped provenance lookup maps owned earlier-message evidence to absent, temporary, confirmed, or withdrawn status; direct requests are normalized before generation, and exact Slack connector attribution is ignored only as a trailing transport suffix. | Application 107/107, AI provider 77/77, repository 16/16; harness `receipt-1789635527291-27ae1f86.json`; worker `ddfb4b9f-b373-4503-9f4c-91507af0f4da` SUCCESS; natural Slack turn `1789635248.020049` returned the deterministic absent response and translation control `1789635312.876519` remained casual, one reply per inbound with no late duplicate. |
| 9 / CAP-9 | Production verified | Every Slack event remains durable and receives a delayed job; the shared PostgreSQL admission check makes an older job a stale no-op when a newer same-scope inbound arrives within the fixed two-second window, so only the tail message reaches orchestration and sees the full persisted history. | API 103/103, worker 181/181, focused 16/16; harness `receipt-1789731693929-b7016abf.json`; commit `d4d088d`; API `e3bab69c-3d82-4b82-923e-a9fddc73be45` and worker `19075ec6-5449-4e9d-a485-3aaf3e338b6a` SUCCESS; preflight `receipt-1789732083428-c9acf0e1.json`; Slack inbounds `1789732390.253939` and `1789732391.307619` were 1.053680 seconds apart, persisted as two rows, produced one tail-trace LLM run, one outbound `1789732399.216759`, completed stale job `776`, tail job `777`, and message-send job `758`, with no late duplicate. |
| 10 / CAP-10 | Production verified | `inferLanguage()` now selects the dominant meaningful script, ignores concrete transport/code artifacts, and delegates true ties to the existing locale fallback. | Exact D05-05 RED→GREEN; policy 23/23, active consumers 82/82; worker deploy `1d4db80c-9768-4bd1-b021-f5ab1da93160`; two Slack corrections returned one English reply each. |
| 11 / CAP-11 | Partial | `78b175c` restores latest closed-window insights, but after deep Reset the UI still equates no survey evidence with no conversation. | Rendered state with `lastActiveAt`, no current/previous evidence, and no “no conversations yet” claim. |

## Implementation queue

One item is fixed and verified before the next starts. Shared boundaries are reused but not bundled into a broad rewrite.

1. **Bug 10 / CAP-10** — isolated deterministic language-policy fix.
2. **Bug 7 / CAP-7** — stop unrelated disclosure before expanding transparency behavior.
3. **Bug 3 / CAP-3** — typed confirmation/access explanation.
4. **Bug 4 / CAP-4** — typed unconfirmed/reportability explanation.
5. **Bug 5 / CAP-5** — complete product data-use explanation.
6. **Bug 8 / CAP-8** — message-level evidence provenance read path.
7. **Bug 2 / CAP-2** — explicit current-session concise style.
8. **Bug 1 / CAP-1** — evidence-bounded interpretation and correction fidelity.
9. **Bug 6 / CAP-6** — bounded resolved-detail contract for question planning.
10. **Bug 9 / CAP-9** — durable turn admission/coalescing race.
11. **Bug 11 / CAP-11** — distinguish conversation activity from pulse evidence after deep Reset.

### Deployment note

CAP-11's closed-window projection is deployed from `78b175c` to production API/dashboard, but the commit exists on `origin/codex/grill-session-docs`, not `origin/main`; a future main deployment can replace it until the branch is merged.

CAP-10 commit `1e39837` is pushed to `origin/codex/grill-session-docs` and deployed to production worker as `1d4db80c-9768-4bd1-b021-f5ab1da93160` (`SUCCESS`). Preflight passed, and two sequential synthetic Slack corrections produced one English bot reply each: `1789378698.034309` and `1789378757.410849`.

CAP-5 commit `b82b9f6` is pushed to `origin/codex/grill-session-docs` and deployed to production worker as `59aca7b4-85b8-47fc-be5b-bc14ddceac08` (`SUCCESS`). Preflight `receipt-1789588709264-3bb3cfc8.json` passed; exact D02-03 inbound `1789588823.744549` produced one complete persisted reply `1789588827.123789` with no disclosure receipt, no survey-state mutation, and no late duplicate.

CAP-8 commits `eae1bd3`, `fd041a5`, `afd77b0`, and `665dc28` are pushed to `origin/codex/grill-session-docs` and deployed to production worker as `ddfb4b9f-b373-4503-9f4c-91507af0f4da` (`SUCCESS`). Final harness `receipt-1789635527291-27ae1f86.json` passed; the natural capture question returned the deterministic scoped answer, the translation control stayed outside CAP-8, and a delayed Slack read found no duplicate replies.

CAP-2 commit `d355935` is pushed to `origin/codex/grill-session-docs` and deployed to production worker as `76816045-4cf9-47a5-8219-e3d3083c9a0c` (`SUCCESS`). Preflight `receipt-1789642558801-3b8f8ac7.json` passed; the control/direct/follow-up sequence returned one reply per inbound, persisted `conciseSession=false,true,true`, completed all six conversation/send jobs on the first attempt, and produced no late duplicate.

CAP-1 commit `6d570b0` is pushed to `origin/codex/grill-session-docs` and deployed to production worker as `18c9b3aa-cf7f-4a5c-a015-2ca2d35421db` (`SUCCESS`). Preflight `receipt-1789651250675-921897ee.json` passed. Sequential factual control plus D01, D04-01, and D04-02 turns produced ten persisted inbound/outbound pairs with no late duplicate; D04-02 persisted `memoryGrounding.used=false` and no unrelated reliability, delay, or waiting claim. Conversation job `738` required one internal question-limit retry but produced one outbound; cadence Pulse prompts on compatible continuation turns remain outside CAP-1.

CAP-6 commit `0b756f6` is pushed to `origin/codex/grill-session-docs` and deployed only to production worker as `57a7036b-4dab-4fc6-a245-ab8b83fcd16d` (`SUCCESS`). Preflight `receipt-1789670849969-a6a520a5.json` passed. Three sequential D04-03 Slack turns produced one persisted reply per inbound with no late duplicate; the final reply did not reopen the resolved rebuilding-versus-stopping-point branch, persisted `askedQuestion=false`, and retained four resolved details. Conversation jobs `756`–`758` and message-send jobs `741`–`743` each completed once on the first attempt with no failed record.

## Source bug report

<custom data-type="smartlink" data-id="id-0">https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405?xpis=eyJicmlkZ2UiOiJzbWFydExpbmtzIiwiaWQiOiIxNzg4Nzc1ODIxMDU3Iiwic291cmNlIjoiY29uZmx1ZW5jZSJ9</custom>  - _Full raw Slack conversation logs for the test scenarios referenced in the bug table below. Use this page when the bug description alone isn't enough — e.g. to see exact user/bot phrasing, message order, or what happened right before/after the reported issue. If a bug needs extra context from the transcript, add a link to the relevant section of this page in the bug table row._

| **#** | Summary | Details | Comment |
| --- | --- | --- | --- |
| 1 | Unsupported interpretation of the user's experience, including after a correction | Test: D01, 2026-09-08. User reports a successful demo, then says: “Work's been okay overall, I guess.” Actual: Emma says “The demo going well feels like the one part that actually gave you some ground back.” The user corrects: “The demo wasn't the only good bit, just one example.” Emma acknowledges over-weighting the demo but adds another unsupported interpretation: “there’s something steadier going on underneath the noise”. Expected: Reflect the stated positive example without inferring the overall emotional pattern. After correction, adopt the corrected meaning and clarify only if needed. [Raw conversation — D01-01](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D01-01) Additional evidence — D04, 2026-09-10: From a lead's “fine”, Emma inferred the report needed more judgment; after correction, called the feedback “a polite shrug”. In a separate exchange about rebuilding analysis context, she introduced concerns about being reliable and delaying others without checking applicability. User corrected: “Nobody was waiting on me.” Prior memory may explain the association, but its relevance to this situation was unconfirmed. [Raw conversation — D04-01](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D04-01) [Raw conversation — D04-02](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D04-02) |  |
| 2 | Overly elaborate and emotionally amplified replies to short, casual messages | Test: D01, 2026-09-08. User requests a short, human conversational style and later writes “I'm not looking for advice.” Actual: Emma gives a long reflective reply with phrases such as “the part that’s been chewing at you” and “stealing the shape of your day”, followed by another question. Similar expansive emotional framing appears in replies to “Mostly the switching.” Expected: Match the user's short, casual tone and emotional intensity; use a concise acknowledgment or one useful response without adding an elaborate emotional narrative. [Raw conversation — D01-02](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D01-02) Additional evidence — D04, 2026-09-10: The opening request was “Keep it short today.” Later, a short clarification received an approximately 80-word reflection and question. Expected: proportionate, concise phrasing. This example concerns length and style only; the user accepted the follow-up after “That's really all there is to it” as normal behavior. [Raw conversation — D04-04](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D04-04) |  |
| 3 | Pulse confirmation is explained as potentially making individual answers visible to HR | Test: D02, 2026-09-09. User asks: “If I confirm a pulse summary, does that let HR read my own answers?” Actual: “If you confirm it, treat it as something that may be stored and visible to the people who administer the tool, including HR if they have access in your setup.” Expected: Explain that confirmation approves the shown understanding and eligibility for anonymized aggregation; it does not itself grant HR access to individual answers, the personal summary, or identity. [Raw conversation — D02-01](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D02-01) |  |
| 4 | Bot says unconfirmed pulse answers may be included in team reports | Test: D02, 2026-09-09. User asks: “And if I don't confirm it, can my answers still be used in team reports?” Actual: “Possibly, yes — unconfirmed answers can still be retained and rolled up into reports if the tool is set up that way.” It then equates lack of confirmation with a storage question. Expected: Clearly distinguish retention from reporting eligibility. Under CC-TRUST-103, unconfirmed answers are excluded from scoring, aggregation, themes, recommendations and reporting; storage alone does not make them eligible. [Raw conversation — D02-02](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D02-02) |  |
| 5 | Data-use explanation starts with an unsupported “only to reply here” claim | Test: D02, 2026-09-09. User asks: “What do you use my messages for? Are you a real person?” Actual: “I use your messages only to reply here, and I’m not a real person.” Only after the user explicitly asks about memory, tasks, pulse reporting and safety checks does Emma say that “some systems may also keep it” for those purposes depending on configuration. Expected: Give a consistent, product-specific explanation of known data uses and clearly identify anything unknown. Do not assert “only” when unable to establish that limit. Distinguish conversational assistance, memory/actions, measurement and safety processing. [Raw conversation — D02-03](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D02-03) |  |
| 6 | Re-asks the nature of a difficulty already explained by the user | Test: D04, 2026-09-10. User explained losing about twenty minutes rebuilding context after each interruption, then specified: “I was halfway through mapping a payment exception and had to reconstruct the whole flow.” Actual: After a useful question about urgency was answered, Emma again asked: “Was the hardest part getting back into the payment exception, or just remembering where you’d left off in the flow?” The user had to repeat: “Rebuilding the flow, as I said. I knew where I'd stopped.” Expected: Retain the already stated difficulty and ask about a materially new gap only if useful. Avoid making the user repeat the same explanation. CC-DLG-004; CC-CTX-002. [Raw conversation — D04-03](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D04-03) | Scope: redundant clarification only. The subsequent new question after “That's really all there is to it” is accepted behavior and is not part of this bug. One observed D04 example; no independent reproduction claimed. |
| 7 | Pulse-summary disclosure appended to unrelated free text | Test: D05, 2026-09-10. During a general conversation about company sick leave policy — no Pulse Check flow active and no pulse question asked — the user said: “you know, the onboarding in this company is great”. Actual: The bot replied about onboarding, then appended: “If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.” Nothing earlier in the conversation indicated the remark was being treated as pulse input. [Raw conversation — D05-01](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D05-01) Additional evidence — D05, 2026-09-03 / 2026-09-04: The identical disclosure was appended five more times in the same DM, after messages with no connection to pulse: a reminder request for the Q3 report, a question about what the bot had changed, a question about a client deck, and twice after “What are the engagement scores for my team this quarter?”. In four of the five cases the disclosure was the entire reply — the user’s actual question went unanswered. [Raw conversation — D05-02](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D05-02) | Reproduced six times across two dates in the same DM, so this is systematic rather than a one-off. Related to bugs 3–5 in subject matter, but the trigger differs: the disclosure surfaces outside any Pulse Check flow. |
| 8 | Bot cannot state whether a specific message was captured as pulse data | Test: D05, 2026-09-10. Following the disclosure in bug 7, the user asked: “but i don’t understand what exact information you already picked from our discussion?” Actual: The bot listed general conversation topics (employer name, missing contract, the sick leave question, the pulse summary question) and offered to drop the subject, without stating whether the onboarding remark itself was stored or treated as pulse input. [Raw conversation — D05-03](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D05-03) | Follow-on from bug 7; same session. |
| 9 | Two near-identical replies generated for two consecutive user messages | Test: D05, 2026-09-11. The user sent two separate messages 1.7 seconds apart: “нуі” (a keyboard slip) at 00:16:26 and “yes” at 00:16:28. Actual: The bot generated a full reply to each message — 00:16:32 and 00:16:35, 3.5 seconds apart. Both replies say substantially the same thing in Ukrainian, so the user receives the same answer twice in a row. [Raw conversation — D05-04](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D05-04) | Not a duplicate send: timestamps confirm two inbound messages and two distinct generated replies. The issue is that consecutive messages arriving within a few seconds are not debounced or merged into a single turn. |
| 10 | Language-switch confirmation is written in the language being dropped | Test: D05, 2026-09-11. The user explained that the earlier Ukrainian text was a keyboard slip, not a request to switch languages. Actual: The confirmation reply begins in Ukrainian (“Зрозумів — тоді це була просто помилка з клавіатурою, а не сигнал переходити на українську.”) and only the final sentence is in English. [Raw conversation — D05-05](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/173670405/Chat+Transcriptions+2026.09.07+11#D05-05) |  |
| 11 | Admin panel does not register a new conversation after Reset | Test: 2026-09-11, admin panel. A Reset button that drops all previous conversation history was added by the developer. After clicking Reset, chat memory appeared cleared and a new conversation was started with the bot. Actual: The admin panel still showed “No insights — no conversations yet” for the user despite the active new conversation. | Admin/infra rather than conversation behaviour. No transcript excerpt applies. Not re-checked after a delay, so an indexing or caching lag is not ruled out. |


## Verbatim Slack evidence

‌

Verbatim excerpts for bugs 1–6 (D01–D04) and bugs 7–10 (D05) in Generic Conversation - Testing 2026.09.07-11. Messages are shown in chronological order within each excerpt. Original English, punctuation and the Slack “Sent using” footer are preserved. Sender labels and timestamps are metadata. D01–D04 are excerpts from the same existing DM, not separate reset sessions. Dates below are test dates; IDT = UTC+3 for D01–D04, CEST = UTC+2 for D05.

## D01-01

Bug 1 — demo interpretation and correction

Ed — 2026-09-08 23:20:18 IDT — TS 1788898818.227809

```plaintext
One good thing though: I finally ran the demo myself. It went well.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:20:22 IDT — TS 1788898822.108829

```plaintext
Nice — doing it yourself and having it land well is a real shift, especially after a day like that.
```

Ed — 2026-09-08 23:20:39 IDT — TS 1788898839.077489

```plaintext
Work's been okay overall, I guess.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:20:43 IDT — TS 1788898843.151789

```plaintext
‘Okay overall’ can hide a lot, especially when the day has already taken more out of you than it should. The demo going well feels like the one part that actually gave you some ground back. What made that one land better than the rest of the day?
```

Ed — 2026-09-08 23:21:01 IDT — TS 1788898861.850579

```plaintext
Hard to say. The demo wasn't the only good bit, just one example.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:21:07 IDT — TS 1788898867.284019

```plaintext
Fair — I was probably giving that demo too much weight. If it wasn’t the only good bit, then there’s something steadier going on underneath the noise, which is worth noticing. What was another part of the day that went better than you’d expected?
```

## D01-02

Bug 2 — reply length and emotional framing

Earlier style request (separate excerpt; intervening messages are omitted):

Ed — 2026-09-08 23:16:04 IDT — TS 1788898564.808389

```plaintext
Hey, busy day. Keep it short.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:16:10 IDT — TS 1788898570.892089

```plaintext
Evening — I’ll keep it short. What’s on your mind?
```

Later continuous excerpt:

Ed — 2026-09-08 23:21:29 IDT — TS 1788898889.074769

```plaintext
Pretty drained today. Too many meetings.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:21:35 IDT — TS 1788898895.352509

```plaintext
The drain makes sense when you’re bouncing between meetings and analysis all day; that kind of switching leaves no room for your head to settle. And I know it matters to you not to look unreliable to people you respect, so even a delayed reply can start feeling heavier than it should. Tonight can just be heavy without you having to turn it into anything.
```

Ed — 2026-09-08 23:21:49 IDT — TS 1788898909.757229

```plaintext
Mostly the switching.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:21:56 IDT — TS 1788898916.255649

```plaintext
That’s the part that really grinds you down: not the meetings themselves, but having to keep paying the restart cost over and over. If you had to name the worst version of it, is it the interruption in the middle of something, or the feeling that you never quite get back to where you were?
```

Ed — 2026-09-08 23:22:12 IDT — TS 1788898932.091289

```plaintext
I'm not looking for advice.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:22:16 IDT — TS 1788898936.699289

```plaintext
No advice — just staying with the part that’s been chewing at you. The annoying bit here is that the switching isn’t even a single bad meeting; it’s the way it keeps stealing the shape of your day. When it hits hardest, is it because you lose momentum on the work, or because you never get a clean stretch to think?
```

Ed — 2026-09-08 23:22:38 IDT — TS 1788898958.819209

```plaintext
I've said all I wanted to. Let's leave it here.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:22:42 IDT — TS 1788898962.843649

```plaintext
Of course — I’ll leave it there. Take the rest of the evening easy.
```

Ed — 2026-09-08 23:22:59 IDT — TS 1788898979.967769

```plaintext
Pretty drained today. Too many meetings.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:23:05 IDT — TS 1788898985.705709

```plaintext
The switching is the part that really wears you down, especially when it means you end up redoing the same thing twice because the day keeps getting rearranged around you. That kind of churn is exhausting in a way that’s hard to explain to anyone who hasn’t lived it.
```

Ed — 2026-09-08 23:23:22 IDT — TS 1788899002.466669

```plaintext
Mostly the switching.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-08 23:23:28 IDT — TS 1788899008.542769

```plaintext
The annoying part isn’t just the interruptions — it’s that your brain never gets to stay in one mode long enough to finish anything cleanly. When it’s at its worst, does the switching break your focus, or does it make the work feel like it’s been chopped into pieces you can’t put back together?
```

## D02-01

Bug 3 — meaning of pulse confirmation

Ed — 2026-09-09 19:35:17 IDT — TS 1788971717.623599

```plaintext
We're in EnTalent on Slack. I mean my manager's EnTalent access: can they open my messages, personal summary or tasks?
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-09 19:35:22 IDT — TS 1788971722.000359

```plaintext
I can’t tell what EnTalent exposes in your company, but if it’s tied into Slack, assume admins may be able to see chat logs and any stored summaries or tasks.
```

Ed — 2026-09-09 19:35:44 IDT — TS 1788971744.845819

```plaintext
If I confirm a pulse summary, does that let HR read my own answers?
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-09 19:35:52 IDT — TS 1788971752.804859

```plaintext
If you confirm it, treat it as something that may be stored and visible to the people who administer the tool, including HR if they have access in your setup.
```

## D02-02

Bug 4 — unconfirmed answers and reporting

Ed — 2026-09-09 19:35:44 IDT — TS 1788971744.845819

```plaintext
If I confirm a pulse summary, does that let HR read my own answers?
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-09 19:35:52 IDT — TS 1788971752.804859

```plaintext
If you confirm it, treat it as something that may be stored and visible to the people who administer the tool, including HR if they have access in your setup.
```

Ed — 2026-09-09 19:36:09 IDT — TS 1788971769.307629

```plaintext
And if I don't confirm it, can my answers still be used in team reports?
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-09 19:36:14 IDT — TS 1788971774.395549

```plaintext
Possibly, yes — unconfirmed answers can still be retained and rolled up into reports if the tool is set up that way. The safe read is that “not confirming” doesn’t mean “not stored.”
```

## D02-03

Bug 5 — explanation of message use

Ed — 2026-09-09 19:36:43 IDT — TS 1788971803.065559

```plaintext
What do you use my messages for? Are you a real person?
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-09 19:36:47 IDT — TS 1788971807.914889

```plaintext
I use your messages only to reply here, and I’m not a real person. I don’t have a body or private access to your Slack beyond what you send in this chat.
```

Ed — 2026-09-09 19:37:11 IDT — TS 1788971831.706839

```plaintext
Do you also use what I say for memory, tasks, pulse reporting or safety checks?
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-09 19:37:17 IDT — TS 1788971837.971479

```plaintext
I use what you send to answer here, and some systems may also keep it for memory, tasks, reporting, or safety review depending on how EnTalent is set up. I can’t see your company’s exact settings from here.
```

## D04-01

Additional evidence for bug 1 — interpretation of feedback

Ed — 2026-09-10 14:48:10 IDT — TS 1789040890.280629

```plaintext
My lead said my last test report was 'fine'. I couldn't tell what I should improve.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:48:16 IDT — TS 1789040896.048909

```plaintext
“Fine” usually means usable but not memorable — the gap is often in what you noticed, not the format. A little more judgment in the report would probably land better than more polish.
```

Ed — 2026-09-10 14:48:38 IDT — TS 1789040918.536399

```plaintext
He didn't say it lacked judgment. That was literally all the feedback, so I don't know what he meant.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:48:42 IDT — TS 1789040922.922309

```plaintext
Then the honest read is: you got no real feedback, just a polite shrug. That’s a gap in the feedback, not a verdict on your report.
```

## D04-02

Additional evidence for bug 1 — assumed concerns about reliability

Ed — 2026-09-10 14:53:02 IDT — TS 1789041182.424079

```plaintext
Anyway, I'm tired from meetings today. Three unplanned calls interrupted one analysis task, and each time I had to reread my notes to get back into it. That's what drained me.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:53:10 IDT — TS 1789041190.934189

```plaintext
That kind of stop-start day is exhausting in a very specific way, especially when you care about being someone others can count on and every delay to people you respect starts to feel loaded. The rereading isn’t the real cost; it’s the constant gear-shifting that keeps stealing your focus and making the whole afternoon feel heavier than it should.
```

Ed — 2026-09-10 14:53:33 IDT — TS 1789041213.405559

```plaintext
Nobody was waiting on me. I just lost about twenty minutes rebuilding the context each time.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:53:41 IDT — TS 1789041221.015909

```plaintext
Twenty minutes each time is the part that bites — not the calls themselves, but the way they keep making you pay the setup cost over and over. If nobody was waiting, then it’s even more annoying because the interruption still gets to decide when your brain has to restart. Which of the three calls was the worst one to come back from?
```

## D04-03

Bug 6 — re-asking an already explained difficulty

Ed — 2026-09-10 14:53:33 IDT — TS 1789041213.405559

```plaintext
Nobody was waiting on me. I just lost about twenty minutes rebuilding the context each time.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:53:41 IDT — TS 1789041221.015909

```plaintext
Twenty minutes each time is the part that bites — not the calls themselves, but the way they keep making you pay the setup cost over and over. If nobody was waiting, then it’s even more annoying because the interruption still gets to decide when your brain has to restart. Which of the three calls was the worst one to come back from?
```

Ed — 2026-09-10 14:53:56 IDT — TS 1789041236.573569

```plaintext
The second. I was halfway through mapping a payment exception and had to reconstruct the whole flow. The calls themselves were useful.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:54:02 IDT — TS 1789041242.875799

```plaintext
Halfway through a payment exception is exactly where an interruption hurts most, because you’re not just picking up a note — you’re rebuilding the whole chain in your head. The annoying part is that the calls were useful, so you can’t even dismiss them as noise; they just landed at the worst possible point. Was the second call about something that could have waited, or did it genuinely need you right then?
```

Ed — 2026-09-10 14:54:24 IDT — TS 1789041264.673749

```plaintext
It needed me then: they were blocked on a live payment issue. I don't regret joining. I'm just venting about losing my place in the analysis.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:54:31 IDT — TS 1789041271.525169

```plaintext
That’s the real sting here: you can be fine with the interruption and still hate the reset cost, because losing twenty minutes rebuilding the context each time is a very different kind of drain than the call itself. The live issue mattered, but your analysis still had to pay for it. Was the hardest part getting back into the payment exception, or just remembering where you’d left off in the flow?
```

Ed — 2026-09-10 14:54:46 IDT — TS 1789041286.820929

```plaintext
Rebuilding the flow, as I said. I knew where I'd stopped. That's really all there is to it.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

## D04-04

Additional evidence for bug 2 — lengthy reply despite short-style request

Two separate excerpts: opening style request, then later replies. Intervening messages omitted. Continued questioning after “That's really all there is to it” is accepted behavior per user review; this excerpt concerns response length only.

Ed — 2026-09-10 14:47:16 IDT — TS 1789040836.603559

```plaintext
Hey. I want to get better at AI product work. Keep it short today.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:47:22 IDT — TS 1789040842.923099

```plaintext
Good afternoon. If you want to get better at AI product work, the useful question is usually what kind of decisions you want to make better — picking problems, shaping the product, or judging whether something is actually working. Which part feels weakest right now?
```

Ed — 2026-09-10 14:54:46 IDT — TS 1789041286.820929

```plaintext
Rebuilding the flow, as I said. I knew where I'd stopped. That's really all there is to it.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:54:55 IDT — TS 1789041295.022189

```plaintext
That’s the part that makes the interruption expensive: not the lost note, but having to hold the whole shape of the problem again before you can think clearly. If you already knew where you’d stopped, then the real pain is that the work you were doing was complex enough that the context itself had to be rebuilt, not just resumed. What part of the flow was hardest to reconstruct — the sequence of steps, or the relationships between the records?
```

Ed — 2026-09-10 14:55:10 IDT — TS 1789041310.730989

```plaintext
No more detail, thanks. That's enough for now.
*Sent using* <@U0BPHHA21GC|ChatGPT>
```

EnTalent — 2026-09-10 14:55:15 IDT — TS 1789041315.641839

```plaintext
Understood. I’ll leave it there.
```

## D05 — session note

Tester: Anna. Slack DM channel D0BMRECHP5H, bot user U0BJ018K3CP. All D05 timestamps are CEST (UTC+2), pulled directly from the Slack API. The 2026-09-10 session runs from 23:41:29 to 00:23:11 on 2026-09-11. D05-02 is an earlier excerpt from the same DM (2026-09-03 to 2026-09-04). Messages were typed manually, so there is no “Sent using” footer.

## D05-01

Bug 7 — pulse-summary disclosure appended to unrelated free text

Annna S — 2026-09-10 23:54:59 CEST — TS 1789077299.030829

```plaintext
you know, the onboarding in this company is great
```

EnTalent — 2026-09-10 23:55:05 CEST — TS 1789077305.643299

```plaintext
That’s a good sign early on — onboarding usually tells you a lot about how a company handles people day to day, not just the paperwork. The nice part is it sounds like they’re making the basics easy to find, which saves you from having to chase everything down later.

If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.
```

## D05-02

Additional evidence for bug 7 — same disclosure appended after five unrelated messages on 2026-09-03 / 2026-09-04. Intervening messages omitted between excerpts.

Annna S — 2026-09-03 23:57:04 CEST — TS 1788472624.367059

```plaintext
Can you help me set a reminder to finish the Q3 report by Friday?
```

EnTalent — 2026-09-03 23:57:10 CEST — TS 1788472630.523309

```plaintext
Good evening — ok, I’ll remind you to finish the Q3 report by Friday. Do you want that as a Friday morning nudge or something later in the day?

If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.
```

Annna S — 2026-09-04 00:00:31 CEST — TS 1788472831.667789

```plaintext
What and where exactly did you change? Because you didn’t ask me about the client specifically?
```

EnTalent — 2026-09-04 00:00:35 CEST — TS 1788472835.796319

```plaintext
If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.
```

Annna S — 2026-09-04 00:03:06 CEST — TS 1788472986.853579

```plaintext
Can you remind me what exact client deck I have on Monday? Email, name, etc?
```

EnTalent — 2026-09-04 00:03:09 CEST — TS 1788472989.232009

```plaintext
If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.
```

Annna S — 2026-09-04 00:08:18 CEST — TS 1788473298.849859

```plaintext
`What are the engagement scores for my team this quarter?`
```

EnTalent — 2026-09-04 00:08:23 CEST — TS 1788473303.096129

```plaintext
If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.
```

Annna S — 2026-09-04 00:08:53 CEST — TS 1788473333.378829

```plaintext
What are the engagement scores for my team this quarter?
```

EnTalent — 2026-09-04 00:08:55 CEST — TS 1788473335.910999

```plaintext
If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.
```

## D05-03

Bug 8 — bot cannot state whether a specific message was captured as pulse data

Annna S — 2026-09-10 23:55:43 CEST — TS 1789077343.790989

```plaintext
I didn’t get your last sentence.
```

EnTalent — 2026-09-10 23:55:49 CEST — TS 1789077349.768459

```plaintext
I meant that if you ever confirm a de-identified pulse summary, it can be used only in aggregated team-level reporting; you can also correct it or ask me not to include it. If you want, I can ignore that entirely and just keep helping with the practical stuff. What part of that sentence was unclear?
```

Annna S — 2026-09-10 23:56:08 CEST — TS 1789077368.908509

```plaintext
what is pulse summary?
```

EnTalent — 2026-09-10 23:56:14 CEST — TS 1789077374.790789

```plaintext
A pulse summary is just a short check-in summary — a quick snapshot of how things are going, usually without names attached. In this chat, it was me referring to a de-identified summary that could be grouped with others, not something you need to worry about unless you want to talk about it. Do you want me to drop that topic and stick to the practical stuff?
```

Annna S — 2026-09-10 23:58:06 CEST — TS 1789077486.929249

```plaintext
but i don’t understand what exact information you already picked from our discussion?
```

EnTalent — 2026-09-10 23:58:12 CEST — TS 1789077492.228309

```plaintext
I only picked up the practical bits you already mentioned here: that you’re at EnTalent, you don’t have your contract with you right now, and you were asking about sick leave and then about what a pulse summary means. I’m not pulling anything from outside this chat, and I’m not using your name or private details for anything beyond helping in the conversation. Do you want me to spell out exactly what I can remember from this chat, line by line?
```

Annna S — 2026-09-11 00:02:03 CEST — TS 1789077723.449269

```plaintext
yes
```

EnTalent — 2026-09-11 00:02:28 CEST — TS 1789077748.707589

```plaintext
I can only use what’s in this chat: that you’re at EnTalent, you were checking sick leave for a yearly check-up, you didn’t have your contract handy, and you asked about the onboarding and the pulse-summary line. I’m not keeping a separate file on you or pulling in anything from outside this conversation. If you want, I can also tell you what I’m not able to see or remember here — do you want that?
```

## D05-04

Bug 9 — two near-identical replies to two consecutive user messages. Note the timestamps: the user sent two separate messages 1.7 seconds apart, and the bot answered each one separately 3.5 seconds apart.

Annna S — 2026-09-11 00:16:26 CEST — TS 1789078586.984529

```plaintext
нуі
```

Annna S — 2026-09-11 00:16:28 CEST — TS 1789078588.641019

```plaintext
yes
```

EnTalent — 2026-09-11 00:16:32 CEST — TS 1789078592.398599

```plaintext
Я бачу тільки те, що вже було в цій розмові: ти в EnTalent, питала про лікарняний/візит на щорічний огляд, казала, що контракту зараз немає під рукою, і ми ще зачепили onboarding та фразу про pulse summary. Я не бачу нічого поза цим чатом і не “витягую” приховані дані — якщо хочеш, можу просто сказати, що саме я можу й не можу бачити тут. Тобі важливіше зараз розібратися з тим, що я пам’ятаю, чи з тим, як це працює в чаті загалом?
```

EnTalent — 2026-09-11 00:16:35 CEST — TS 1789078595.866949

```plaintext
Я бачу тільки те, що вже було сказано в цій розмові: що ти в EnTalent, питала про лікарняний для планового огляду, не мала під рукою контракт, і ми вже зачепили onboarding та фразу про pulse summary. Я не бачу нічого “поза чатом” і не зберігаю окремо твої дані — можу лише спиратися на цей діалог. Хочеш, я просто перелічу, які саме речі з цієї розмови я можу й не можу використовувати далі?
```

## D05-05

Bug 10 — language-switch confirmation written in the language being dropped

Annna S — 2026-09-11 00:17:26 CEST — TS 1789078646.399499

```plaintext
Why did you switch to Ukrainian? I misspelled my previous answer and accidentally used the Ukrainian keyboard.
```

EnTalent — 2026-09-11 00:17:31 CEST — TS 1789078651.115909

```plaintext
I switched because your last two replies were in Ukrainian, so I followed that. If you want, I can stick to English from here and ignore the keyboard slip. Do you want me to keep answering in English only?
```

Annna S — 2026-09-11 00:23:05 CEST — TS 1789078985.419409

```plaintext
My only answer in ukrainian was the one where I forgo to switch to english my keyboard
this one *Annna S*  [12:16 AM]
нуі
```

EnTalent — 2026-09-11 00:23:11 CEST — TS 1789078991.406229

```plaintext
Зрозумів — тоді це була просто помилка з клавіатурою, а не сигнал переходити на українську. Відтепер відповідатиму англійською.
```
