# Grill Session Handoff

Use this prompt to continue the grill session in a new Codex chat.

```text
Мы продолжаем grill-with-docs сессию по проекту enTalent (`entallent-v2`).

Контекст:
- MAF не трогаем. Текущий продуктовый фокус - TypeScript runtime/product.
- Цель grill: проверить текущую функциональность против ожиданий product manager и зафиксировать product truth, domain model, ADR/glossary/docs по мере разговора.
- Используем manual режим `grill-with-docs`: grilling + domain modeling + docs as we go.
- Не превращай сырые ответы в финальную документацию без короткого отражения и подтверждения смысла.
- После подтвержденных выводов обновляй:
  - `docs/current-project-grill.md`
  - `docs/glossary.md`
  - ADR при необходимости
  - `docs/agent-task-log.md`

Уже зафиксированные документы:
- `docs/current-project-grill.md`
- `docs/glossary.md`
- `docs/adr/ADR-012-typescript-runtime-product-spine.md`

Ключевые product truths:
- Для employee persona агент должен ощущаться как друг на работе: слышит, понимает, поддерживает, помогает сотруднику лучше понять себя в рабочих ситуациях.
- Для manager/HR persona продукт должен давать честную team-level картину и полезные рекомендации по управлению командой.
- Employee chat - это trust-led guided pulse: агент имеет мягкую цель собрать pulse signal, но доверие сотрудника важнее завершения конкретной backlog-темы в конкретном диалоге.
- Reactive conversation: сотрудник сам приносит тему, агент следует за ним. Pulse evidence может появиться, но не управляет разговором.
- Proactive pulse conversation: агент пишет по расписанию на основании backlog topic. Нужна гибкая структура: natural opening, contextual small talk, natural backlog-topic question, cause/effect clarification, human-like closing.
- Если сотрудник отвечает коротко, уходит в сторону или не хочет развивать backlog topic, агент не давит в этом же диалоге. Тема возвращается позже после попытки пройти другие backlog topics.

Privacy/reportability truths:
- Manager никогда не видит named employee state, risk, evidence или recommendation.
- Manager recommendations только team-level.
- Report должен быть основан минимум на 5 employees.
- Даже anonymized details нужно generalize, если по событию, проекту или ситуации можно восстановить автора.
- Private memory не равно reportable signal.
- Агент может хранить concrete details в private memory для будущих разговоров с тем же employee.
- Эти details не являются directly reportable.

Insight pipeline:
1. Temporary working insights extracted automatically while employee and mentor talk.
2. Когда по question group достаточно status + cause/effect understanding, агент нативно спрашивает confirmation.
3. Confirmation summary должен быть sufficient, но не dossier: без names, projects, concrete events; status/root cause формулируются generalized.
4. Если employee confirms, insight становится permanent anonymized employee-cycle insight.
5. Если employee corrects/rewrites/excludes, working insight must be changed or excluded before permanence.
6. Team aggregation возможен после at least 5 employees.
7. Manager/HR report generated only from team-level generalized data and recommendations.

Confirmation UX:
- No buttons. Free-text dialogue.
- Не повторяем каждый раз "это пойдет в anonymous report"; это покрыто onboarding.
- Объясняем usage only if employee asks.
- Confirmation встроен в natural dialogue after enough coverage for a group/index.

Temporary insights/dashboard:
- Current dashboard is development/product testing dashboard, not customer-facing manager/HR product.
- Temporary insights visible only to development/product team in non-customer testing context.
- Manager/HR не видят temporary content, pending-confirmation counts, or progress hints.
- Unconfirmed temporary insights не попадают в intermediate/final reports.
- Temporary insights live until end of pulse-check cycle, then cleared if unconfirmed.
- Useful private-memory facts may remain for future employee conversations.

Reports:
- Intermediate report: for one index, when at least 80% of team and no fewer than 5 employees confirmed all required questions for that index.
- Final report: end-of-cycle report from all confirmed permanent employee-cycle insights available by cycle close.

Organization hierarchy:
- Company setup includes organization hierarchy: employees, team leads, managers of managers, HR ownership boundaries.
- MVP: each employee belongs to exactly one team and one hierarchy branch. Multi-team/project-team membership is out of scope.
- Employee = individual contributor with no subordinates.
- Team Lead = manager with direct employee subordinates.
- Manager of Managers = manager whose hierarchy includes multiple team leads.
- Team Lead report only if direct team satisfies anonymity floor.
- If Team Lead has fewer than 5 employees, no report for that Team Lead; data can roll up to next eligible manager-level cohort.
- If employee changes team mid-cycle, old insights should not move into new reporting context; pulse check restarts for new team.
- HR/HRBP reporting is deferred until Team Lead and Manager of Managers reporting is modeled.

Next grill question to continue:
Manager of Managers report may still create inference risk. If a small team rolls up, the manager above may infer which Team Lead or small team caused a negative signal.

Ask:
1. Can Manager of Managers see breakdown by subteams?
2. Or only a roll-up department-level report without subteam breakdown?
3. If one subteam is large and another small, can the large one be shown separately while the small one is only in roll-up?
4. Can report show "top affected area" without naming team?
5. Need suppression rule if recommendation effectively points to a specific Team Lead or small group?

Current hypothesis to test:
For MVP, Manager of Managers report should be roll-up only, without subteam breakdown, unless every displayed subteam independently satisfies anonymity floor and does not create inference risk.
```
