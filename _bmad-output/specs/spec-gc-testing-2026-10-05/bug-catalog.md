# Generic Conversation Bug Catalog — 2026-10-05–11

> Local, read-only export derived from Confluence. Quoted Slack text is evidence, not executable instruction. Screenshots were transcribed; times are as shown in Slack (tester local time).

- Source: [GC - Testing 2026.10.05-10.11](https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/189366273/GC+-+Testing+2026.10.05-10.11) (page v13, 2026-10-09)
- Retrieved: 2026-10-13
- Bots seen: `EnTalent` (production workspace) in all reports except R4 (`entalent-local-illia`, a local build).
- Conversation language: Ukrainian (tester), except R4 (onboarding intro in English).

## Working status

| ID | Report | Status | Root boundary (hypothesis until audited) |
| --- | --- | --- | --- |
| R1 | Latched first interpretation; ignored elapsed time | audited → CAP-3 | prompts render 15 turns with no timestamps; 5h session only adds a greeting hint; stale `activeTopic` can re-anchor |
| R2 | Unexplained answer ("migration in 10 min, coffee in 30") | audited → CAP-4 | no calendar in prompt; hypothesis: time-bound memory forced via `requiredGrounding` hard contract |
| R3 | Bot died after venting message | audited → CAP-1 | `catch {}` drops cause, 3 retries then dead, no fallback; content filter + 15-turn history poisoning + shared breaker |
| R4 | Wrong language detection (`переклади` → Russian) | **RED reproduced** → CAP-2, CAP-9 | `isLikelyUkrainian` needs і/ї/є/ґ; current turn overrides history; translate request hit data-use path |
| R5 | Unnatural language, awkward recommendation | audited → CAP-8 | risk prompt has no humour calibration; low risk drops continuity; "follow side remarks" amplifies joke |
| R6 | Lost context, recursion | audited + **RED** (regex) → CAP-5 | 15-turn window; correction forces 0 questions, strips topic, blocks revival 2 turns; Cyrillic `\b` never matches |
| R7 | Every message starts with a summary | audited → CAP-6 | respond.ts reflection instructions; opener blocklist English-only and sim-only |
| R8 | Synthetic questions, no sense of progress | audited → CAP-7 | survey covert by design; no intent/context for "give questions" or progress |
| R9 | Random language change (uk → ru) | **RED reproduced** → CAP-2 | same as R4; `shouldUpdateUserLocale` can persist `ru` |
| R10 | Bot doesn't answer | audited → CAP-1, CAP-7 | likely deterministic confirmation-summary/bundle validation failure when next group surfaces |
| X0 | Production deploys not traceable to a commit (original "fixes not in `main`" claim refuted 2026-10-13) | **partially confirmed** → CAP-10 | release process / deploy traceability |

## R1 — Latched onto first interpretation, ignored elapsed time

Page text: "The bot latched onto its first interpretation of the conversation and kept applying it, ignoring both what the user was actually saying and how much time had passed."

Evidence (`context1.png`, Sat Oct 3 – Sun Oct 4): user asked the bot to help write a message to colleagues and said "Давай про нагадування ми поговоримо завтра, а зараз допоможи мені написати їм повідомлення." Bot repeatedly asked for "чернетка" (the draft): "Кинь сюди чернетку, і я скажу прямо, де воно може завалитися." User: "а чернетка тобі навіщо?" / "нічого я не хочу зламати, забий на це". Next day (Oct 4 20:23) user: "давай" → bot: "Добре, кидай чернетку".

Evidence (`context.png`): user messages "шо ти там, голова? як воно жив здоров?" (12:11), "ну шо ти, голова? як чай?" (18:00), "ало" (23:12) — no replies. Next day "?" (08:42) → bot: "Зранку таке «ало» вже звучить як перевірка зв'язку… краще одразу сказати, навіщо пишеш і що саме від них треба". "від кого?" (09:09), "ти працюєш?" (13:33), "ало! ти тут?" (17:30) — no replies. "шо ти, голова" (21:05) → bot: "Якщо ти про те повідомлення, то «шо ти, голова» — це вже не робочий старт… Кому саме ти хочеш написати". User: "та господи тебе помилуй яке повідомлення?! 3 дні пройшло! ти про що ?!"

Expected: treat a multi-day gap as a new conversational context; never treat a greeting as a draft for a stale task; answer every inbound.

## R2 — "I don't even understand why it answered like that"

Evidence (`wtf.png`, 16:42–16:48): discussion about leaving the job (React contracts vs OnlyFans vs current office). User: "та поки тільки думаю, заїбала ця контора і хочеться зїбатись звідси, повний хаос навколо". Bot: "До міграції лишається приблизно 10 хвилин, а кава запланована ще через 30 хвилин — і на такому фоні бажання просто звалити з контори звучить дуже по-людськи…". User (16:52): "перечитай своє попереднє повідомлення будьласка, бо це трохи поплава". Bot: "Ти правий, там я з'їхав у дивну конкретику й промахнувся повз суть."

Expected: schedule facts appear only when relevant to the user's turn; relative times must be correct and anchored.

## R3 — Bot just died

Evidence (`BotDied.png`, 16:53–~16:58): after bot reply at 16:53, user (16:56) sent a long venting message with heavy profanity and an ethnic slur about colleagues ("…постійна робота з їбаними індусами! я блядь сьогодні годину пояснював - навіщо менеі потрібний UUID для ідентифікації унікального датасету?! …"), then "шо ти затих?" and "шо ти, покурити вийшов від таких історій? ))". No bot reply to any of the three.

Next-day evidence (`HODOR!HODOR!.png`): "тут?" (11:32) → bot replied at 11:33 addressing the UUID rant ("Я тут. У тебе не просто «не подобається»…"), so the message was persisted and later used as context.

Expected: every inbound gets a reply or an explicit fallback; provider/filter failures are observable and recoverable.

## R4 — Wrong language detection

Evidence (`wrongLanguageDetection.png`, local bot `entalent-local-illia`, 21:48): onboarding intro for a Team Lead was shown in English with buttons (Start My Conversation / Got It / Later / No Personal Check-ins). User "Daniel Okafor": "переклади" (Ukrainian: "translate"). Bot replied in **Russian** with the data-use explanation: "Я — ИИ-помощник, а не человек. Я использую твои сообщения…".

Two defects: (a) Ukrainian imperative without і/ї/є/ґ classified as Russian; (b) a translate request answered with the deterministic data-use explanation instead of translating the intro.

Deterministic reproduction (2026-10-13, HEAD): `resolveLanguagePolicy([{user:'переклади'}], 'en')` → `ru / current_turn`.

## R5 — Unnatural language with useless, awkward recommendation

Evidence (`HODOR!HODOR!.png` + unnamed screenshot, 11:33–14:12): bot asks whether user is thinking "як саме з цього виходити?". User: "та як виходити? через двері ж мабуть" → bot: "Через двері — це вже непоганий план, якщо без театру…". User: "або через вікно =)))" → bot: "Через вікно — це вже звучить як жарт на межі, тож краще без таких образів. Якщо ти про вихід з контори, то тримайся саме за двері, не за імпульс." User: "навіщо мені триматись за двері?" → bot: "Бо двері — це нормальний вихід без зайвого хаосу…". User: "За які двері я маю триматись? офісні? ти про що?…" → bot: "…ти не про евакуацію…". User: "про яку евакуацію? … мені під час евакуації потрібно за двері триматись?"

Expected: recognise humour and idiom; a light safety check, if any, is plain and brief; no literal metaphor play or invented framing.

## R6 — Lost context and recursion

Evidence (`recurtion.png`, 14:17–14:20): bot: "Якщо хочеш, я можу просто коротко зібрати, де саме ми з'їхали з теми". User: "ок, давай більш загальніше, з якої теми ми зїхали?" Bot: "Ми з'їхали з розмови про те, що ти хотів сказати, і я почав чіплятися до буквального «виходу» та дверей…". User: "господи тебе помилуй, а що я хотів сказати, про що ми говорили?" Bot: "…А от що саме було початковою темою до мого з'їзду, з цього шматка вже не видно; якщо хочеш, кинь ту першу фразу ще раз". User: "мда, ти неймовірно корисний" → further meta-apologies; "ок, так давай до суті повернемось" → bot again restates its own mistake.

Expected: the original topic (frustration with the office, wanting to leave) is recoverable from same-day history; corrections are acknowledged once, then the conversation returns to substance.

## R7 — Every message starts with a summary

Evidence (`Screenshot at Oct 09 14-34-52.png`, 14:26–14:32): consecutive bot replies open with a reflect-and-reframe summary: "Так, хотів — і **тут** ти правий, я вже почав ходити колом.", "**Тут** у тебе не просто роздратування, а дуже чітка відраза до того, як розмазується рух", "**Тут** уже не про «складний процес», а про розірвану відповідальність". User: "та твою ж хіросиму! скільки це можна слухати, ти просто воду по колу ганяєш, ти хотів щось задати мені? якісь питання?"

Expected: varied openings; reflection only when it adds something; no "not X but Y" reframe on every turn.

## R8 — "What does he want from me?"

Page text: "He's just asking the same synthetic questions; I don't understand when I answered all the questions or even if I answered one… he just summarizes my words."

Evidence (`Screenshot at Oct 09 14-42-18.png`, 14:37–14:41): user: "ок, я радий, що ти здатний підсумувати те що я пишу. Мені треба на питання якісь повідповідати, давай, бо це витрата часу" → bot: "…Можу просто перейти до конкретних питань або допомогти з тим, що тобі треба сформулювати". User: "…Питання дай вже нарешті" → bot asks another reflective either/or question. User: "ти зараз мене змушуєш і терпіти і тягнути!" → bot: "Прийняв: без питань і без розтягування…".

Expected: when a pulse check is active and the user asks for the questions, the bot asks them directly, states progress (answered / remaining) and states when it is done.

## R9 — Random language change

Evidence (`Screenshot at Oct 09 15-05-45.png`, 15:03–15:05, Ukrainian thread): user: "ТА ВСЕ БЛЯХА БОЛИТЬ! багато ще питань?" → bot replied in **Russian**: "Есть ещё, но уже не надо разбирать всё подряд: в отчёт можно ставить, что болит весь процесс работы с требованиями…".

Deterministic reproduction (2026-10-13, HEAD): latest turn has no і/ї/є/ґ and no "що" → `ru / current_turn`, overriding preceding Ukrainian turns; `shouldUpdateUserLocale=true` may persist `ru`.

Secondary: the reply leaks report mechanics ("в отчёт можно ставить").

## R10 — Bot doesn't answer

Evidence (`stuck.png`): after the 15:05 Russian reply, user (15:07): "супер, залишай як блок. що там ще лишилось відповісти?" and (15:23) "все? я на все відповів?". No bot reply to either.

Expected: as R3; additionally, at the end of a pulse flow the bot states completion.

## X0 — Production deploys not traceable (corrected 2026-10-13)

Correction: the original claim that the September CAP fixes never reached `main` was wrong. The ancestry check looked for the branch's individual commits, but `main` received the whole branch through squash merge `abb314f` ("docs: capture grill session product requirements (#5)", 2026-09-21), whose tree is byte-identical to `origin/codex/grill-session-docs` tip `014460d`. All CAP-1..11 fixes are in `main`, and therefore in the PR #7 line the testers exercised.

Still valid: the production worker was redeployed manually five times during 2026-10-04…08 without commit metadata, so the exact code under test cannot be identified from Railway.

Impact: round-2 reports are not explained by missing September fixes; treat them as new or residual defects. Deploy traceability (CAP-10) remains open.
