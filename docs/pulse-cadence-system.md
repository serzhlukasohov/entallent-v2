# Pulse Cadence System — Проактивные Check-in'ы

Система автоматических проактивных сообщений сотрудникам: каждые 3 дня — одно сообщение, один вопрос из персонального бэклога.

---

## Как это работает

### Общая схема

```
Scheduler (каждые 3 дня)
  → enqueue check-in job per employee
    → BullMQ Worker (ConversationProcessor)
      → читает tenant policy из DB
      → ProactiveCheckInUseCase
          → ConversationOrchestrator.findSurveyProbe()
              → PulseBacklogService.getNextProbeQuestion()
                  → ленивая инициализация бэклога (если первый раз)
                  → resolve ignored entries (прошло 48ч без ответа)
                  → выбирает следующий pending вопрос
              → AI генерирует сообщение с встроенным вопросом
          → recordProbeSent() — отмечаем что вопрос отправлен
      → отправляет сообщение в Slack
```

### Бэклог (pulse_backlog)

Каждый сотрудник per-window имеет персональный бэклог из **12 вопросов** в строгом порядке:

```
autonomy×3 → belonging×3 → growth×3 → purpose×3
```

Каждая запись проходит через state machine:

```
pending → active → done
            ↓
         (48ч тишины)
            ↓
         pending (конец очереди)
```

- **pending** — вопрос ждёт своей очереди
- **active** — вопрос был отправлен (`proactive_sent_at` заполнен), ждём ответа
- **done** — либо получили ответ (scored/covered), либо принудительно помечен

### Конец квартала (последние 14 дней)

Когда до конца квартала остаётся ≤14 дней (`engagementUnlockDays`):
- Обычный 12-вопросный бэклог **замораживается**
- Разблокируются **3 engagement-вопроса** (`is_engagement = true`)
- Если все engagement-вопросы done → fallback на обычные pending вопросы

### Cross-pollination

Если сотрудник **сам упомянул** тему в разговоре (без проактивного вопроса):
- `SurveyEvidenceExtractionUseCase` находит scored/covered evidence
- Вызывает `PulseBacklogService.markQuestionCovered()`
- Вопрос помечается `done` + `resulted_in_coverage = true`

### Ignore window

Если сотрудник **не ответил** в течение `ignoreWindowHours` (default 48ч):
- `resolveIgnoredEntries()` переводит active → pending
- Вопрос уходит в **конец очереди** (`position = max + 1`)
- `total_ignore_count` увеличивается
- `resulted_in_coverage` остаётся `null` (не было разговора)

---

## Таблица в базе данных

```sql
pulse_backlog (
  id              uuid PK,
  user_id         uuid FK → users,
  tenant_id       uuid FK → tenants,
  window_id       uuid FK → survey_windows,
  question_id     uuid FK → survey_questions,

  position        int,       -- порядок в очереди (1-based, 1=следующий)
  status          text,      -- 'pending' | 'active' | 'done'
  is_engagement   bool,      -- true = engagement-вопрос (конец квартала)

  proactive_sent_at   timestamptz,  -- когда отправили
  evidence_captured_count int,      -- сколько evidence пришло после отправки
  resulted_in_coverage bool | null, -- null=не известно, true=да, false=нет

  total_ignore_count int,    -- сколько раз сотрудник проигнорировал
  UNIQUE (user_id, window_id, question_id)
)
```

---

## Конфигурация per-tenant

В таблице `tenants` в поле `proactive_messaging_policy` (jsonb):

```json
{
  "engagementUnlockDays": 14,
  "ignoreWindowHours": 48
}
```

Дефолты: `engagementUnlockDays=14`, `ignoreWindowHours=48`.

Поменять для конкретного тенанта:
```sql
UPDATE tenants
SET proactive_messaging_policy = '{"engagementUnlockDays": 10, "ignoreWindowHours": 72}'
WHERE id = '<tenant_id>';
```

---

## Как тестировать

### 1. Dev endpoint — симуляция цикла

```http
POST /dev/simulate-proactive-cycle
Content-Type: application/json

{
  "userId": "<uuid>",
  "tenantId": "<uuid>",
  "steps": 5
}
```

**Что делает:** Прогоняет `steps` итераций бэклога для одного сотрудника:
- Каждый шаг: берёт следующий pending вопрос → помечает active → имитирует ignore (48ч прошло) → переходит к следующему
- Возвращает всю цепочку вопросов в порядке

**Пример ответа:**
```json
{
  "steps": [
    {
      "stepIndex": 0,
      "questionId": "...",
      "stableKey": "autonomy_q1",
      "title": "Как часто ты сам выбираешь, как решать задачи?",
      "group": "autonomy",
      "wasForceIgnored": true
    },
    {
      "stepIndex": 1,
      "stableKey": "autonomy_q2",
      "group": "autonomy",
      "wasForceIgnored": true
    }
    ...
  ]
}
```

**Проверяй:**
- Порядок: autonomy → belonging → growth → purpose
- После 12 вопросов (нет engagement) — цикл по pending с начала

### 2. Dashboard — Pulse Overview

`/pulse` в дашборде показывает каждого сотрудника с:

```
[Progress bar]  ████░░░░  3/12 done  · pending: 7  · ignored: 2
Next: "Насколько ты чувствуешь связь с командой?" [belonging]
```

**Проверяй после каждого шага симуляции** — счётчики должны обновляться.

### 3. Запустить реальный check-in вручную

Если есть доступ к BullMQ dashboard (Bull Board):

1. Открой `/queues` → очередь `conversation`
2. Добавь job вручную с name=`check-in`:
```json
{
  "userId": "<uuid>",
  "tenantId": "<uuid>",
  "conversationId": "<uuid>",
  "externalWorkspaceId": "...",
  "externalConversationId": "...",
  "traceId": "test-001"
}
```
3. Worker подхватит, запросит бэклог, сгенерирует сообщение через AI и отправит в Slack

### 4. Проверить состояние бэклога в БД

```sql
-- Текущее состояние бэклога сотрудника
SELECT
  q.stable_key,
  q.group,
  pb.position,
  pb.status,
  pb.is_engagement,
  pb.proactive_sent_at,
  pb.total_ignore_count,
  pb.resulted_in_coverage
FROM pulse_backlog pb
JOIN survey_questions q ON q.id = pb.question_id
JOIN survey_windows w ON w.id = pb.window_id
WHERE pb.user_id = '<user_id>'
  AND w.status = 'active'
ORDER BY pb.is_engagement, pb.position;
```

**Ожидаемый вид для нового пользователя:**

| stable_key    | group     | position | status  |
|---------------|-----------|----------|---------|
| autonomy_q1   | autonomy  | 1        | pending |
| autonomy_q2   | autonomy  | 2        | pending |
| autonomy_q3   | autonomy  | 3        | pending |
| belonging_q1  | belonging | 4        | pending |
| ...           | ...       | ...      | pending |
| engage_q1     | ...       | 13       | pending |

### 5. Unit tests

```bash
pnpm --filter @entalent/application exec vitest run src/services/pulse-backlog.service.test.ts
```

14 тестов покрывают:
- Ленивую инициализацию бэклога
- Порядок групп (autonomy → belonging → growth → purpose)
- Ignore → pending → конец очереди
- End-of-quarter engagement unlock
- Fallback когда engagement вопросы кончились

---

## Файловая карта

```
packages/
  database/src/schema/pulse-backlog.ts       ← Drizzle-схема таблицы
  database/migrations/0003_pulse_backlog.sql ← SQL-миграция

  application/src/
    ports/pulse-backlog.repository.port.ts   ← интерфейс репозитория + типы
    services/pulse-backlog.service.ts        ← state machine бэклога
    services/pulse-backlog.service.test.ts   ← 14 unit тестов

    use-cases/proactive-check-in.use-case.ts     ← вызывает backlogService
    use-cases/survey-evidence.use-case.ts         ← cross-pollination
    use-cases/conversation-orchestrator.ts        ← findSurveyProbe через бэклог

apps/
  worker/src/
    survey/repositories/pulse-backlog.repository.ts  ← реализация порта (Drizzle)
    survey/survey.module.ts                          ← DI-провайдеры
    conversation/conversation.module.ts              ← wire в orchestrator + checkIn
    conversation/conversation.processor.ts           ← читает tenant policy

  api/src/
    admin/pulse-overview.controller.ts   ← /admin/pulse с данными бэклога
    dev/dev-simulate.controller.ts       ← POST /dev/simulate-proactive-cycle

  dashboard/src/app/
    pulse/page.tsx  ← отображение прогресса бэклога
    types.ts        ← тип PulseEmployeeRow.backlog
```

---

## Запуск в Railway

```bash
railway up --service api --detach
railway up --service worker --detach
```

После деплоя прогони миграцию (если ещё не запускалась):
```bash
railway run --service api -- pnpm --filter @entalent/database db:migrate
```
