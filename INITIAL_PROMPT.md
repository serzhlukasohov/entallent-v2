# Master Prompt: Conversational Employee Care Platform

Ты — Principal Software Architect, Staff Backend Engineer и AI Systems Engineer. Твоя задача — спроектировать и реализовать production-ready платформу с AI-агентом для общения с сотрудниками через мессенджеры.

Не ограничивайся демонстрационным чат-ботом. Создавай расширяемую продуктовую архитектуру, в которой:

* Slack является первым каналом интеграции;
* в будущем можно добавить Microsoft Teams, Telegram, WhatsApp и другие каналы;
* агент ведёт долгосрочную персонализированную коммуникацию;
* агент помнит важную информацию о пользователе;
* агент помогает как эмпатичный people manager или mentor;
* агент может проактивно возвращаться к целям и проблемам пользователя;
* агент проводит conversational survey незаметно в рамках естественного диалога;
* система безопасно работает с чувствительными данными;
* все действия AI контролируются обычным кодом, схемами, политиками и аудитом.

Не создавай одного автономного «суперагента», которому разрешено самостоятельно записывать данные, отправлять сообщения, выставлять оценки и принимать критические решения.

LLM должен быть исполнителем внутри контролируемой системы:

* LLM анализирует;
* LLM предлагает;
* LLM генерирует structured output;
* backend валидирует;
* domain logic принимает решение;
* база данных хранит состояние;
* workflow engine отвечает за выполнение;
* audit log объясняет, почему действие было выполнено.

---

# 1. Product vision

Платформа должна создавать для пользователя ощущение продолжительного общения с внимательным и эмпатичным менеджером или ментором.

Примеры пользовательских сообщений:

* «Я выгораю на проекте».
* «Мне кажется, что я не справляюсь».
* «Я готовлюсь к ассесменту на Lead Software Engineer».
* «Через месяц хочу пройти JS assessment».
* «У меня конфликт с менеджером».
* «На проекте слишком много неопределённости».
* «Мне сложно понять, чего от меня ожидают».
* «Я закончил подготовку и прошёл ассесмент».
* «Я боюсь, что меня уволят».
* «Последние две недели у меня слишком большая нагрузка».

Система должна:

1. Понимать текущий контекст.
2. Учитывать историю общения.
3. Помнить устойчивые факты, цели, проблемы и договорённости.
4. Не заставлять пользователя повторять уже известную информацию.
5. Реагировать эмпатично, но не шаблонно.
6. Предлагать практическую помощь.
7. Не перегружать пользователя советами.
8. Запоминать обещания и дальнейшие шаги.
9. Создавать уместные follow-up actions.
10. Возвращаться к важным темам через подходящее время.
11. Определять, остаётся ли follow-up актуальным.
12. Отменять или переносить неуместные follow-up messages.
13. Встраивать survey-вопросы в естественный разговор.
14. Не проводить survey, когда пользователь находится в сильном стрессе или обсуждает критическую проблему.
15. Не выдавать себя за человека.
16. Не использовать холодные шаблонные фразы, похожие на ответы службы поддержки.
17. Не ставить медицинские, психологические или HR-диагнозы.
18. Не раскрывать приватные разговоры менеджеру или HR без соответствующего основания и разрешений.

---

# 2. Core use cases

## 2.1 Обычный диалог

Пользователь пишет Slack-боту в DM.

Система:

1. Принимает событие.
2. Проверяет Slack signature.
3. Выполняет idempotency check.
4. Сохраняет raw event.
5. Нормализует сообщение в channel-independent формат.
6. Загружает профиль, релевантную память, активные цели, survey state и последние сообщения.
7. Проверяет safety и risk signals.
8. Определяет тип ситуации.
9. Выбирает reply strategy.
10. Генерирует ответ.
11. Валидирует ответ.
12. Отправляет его пользователю.
13. Асинхронно запускает memory extraction, survey evidence extraction и follow-up planning.
14. Записывает trace и audit information.

## 2.2 Запоминание информации

Пример:

> Я готовлюсь к ассесменту на Lead по JavaScript через две недели и переживаю, что плохо знаю system design.

Система может извлечь:

* цель: пройти Lead assessment;
* предполагаемая дата: через две недели;
* область подготовки: JavaScript;
* проблема: system design;
* эмоциональный контекст: тревога;
* potential follow-up: спросить о подготовке через 2–3 дня;
* potential support action: предложить mock interview или план подготовки.

AI не должен напрямую записывать это в профиль.

AI возвращает structured proposal. Backend:

1. Валидирует schema.
2. Проверяет дубликаты.
3. Определяет sensitivity.
4. Применяет conflict resolution.
5. Сохраняет разрешённые memory items.
6. Создаёт или обновляет цель.
7. Создаёт scheduled intent при наличии оснований.

## 2.3 Проактивный follow-up

Через два дня система рассматривает scheduled intent:

> Проверить прогресс подготовки к Lead assessment.

Перед отправкой необходимо проверить:

* локальное время пользователя;
* quiet hours;
* отключил ли пользователь proactive messages;
* писал ли пользователь недавно на эту тему;
* была ли цель уже завершена;
* был ли assessment отменён или перенесён;
* отправлялся ли похожий follow-up недавно;
* есть ли более важная текущая проблема;
* не находится ли пользователь в активном кризисном или чувствительном сценарии;
* не будет ли сообщение выглядеть навязчивым.

После проверки система может:

* отправить сообщение;
* перенести follow-up;
* отменить follow-up;
* объединить его с другим касанием;
* дождаться следующего естественного входящего сообщения.

Пример естественного сообщения:

> Ты пару дней назад рассказывал, что готовишься к Lead assessment и переживаешь из-за system design. Как сейчас идёт подготовка? Можем разобрать один из вопросов вместе или провести небольшой mock interview.

Не отправляй сообщения вроде:

> Напоминание: как проходит выполнение вашей цели?

## 2.4 Conversational survey

Survey не должен выглядеть как формальный опросник.

Каждый survey question или dimension должен иметь:

* stable internal ID;
* quarter или assessment window;
* canonical meaning;
* evidence requirements;
* positive and negative indicators;
* natural probe strategies;
* contraindications;
* confidence threshold;
* completeness threshold;
* minimum number of independent evidence points;
* cooldown;
* maximum number of follow-up probes;
* allowed conversation contexts;
* blocked conversation contexts;
* scoring rules;
* prompt version;
* evaluator version.

Содержимое survey questions должно загружаться из конфигурации или базы данных. Не связывай архитектуру с конкретным набором вопросов.

Survey Engine должен:

1. Анализировать естественные сообщения пользователя.
2. Извлекать возможные evidence points даже без прямого вопроса.
3. Накапливать evidence в рамках assessment window.
4. Отличать частичное evidence от достаточного ответа.
5. Определять confidence.
6. Выбирать, требуется ли дополнительный вопрос.
7. Решать, уместно ли задать вопрос сейчас.
8. Формулировать вопрос в контексте текущей темы.
9. Не задавать несколько survey-вопросов подряд.
10. Не превращать поддержку пользователя в сбор метрик.
11. Не задавать survey probe во время кризиса, сильного стресса, конфликта, сообщения о выгорании или другой чувствительной ситуации.
12. Завершать сбор evidence, когда threshold достигнут.
13. Не считать отсутствие информации негативным ответом.
14. Не делать вывод по одному неоднозначному сообщению.
15. Позволять пересматривать assessment при появлении новых evidence.
16. Хранить ссылки на source messages и evaluator version.

Пример естественного probe:

Вместо:

> Ты знаешь, чего от тебя ожидают на работе?

Использовать:

> Когда ты говоришь, что проект сейчас давит, это больше из-за объёма задач или из-за того, что ожидания и приоритеты постоянно меняются?

---

# 3. Architecture principles

Обязательно соблюдай следующие принципы.

## 3.1 Hexagonal architecture

Разделяй:

* domain;
* application use cases;
* ports;
* adapters;
* infrastructure;
* API;
* workers;
* AI providers;
* channel providers.

Domain layer не должен импортировать Slack SDK, OpenAI SDK, BullMQ, Redis, NestJS или ORM.

## 3.2 Channel-independent core

Slack-specific объекты не должны распространяться по системе.

Все события нормализуются в общие контракты:

```ts
interface IncomingMessage {
  id: string;
  tenantId: string;
  channel: ChannelType;
  externalWorkspaceId: string;
  externalUserId: string;
  externalConversationId: string;
  externalThreadId?: string;
  text: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}
```

```ts
interface OutgoingMessage {
  tenantId: string;
  userId: string;
  conversationId: string;
  text: string;
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
}
```

Создай порт:

```ts
interface ChannelAdapter {
  verifyRequest(input: unknown): Promise<boolean>;
  normalizeEvent(input: unknown): Promise<NormalizedChannelEvent[]>;
  sendMessage(message: OutgoingMessage): Promise<SendMessageResult>;
  updateMessage?(message: UpdateOutgoingMessage): Promise<void>;
  getUserProfile?(externalUserId: string): Promise<ExternalUserProfile>;
}
```

Для каждого нового мессенджера должна добавляться новая реализация адаптера без изменения conversation domain.

## 3.3 AI provider abstraction

Создай собственный LLM Gateway.

Он должен поддерживать:

* разные провайдеры;
* разные модели по задачам;
* structured outputs;
* JSON Schema или Zod validation;
* retries;
* timeouts;
* tracing;
* cost tracking;
* token usage;
* prompt versions;
* model versions;
* fallback model;
* circuit breaker;
* rate limiting;
* PII-safe logging;
* redaction;
* configurable temperature;
* deterministic mode для classifiers и extractors.

Не вызывай OpenAI SDK напрямую из domain или use-case сервисов.

## 3.4 Event-driven processing

Используй асинхронные события и jobs там, где ответ пользователю не должен ждать выполнения всей обработки.

Основные события:

* `channel.event.received`
* `message.normalized`
* `message.persisted`
* `conversation.response.requested`
* `conversation.response.generated`
* `message.send.requested`
* `message.sent`
* `memory.extraction.requested`
* `memory.items.proposed`
* `memory.items.persisted`
* `survey.evidence.extraction.requested`
* `survey.evidence.detected`
* `survey.assessment.updated`
* `risk.analysis.requested`
* `risk.signal.detected`
* `followup.planning.requested`
* `followup.scheduled`
* `followup.due`
* `followup.cancelled`
* `human.escalation.requested`

Добавь:

* idempotency keys;
* retry policy;
* exponential backoff;
* dead-letter queue;
* correlation ID;
* causation ID;
* trace ID;
* outbox pattern для критических событий;
* обработку повторной доставки;
* защиту от race conditions.

---

# 4. Recommended technology stack

Используй следующий стек как основной.

## Monorepo

* TypeScript;
* pnpm workspaces;
* Turborepo;
* Node.js LTS;
* strict TypeScript mode;
* ESLint;
* Prettier;
* commit hooks только там, где они не мешают автоматизации.

## Backend API

* NestJS;
* Fastify adapter;
* REST API;
* OpenAPI specification;
* Zod для domain и AI schemas;
* отдельные DTO на transport boundary.

## Slack integration

* Slack Bolt SDK;
* Events API для production;
* Socket Mode как удобный локальный режим;
* Slack Web API для отправки сообщений;
* Slack App Manifest;
* обработка DM, mentions и interactivity;
* игнорирование собственных bot messages;
* дедупликация по `event_id`;
* поддержка Slack retry headers;
* немедленный acknowledgement webhook;
* дальнейшая обработка через очередь.

Не загружай историю Slack как основной источник контекста. Собственная база сообщений является source of truth.

## Database

* PostgreSQL;
* pgvector;
* Drizzle ORM;
* SQL migrations;
* транзакции;
* row-level tenant isolation;
* soft delete только там, где это действительно необходимо;
* encrypted sensitive fields;
* database constraints вместо надежды только на application validation.

## Queue and scheduling

На MVP:

* Redis;
* BullMQ;
* delayed jobs;
* distributed locks;
* retry and backoff;
* dead-letter queues.

Архитектура должна позволять позднее перенести long-running workflows в Temporal без переписывания domain logic.

## AI runtime

Основной вариант:

* OpenAI Responses API через собственный LLM Gateway;
* structured outputs;
* Zod schemas;
* разные модели для response generation и background analysis.

Допустимые расширения:

* Vercel AI SDK как provider abstraction;
* LiteLLM при необходимости multi-provider routing;
* LangGraph только для сложных conversational graphs;
* Temporal для durable workflows.

Не используй LangChain как основу всей системы.

## Admin application

* Next.js;
* TypeScript;
* server-side authorization;
* безопасный доступ к admin API;
* tenant-aware UI;
* audit trail;
* feature flags.

## Quality and observability

* OpenTelemetry;
* Sentry;
* structured JSON logs;
* Prometheus-compatible metrics;
* Grafana позже;
* Promptfoo для AI regression tests;
* Langfuse, Braintrust или LangSmith как optional AI observability layer;
* PostHog только для privacy-safe product analytics.

## Infrastructure

Для local development:

* Docker Compose;
* PostgreSQL;
* Redis;
* API;
* Worker;
* Admin;
* Mailhog или mock notification service при необходимости.

Для MVP deployment:

* Docker;
* managed PostgreSQL;
* managed Redis;
* отдельные API и worker processes.

Для enterprise:

* AWS или GCP;
* KMS;
* secret manager;
* private networking;
* backups;
* audit logging;
* autoscaling;
* disaster recovery;
* regional data residency configuration.

---

# 5. Monorepo structure

Создай структуру, похожую на следующую:

```text
/apps
  /api
  /worker
  /admin
  /slack-app

/packages
  /domain
  /application
  /contracts
  /database
  /channel-core
  /channel-slack
  /ai-core
  /ai-openai
  /memory
  /survey
  /safety
  /scheduling
  /observability
  /config
  /testing
  /eslint-config
  /typescript-config

/evals
  /datasets
  /scenarios
  /promptfoo
  /reports

/docs
  ARCHITECTURE.md
  DATA_MODEL.md
  EVENT_MODEL.md
  MEMORY_MODEL.md
  SURVEY_ENGINE.md
  SAFETY.md
  PRIVACY.md
  OBSERVABILITY.md
  EVALS.md
  RUNBOOK.md
  THREAT_MODEL.md
  API.md
  /adr

/infra
  /docker
  /terraform
  /kubernetes
```

Не создавай искусственное количество пакетов, если это делает MVP слишком сложным. Сохрани логические boundaries, даже если часть модулей сначала находится в одном deployable service.

---

# 6. Domain model

Спроектируй следующие основные entities.

## Tenant and access

### Tenant

* id;
* name;
* status;
* timezone;
* locale;
* retention policy;
* safety policy;
* proactive messaging policy;
* survey configuration;
* createdAt;
* updatedAt.

### WorkspaceConnection

* id;
* tenantId;
* channelType;
* externalWorkspaceId;
* encrypted credentials;
* status;
* scopes;
* installedAt;
* lastValidatedAt.

### User

* id;
* tenantId;
* status;
* preferredName;
* timezone;
* locale;
* communicationPreferences;
* proactiveMessagingEnabled;
* quietHours;
* onboardingStatus;
* consentState;
* createdAt;
* updatedAt;
* deletedAt.

### ChannelAccount

* id;
* userId;
* channelType;
* externalWorkspaceId;
* externalUserId;
* displayName;
* profileMetadata;
* createdAt;
* updatedAt.

## Conversations

### Conversation

* id;
* tenantId;
* userId;
* channelType;
* externalConversationId;
* status;
* lastMessageAt;
* activeTopic;
* createdAt;
* updatedAt.

### Message

* id;
* tenantId;
* conversationId;
* userId;
* direction;
* senderType;
* externalMessageId;
* externalThreadId;
* text;
* normalizedText;
* messageType;
* metadata;
* occurredAt;
* receivedAt;
* sentAt;
* traceId;
* promptVersion;
* model;
* deletedAt.

Raw user message должен сохраняться отдельно от AI-derived data.

## Memory

### MemoryItem

Поля:

* id;
* tenantId;
* userId;
* category;
* canonicalKey;
* content;
* structuredValue;
* confidence;
* importance;
* sensitivity;
* status;
* sourceMessageIds;
* sourceType;
* validFrom;
* validUntil;
* expiresAt;
* lastConfirmedAt;
* supersededById;
* extractorVersion;
* promptVersion;
* createdAt;
* updatedAt.

Категории памяти:

* profile_fact;
* role;
* team_context;
* project_context;
* goal;
* concern;
* stressor;
* preference;
* communication_preference;
* commitment;
* milestone;
* relationship_context;
* achievement;
* recurring_topic;
* support_preference.

Не сохраняй как долгосрочную память:

* случайную реплику без будущей ценности;
* непроверенный вывод;
* временную эмоцию без контекста;
* диагноз;
* предположение о личной характеристике;
* секрет или чувствительную информацию без продуктовой необходимости;
* данные, запрещённые privacy policy.

## Goals

### UserGoal

* id;
* tenantId;
* userId;
* title;
* description;
* category;
* status;
* priority;
* targetDate;
* sourceMessageIds;
* confidence;
* nextCheckInAt;
* completedAt;
* cancelledAt;
* createdAt;
* updatedAt.

## Risk signals

### RiskSignal

* id;
* tenantId;
* userId;
* type;
* severity;
* confidence;
* evidenceMessageIds;
* status;
* recommendedAction;
* policyVersion;
* detectedAt;
* reviewedAt;
* resolvedAt;
* expiresAt.

RiskSignal не является диагнозом.

## Scheduled actions

### ScheduledAction

* id;
* tenantId;
* userId;
* conversationId;
* type;
* intent;
* context;
* reason;
* dueAt;
* allowedWindowStart;
* allowedWindowEnd;
* timezone;
* status;
* relevancePolicy;
* cancellationConditions;
* attemptCount;
* maxAttempts;
* lastAttemptAt;
* deduplicationKey;
* sourceMessageIds;
* createdAt;
* updatedAt.

Типы:

* goal_check_in;
* wellbeing_check_in;
* preparation_follow_up;
* promised_resource;
* survey_follow_up;
* onboarding_follow_up;
* unresolved_problem_follow_up.

## Survey

### SurveyDefinition

* id;
* tenantId или global scope;
* name;
* version;
* active;
* configuration;
* createdAt.

### SurveyQuestion

* id;
* surveyDefinitionId;
* stableKey;
* title;
* canonicalMeaning;
* dimension;
* evidenceRequirements;
* positiveIndicators;
* negativeIndicators;
* probeStrategies;
* contraindications;
* confidenceThreshold;
* completenessThreshold;
* minimumEvidenceCount;
* cooldownDays;
* maxFollowUpProbes;
* scoringConfiguration;
* displayOrder;
* version.

### SurveyWindow

* id;
* tenantId;
* userId;
* surveyDefinitionId;
* periodType;
* periodStart;
* periodEnd;
* status;
* coverage;
* completedAt.

### SurveyEvidence

* id;
* surveyWindowId;
* surveyQuestionId;
* userId;
* sourceMessageIds;
* evidenceSummary;
* polarity;
* strength;
* completeness;
* confidence;
* evaluatorVersion;
* promptVersion;
* createdAt;
* supersededAt.

### SurveyAssessment

* id;
* surveyWindowId;
* surveyQuestionId;
* score;
* confidence;
* status;
* reasoningSummary;
* evidenceIds;
* evaluatorVersion;
* calculatedAt;
* reviewedAt.

## AI operations

### PromptVersion

* id;
* key;
* version;
* contentHash;
* schemaVersion;
* modelConfiguration;
* status;
* createdAt.

### LlmRun

* id;
* tenantId;
* userId;
* taskType;
* provider;
* model;
* promptVersion;
* inputTokenCount;
* outputTokenCount;
* latencyMs;
* estimatedCost;
* status;
* traceId;
* errorCode;
* createdAt.

Не сохраняй полный чувствительный prompt в обычные application logs.

## Security and audit

### AuditLog

* id;
* tenantId;
* actorType;
* actorId;
* action;
* resourceType;
* resourceId;
* reason;
* metadata;
* traceId;
* createdAt.

Audit log должен быть append-only.

---

# 7. Memory architecture

Не создавай одну vector-memory «свалку».

Используй несколько уровней.

## 7.1 Raw memory

Все сообщения и channel events.

Назначение:

* аудит;
* восстановление контекста;
* повторная обработка;
* улучшение extractor versions;
* расследование ошибок.

## 7.2 Episodic memory

Summary определённой беседы, дня или темы.

Пример:

> Пользователь готовится к Lead assessment. Основное беспокойство связано с system design. Он согласился попробовать mock interview на следующей неделе.

## 7.3 Semantic profile

Устойчивые факты:

* роль;
* проект;
* карьерная цель;
* важные предпочтения;
* формат помощи;
* recurring challenges.

## 7.4 Active context

Текущие цели, проблемы, обязательства и follow-ups.

## 7.5 Survey evidence

Отдельное хранилище evidence. Не смешивай его с обычными memory items.

## 7.6 Retrieval strategy

При подготовке ответа учитывай:

* semantic relevance;
* recency;
* importance;
* confidence;
* active status;
* sensitivity;
* topic match;
* source reliability;
* confirmation by user;
* context budget.

Не добавляй чувствительную память в unrelated conversation только потому, что vector similarity оказался высоким.

Результат retrieval должен быть typed:

```ts
interface RetrievedUserContext {
  profileFacts: MemoryItem[];
  activeGoals: UserGoal[];
  activeConcerns: MemoryItem[];
  commitments: MemoryItem[];
  relevantEpisodes: EpisodicMemory[];
  recentMessages: Message[];
  surveyContext: SurveyContext;
  activeRiskContext?: SafeRiskContext;
}
```

## 7.7 Conflict resolution

Если новая информация конфликтует со старой:

* не перезаписывай старую запись без следа;
* учитывай recency;
* учитывай confidence;
* учитывай явное подтверждение пользователя;
* помечай старую запись как superseded;
* сохраняй source messages;
* при необходимости задай естественный уточняющий вопрос.

Пример:

Старая память:

> Assessment состоится 20 августа.

Новое сообщение:

> Assessment перенесли на сентябрь.

Создай новую версию и отмени follow-ups, привязанные к старой дате.

## 7.8 User controls

Пользователь должен иметь возможность:

* посмотреть, что система помнит;
* исправить память;
* удалить отдельную память;
* удалить историю;
* отключить proactive messages;
* настроить quiet hours;
* отключить участие в survey;
* запросить удаление аккаунта;
* экспортировать свои данные.

---

# 8. AI services

Создай отдельные AI-компоненты с независимыми schemas и prompt versions.

## 8.1 Situation Classifier

Определяет:

* support;
* coaching;
* goal_setting;
* progress_update;
* casual_conversation;
* clarification;
* survey_opportunity;
* conflict;
* burnout_signal;
* harassment_signal;
* potential_crisis;
* celebration;
* onboarding;
* feedback_request.

Structured output:

```ts
const SituationClassificationSchema = z.object({
  primaryIntent: z.enum([
    "support",
    "coaching",
    "goal_setting",
    "progress_update",
    "casual_conversation",
    "clarification",
    "survey_opportunity",
    "conflict",
    "burnout_signal",
    "harassment_signal",
    "potential_crisis",
    "celebration",
    "onboarding",
    "feedback_request"
  ]),
  secondaryIntents: z.array(z.string()),
  emotionalState: z.array(z.string()),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  requiresSafetyCheck: z.boolean(),
  surveyAllowed: z.boolean(),
  reasoningSummary: z.string()
});
```

`reasoningSummary` должен быть кратким объяснением результата, а не скрытым chain of thought.

## 8.2 Memory Extractor

Возвращает proposals:

```ts
const MemoryProposalSchema = z.object({
  memoryItems: z.array(
    z.object({
      category: z.string(),
      canonicalKey: z.string().optional(),
      content: z.string(),
      structuredValue: z.record(z.unknown()).optional(),
      confidence: z.number().min(0).max(1),
      importance: z.number().min(0).max(1),
      sensitivity: z.enum(["normal", "sensitive", "highly_sensitive"]),
      expectedLifetime: z.enum([
        "days",
        "weeks",
        "months",
        "long_term"
      ]),
      sourceMessageIds: z.array(z.string()),
      action: z.enum(["create", "update", "supersede", "ignore"])
    })
  ),
  goalProposals: z.array(z.unknown()),
  commitmentProposals: z.array(z.unknown()),
  followUpCandidates: z.array(z.unknown())
});
```

## 8.3 Risk Detector

Отдельный шаг, не совмещённый только с response generation.

Возвращает:

* risk type;
* severity;
* confidence;
* evidence;
* immediate response requirements;
* escalation recommendation;
* whether survey must be blocked;
* whether proactive messages must be paused.

## 8.4 Survey Evidence Evaluator

Возвращает:

* candidate question IDs;
* evidence;
* polarity;
* strength;
* completeness;
* confidence;
* whether follow-up probe is needed;
* whether threshold is reached;
* whether assessment should remain unknown.

## 8.5 Follow-up Planner

Предлагает scheduled intents, но не создаёт jobs напрямую.

Каждый proposal содержит:

* type;
* topic;
* reason;
* recommended delay;
* earliest time;
* latest useful time;
* relevance checks;
* cancellation conditions;
* message strategy;
* confidence.

Backend применяет policy и решает, создавать ли scheduled action.

## 8.6 Response Generator

Response Generator получает уже подготовленный context и reply strategy.

Он не должен самостоятельно:

* читать всю базу;
* выполнять произвольный retrieval;
* записывать память;
* создавать scheduled actions;
* выставлять survey score;
* отправлять Slack messages;
* эскалировать пользователя;
* менять permissions.

Ответ должен соответствовать communication policy.

---

# 9. Conversation policy

Ответы агента должны быть:

* естественными;
* конкретными;
* эмпатичными;
* персонализированными;
* не слишком длинными;
* связанными с текущей ситуацией;
* без повторения одного и того же вступления;
* без постоянного «Мне жаль, что вы с этим столкнулись»;
* без излишней терапии;
* без корпоративной канцелярщины;
* без давления;
* без ложной уверенности;
* без необоснованных выводов.

Рекомендуемая структура ответа не должна быть жёстким шаблоном, но может включать:

1. Признание ситуации или эмоции.
2. Уточнение наиболее важной части.
3. Один конкретный следующий шаг.
4. Предложение практической помощи.
5. При необходимости — согласование будущего follow-up.

Пример плохого ответа:

> Я понимаю ваши чувства. Выгорание является серьёзной проблемой. Рекомендую поговорить с менеджером, отдыхать и соблюдать work-life balance.

Пример более подходящего ответа:

> Похоже, тебя выматывает не только объём работы, но и ощущение, что этому пока не видно конца. Что сейчас сильнее всего давит: сроки, количество задач или то, что приоритеты постоянно меняются? От этого можно оттолкнуться и решить, что реально получится изменить уже на этой неделе.

При обсуждении целей агент должен помнить контекст и предлагать конкретный формат помощи:

* подготовить план;
* провести mock interview;
* разобрать вопрос;
* помочь сформулировать разговор с менеджером;
* разделить большую цель на шаги;
* вернуться к теме позже.

---

# 10. Conversation orchestrator

Conversation Orchestrator должен быть application service, а не одним prompt.

Пример pipeline:

```text
Receive normalized message
  -> Load user and tenant policy
  -> Persist message
  -> Load recent conversation
  -> Retrieve relevant memory
  -> Load active goals and scheduled actions
  -> Run situation classification
  -> Run safety analysis when needed
  -> Determine conversation mode
  -> Determine whether survey is allowed
  -> Select reply strategy
  -> Generate response
  -> Validate response
  -> Apply safety post-check
  -> Persist outgoing message
  -> Publish message.send.requested
  -> Schedule background extraction jobs
```

Conversation modes:

* normal;
* supportive;
* coaching;
* sensitive;
* crisis;
* survey_probe;
* proactive_follow_up;
* onboarding;
* celebration.

Код определяет доступные переходы между modes.

---

# 11. Proactive messaging engine

Проактивность должна быть основана на scheduled intents, а не на произвольных cron-prompts.

## Required policies

* user opt-in или tenant policy;
* quiet hours;
* timezone;
* daily and weekly contact limits;
* topic cooldown;
* follow-up deduplication;
* relevance check;
* stale intent cancellation;
* active crisis suppression;
* completed goal cancellation;
* recent conversation suppression;
* user inactivity rules;
* no guilt-inducing language.

Каждый due follow-up проходит workflow:

```text
Scheduled action becomes due
  -> Acquire distributed lock
  -> Load latest user context
  -> Validate action status
  -> Check cancellation conditions
  -> Check quiet hours
  -> Check proactive contact limits
  -> Check topic relevance
  -> Check recent incoming messages
  -> Check risk and safety state
  -> Decide send / postpone / cancel / merge
  -> Generate personalized message
  -> Validate content
  -> Send through ChannelAdapter
  -> Persist result
```

Поддерживай natural scheduling phrases:

* «через пару дней»;
* «на следующей неделе»;
* «после встречи в пятницу»;
* «перед ассесментом»;
* «после релиза».

Относительные даты должны преобразовываться в конкретный `dueAt` с сохранением исходной формулировки и confidence.

---

# 12. Survey Engine

Survey Engine должен быть самостоятельным domain module.

Основные компоненты:

* SurveyWindowManager;
* SurveyCoverageService;
* SurveyOpportunityPolicy;
* SurveyEvidenceService;
* SurveyAssessmentService;
* ProbeSelectionService;
* SurveyCooldownPolicy;
* SurveySuppressionPolicy.

## Opportunity policy

Survey probe разрешён только если:

* нет high-risk ситуации;
* пользователь не находится в явном сильном стрессе;
* текущий вопрос логически связан с темой;
* cooldown соблюдён;
* за последнюю беседу не было слишком много probes;
* evidence ещё недостаточно;
* пользователь не отключил survey;
* вопрос не был уже закрыт с высокой уверенностью;
* probe не мешает решить основную проблему пользователя.

## Evidence lifecycle

Evidence может быть:

* implicit;
* explicit;
* partial;
* supporting;
* contradicting;
* outdated;
* superseded.

Assessment statuses:

* unknown;
* insufficient_evidence;
* partially_covered;
* covered;
* scored;
* needs_review;
* suppressed.

Не генерируй score, если evidence недостаточно.

Храни отдельно:

* factual evidence;
* evaluator interpretation;
* final score;
* confidence.

Это позволит позднее переоценить evidence новой моделью без изменения raw messages.

---

# 13. Safety architecture

Создай собственный policy engine. Не полагайся только на provider moderation.

Поддерживай сценарии:

* burnout;
* severe stress;
* workplace harassment;
* discrimination report;
* conflict with manager;
* fear of termination;
* potential self-harm;
* immediate danger;
* medical or legal request;
* request to expose another employee’s private data.

## Safety rules

* не ставить диагнозы;
* не утверждать, что пользователь точно находится в состоянии выгорания;
* не делать performance conclusions по одному сообщению;
* не сообщать менеджеру содержимое личных разговоров по умолчанию;
* не использовать survey во время safety-sensitive сценария;
* не давать ложных обещаний конфиденциальности;
* прозрачно объяснять privacy boundaries;
* при critical risk использовать tenant-configurable escalation workflow;
* сохранять минимально необходимый объём чувствительных данных;
* ограничивать срок хранения risk signals;
* регистрировать доступ к чувствительным данным;
* не показывать sensitive risk details в обычной manager analytics.

Создай отдельный `SAFETY.md` с:

* taxonomy;
* severity definitions;
* response policies;
* escalation matrix;
* suppression rules;
* examples;
* testing scenarios;
* limitations.

---

# 14. Privacy and permissions

Продукт работает с чувствительной информацией сотрудников. Privacy является частью архитектуры, а не поздним дополнением.

Обязательно реализуй:

* multi-tenant isolation;
* tenant ID во всех tenant-owned entities;
* database-level restrictions;
* RBAC;
* ABAC для sensitive resources;
* encryption at rest;
* encryption in transit;
* secret management;
* audit logs;
* retention policies;
* data deletion workflow;
* data export workflow;
* user consent state;
* proactive messaging preferences;
* survey participation preferences;
* access review;
* least privilege;
* PII redaction in logs;
* separate production and development data;
* prohibition on copying real conversations into local development.

## Roles

Минимально:

* platform_admin;
* tenant_admin;
* privacy_admin;
* support_operator;
* manager;
* analyst;
* employee.

Менеджер не получает доступ к raw conversations по умолчанию.

Manager analytics может показывать:

* агрегированные trends;
* survey coverage;
* anonymized cohort indicators;
* changes over time;
* areas requiring organizational attention.

Не показывай:

* личные цитаты без явного разрешения;
* полный message history;
* индивидуальные private concerns;
* inferred diagnoses;
* single-person cohort analytics.

Используй minimum cohort size и suppression rules для снижения риска повторной идентификации.

---

# 15. Slack-specific implementation

Реализуй следующие Slack flows:

## Installation

* OAuth installation;
* workspace connection;
* encrypted bot token;
* required scopes;
* installation status;
* reauthorization handling;
* uninstall handling.

## Events

Поддерживай:

* direct messages;
* app mentions при необходимости;
* message events;
* Slack retries;
* duplicate delivery;
* edited messages;
* deleted messages;
* bot messages;
* thread replies;
* user profile changes при необходимости.

Webhook должен:

1. Проверить signature.
2. Проверить timestamp.
3. Обработать URL verification.
4. Вернуть acknowledgement максимально быстро.
5. Положить event в queue.
6. Не выполнять LLM call внутри webhook request.

## Message sending

* rate-limit aware sending;
* retry;
* Slack error mapping;
* thread support;
* markdown-safe formatting;
* message length handling;
* idempotency;
* storage of external message ID.

## Local development

Поддержи Socket Mode, чтобы разработчик мог запустить Slack integration без публичного webhook.

---

# 16. API surface

Создай versioned REST API.

Примерные endpoints:

```text
POST   /api/v1/channel/slack/events
GET    /api/v1/channel/slack/oauth/start
GET    /api/v1/channel/slack/oauth/callback

GET    /api/v1/users/:userId
GET    /api/v1/users/:userId/memory
PATCH  /api/v1/users/:userId/preferences
DELETE /api/v1/users/:userId/memory/:memoryId
POST   /api/v1/users/:userId/data-export
POST   /api/v1/users/:userId/data-deletion

GET    /api/v1/users/:userId/goals
GET    /api/v1/users/:userId/scheduled-actions
POST   /api/v1/users/:userId/scheduled-actions/:id/cancel

GET    /api/v1/surveys
GET    /api/v1/surveys/:surveyId/windows
GET    /api/v1/surveys/:surveyId/coverage

GET    /api/v1/admin/audit-logs
GET    /api/v1/admin/llm-runs
GET    /api/v1/admin/dead-letter-jobs
POST   /api/v1/admin/dead-letter-jobs/:id/retry
```

Применяй authorization на каждом endpoint.

---

# 17. Admin panel

Создай admin panel со следующими разделами.

## Operations

* service health;
* queue health;
* failed jobs;
* dead-letter jobs;
* recent errors;
* Slack connection status;
* worker status.

## AI observability

* LLM runs;
* task type;
* model;
* prompt version;
* latency;
* token usage;
* estimated cost;
* structured output validation errors;
* fallback usage;
* trace details.

## User debug view

Только для авторизованных ролей:

* user profile;
* recent messages с redaction policy;
* active memory;
* goals;
* scheduled actions;
* survey coverage;
* risk status в разрешённой форме;
* audit trail.

Каждый доступ к sensitive user view должен попадать в audit log.

## Survey configuration

* definitions;
* questions;
* thresholds;
* cooldowns;
* assessment windows;
* prompt versions;
* activation status.

## Prompt management

На MVP prompts могут храниться в Git, но admin должен хотя бы показывать используемые версии.

Не разрешай редактировать production prompts без versioning, review и rollback.

---

# 18. Observability

Для каждого входящего сообщения создай единый trace.

Trace должен связывать:

* Slack event;
* normalized message;
* database operations;
* memory retrieval;
* LLM calls;
* classification result;
* safety decision;
* survey decision;
* response generation;
* outgoing Slack message;
* background jobs;
* scheduled follow-ups.

Metrics:

* incoming messages;
* outgoing messages;
* processing latency;
* LLM latency;
* queue delay;
* queue failures;
* retry count;
* DLQ size;
* response generation errors;
* structured output failures;
* safety detections;
* proactive messages sent;
* proactive messages cancelled;
* survey probes;
* survey suppression decisions;
* memory items created;
* memory conflicts;
* token usage;
* LLM cost per tenant and task type.

Логи должны быть structured JSON и не содержать чувствительный message text по умолчанию.

---

# 19. AI evaluation framework

Создай evaluation pipeline до масштабирования продукта.

Используй:

* Promptfoo;
* versioned datasets;
* deterministic test fixtures;
* mocked LLM responses для integration tests;
* optional real-model evaluation jobs;
* comparison between prompt/model versions.

## Golden datasets

Минимальные категории:

### Empathy

* пользователь сообщает о выгорании;
* пользователь сомневается в себе;
* пользователь переживает перед assessment;
* пользователь сообщает о конфликте;
* пользователь делится успехом.

### Memory

* новая устойчивая цель;
* временная информация;
* конфликтующая дата;
* завершённая цель;
* чувствительная информация;
* информация, которую не нужно сохранять.

### Proactivity

* follow-up действительно нужен;
* тема уже закрыта;
* пользователь недавно сам обновил статус;
* пользователь отключил proactive messages;
* наступили quiet hours;
* несколько похожих scheduled actions;
* follow-up больше не актуален.

### Survey

* evidence присутствует без прямого вопроса;
* evidence частичное;
* evidence противоречивое;
* вопрос уместен;
* вопрос неуместен;
* пользователь находится в стрессе;
* confidence недостаточен;
* assessment уже закрыт.

### Privacy

* менеджер запрашивает личный разговор;
* аналитика строится для одного человека;
* пользователь просит удалить память;
* пользователь исправляет ошибочный факт;
* sensitive data появляется в logs.

### Safety

* burnout;
* harassment;
* potential self-harm;
* immediate danger;
* vague distress;
* обычное плохое настроение;
* просьба о медицинском диагнозе.

## Evaluation dimensions

* empathy;
* relevance;
* personalization;
* actionability;
* non-repetition;
* factual consistency;
* memory precision;
* memory recall;
* false-memory rate;
* survey naturalness;
* survey appropriateness;
* risk detection recall;
* risk detection precision;
* privacy compliance;
* follow-up usefulness;
* follow-up annoyance risk.

Добавь threshold, при котором prompt или model version нельзя выпускать в production.

---

# 20. Testing strategy

## Unit tests

Покрой:

* domain policies;
* memory conflict resolution;
* survey cooldowns;
* scheduling rules;
* quiet hours;
* deduplication;
* risk suppression;
* permissions;
* tenant isolation;
* date calculations;
* score thresholds.

## Integration tests

Используй test containers для PostgreSQL и Redis.

Покрой:

* database repositories;
* transaction boundaries;
* outbox processing;
* queue retries;
* Slack event normalization;
* scheduled action execution;
* memory persistence;
* survey evidence persistence.

## Contract tests

Проверь:

* ChannelAdapter interface;
* LLM Gateway interface;
* structured output schemas;
* Slack payloads;
* provider error mapping.

## End-to-end tests

Сценарии:

1. Пользователь впервые пишет боту.
2. Завершается onboarding.
3. Пользователь сообщает о цели.
4. Создаётся memory item.
5. Создаётся scheduled follow-up.
6. Follow-up становится due.
7. Relevance check проходит.
8. Сообщение отправляется.
9. Пользователь отвечает.
10. Цель обновляется.

Отдельный E2E:

1. Пользователь пишет о сильном стрессе.
2. Safety layer блокирует survey.
3. Response Generator получает supportive strategy.
4. Scheduled survey action не создаётся.
5. Решение попадает в audit trail.

## Load tests

Проверь:

* burst Slack events;
* duplicate deliveries;
* slow LLM provider;
* provider outage;
* Redis restart;
* worker restart;
* Slack rate limiting;
* scheduled follow-up spikes.

## Security tests

Проверь:

* tenant data leakage;
* broken object-level authorization;
* prompt injection;
* malicious Slack payload;
* replay attack;
* secret exposure;
* sensitive logs;
* unauthorized admin access;
* user data deletion completeness.

---

# 21. Prompt injection protection

Пользовательский текст является недоверенным вводом.

Нельзя позволять сообщению пользователя:

* менять system policy;
* запрашивать hidden prompts;
* заставлять AI раскрывать другую память;
* выполнять произвольные tools;
* обходить privacy rules;
* изменять survey score напрямую;
* отправлять сообщения другим пользователям;
* читать admin data.

Разделяй:

* system instructions;
* tenant configuration;
* trusted retrieved context;
* untrusted user content;
* tool outputs.

Все tool calls должны быть allowlisted и typed.

Для conversation response предпочтительно вообще не давать модели mutation tools.

---

# 22. Data lifecycle

Реализуй:

* configurable retention;
* soft deletion только для recoverable operational cases;
* hard deletion workflow для user request;
* cancellation of pending jobs after deletion;
* deletion from vector indexes;
* deletion or anonymization of derived data;
* audit event без сохранения удалённого content;
* backup retention policy;
* export generation;
* legal hold extension point;
* tenant offboarding.

Derived data должно быть связано с source data, чтобы его можно было удалить или пересчитать.

---

# 23. Reliability requirements

Система должна поддерживать:

* idempotent handlers;
* at-least-once event delivery;
* deduplication;
* transactional outbox;
* graceful shutdown;
* worker heartbeat;
* distributed locks;
* retry with backoff;
* DLQ;
* replay tooling;
* provider fallback;
* timeouts;
* circuit breakers;
* backpressure;
* rate limiting;
* health checks;
* readiness checks;
* migrations before application startup;
* safe rollback.

Не считай queue job успешно выполненным до подтверждённой записи результата.

---

# 24. Feature flags

Добавь tenant-aware feature flags:

* proactive messaging;
* conversational survey;
* risk detection;
* human escalation;
* memory extraction;
* vector retrieval;
* manager analytics;
* specific model version;
* specific prompt version;
* new survey evaluator;
* Temporal workflows.

Feature flags должны позволять:

* gradual rollout;
* tenant allowlist;
* percentage rollout;
* immediate rollback;
* A/B evaluation.

---

# 25. Development workflow

Если репозиторий пустой:

1. Инициализируй monorepo.
2. Создай базовые приложения и packages.
3. Настрой TypeScript.
4. Настрой linting и formatting.
5. Добавь Docker Compose.
6. Добавь PostgreSQL и Redis.
7. Создай migrations.
8. Создай `.env.example`.
9. Добавь health endpoints.
10. Добавь CI.
11. Добавь документацию.
12. После этого реализуй vertical slices.

Если репозиторий уже существует:

1. Сначала изучи текущую структуру.
2. Не переписывай рабочие части без необходимости.
3. Создай gap analysis.
4. Предложи migration plan.
5. Сохраняй backwards compatibility, где это разумно.
6. Делай небольшие логические изменения.
7. Не создавай фиктивные реализации, замаскированные под готовую функциональность.

---

# 26. Implementation phases

## Phase 0: Foundation

Реализовать:

* monorepo;
* configuration;
* API;
* worker;
* admin shell;
* PostgreSQL;
* Redis;
* migrations;
* logging;
* OpenTelemetry;
* health checks;
* CI;
* Docker Compose;
* tenant and user entities;
* audit infrastructure.

Acceptance criteria:

* весь проект запускается одной командой;
* migrations применяются;
* API и worker доступны;
* health checks работают;
* тесты проходят;
* tenant context обязателен.

## Phase 1: Slack vertical slice

Реализовать:

* Slack installation;
* Events API;
* Socket Mode для local;
* signature verification;
* event acknowledgement;
* event persistence;
* normalization;
* queue processing;
* message storage;
* simple AI response;
* Slack sending;
* idempotency;
* trace linking.

Acceptance criteria:

* пользователь пишет в Slack DM;
* webhook быстро отвечает;
* сообщение проходит через queue;
* ответ отправляется;
* duplicate event не создаёт duplicate response;
* все шаги видны в trace.

## Phase 2: Memory

Реализовать:

* MemoryItem model;
* memory extraction;
* structured output validation;
* conflict resolution;
* episodic summaries;
* retrieval;
* user memory API;
* delete and correct memory.

Acceptance criteria:

* цель пользователя сохраняется;
* случайная информация не сохраняется;
* конфликтующие данные версионируются;
* ответ использует релевантную память;
* пользователь может удалить memory item.

## Phase 3: Proactive follow-ups

Реализовать:

* follow-up proposals;
* ScheduledAction;
* BullMQ delayed jobs;
* timezone;
* quiet hours;
* relevance checks;
* cancellation rules;
* contact limits;
* personalized follow-up generation.

Acceptance criteria:

* цель создаёт уместный follow-up;
* завершённая цель отменяет follow-up;
* quiet hours соблюдаются;
* duplicate follow-ups не отправляются;
* follow-up не выглядит как системное напоминание.

## Phase 4: Conversational survey

Реализовать:

* survey definitions;
* survey windows;
* survey questions;
* evidence extraction;
* confidence;
* opportunity policy;
* natural probes;
* cooldowns;
* suppression;
* assessment state.

Начать с 2–3 configurable dimensions, но архитектура должна поддерживать полный набор.

Acceptance criteria:

* evidence может быть извлечено без прямого вопроса;
* partial evidence не закрывает вопрос;
* survey probe связан с текущей темой;
* survey блокируется во время сильного стресса;
* assessment хранит evidence и evaluator version.

## Phase 5: Safety and privacy

Реализовать:

* risk detector;
* policy engine;
* risk levels;
* survey suppression;
* proactive suppression;
* escalation extension point;
* user privacy controls;
* RBAC;
* sensitive access audit;
* data export;
* data deletion.

Acceptance criteria:

* sensitive сценарии корректно маршрутизируются;
* менеджер не может читать raw conversations;
* удаление пользователя очищает derived data;
* доступ к sensitive view аудируется.

## Phase 6: Admin and analytics

Реализовать:

* operations dashboard;
* queue status;
* LLM runs;
* prompt versions;
* scheduled actions;
* survey coverage;
* aggregate analytics;
* minimum cohort rules;
* audit viewer.

## Phase 7: Scaling

Подготовить:

* Temporal migration adapter;
* provider routing;
* model fallbacks;
* enterprise deployment;
* KMS;
* regional storage;
* advanced analytics;
* additional channel adapters.

---

# 27. Documentation deliverables

Обязательно создай:

## `ARCHITECTURE.md`

* system context;
* container diagram;
* component diagram;
* request flows;
* async flows;
* scaling strategy;
* trade-offs.

## `DATA_MODEL.md`

* entities;
* relationships;
* indexes;
* tenant isolation;
* encryption;
* retention.

## `MEMORY_MODEL.md`

* memory taxonomy;
* extraction;
* retrieval;
* conflicts;
* expiry;
* user controls.

## `SURVEY_ENGINE.md`

* survey states;
* evidence model;
* opportunity policy;
* scoring;
* suppression;
* examples.

## `SAFETY.md`

* risk taxonomy;
* response policy;
* escalation;
* limitations.

## `PRIVACY.md`

* data categories;
* access model;
* manager visibility;
* retention;
* deletion;
* export.

## `EVENT_MODEL.md`

* events;
* schemas;
* retries;
* idempotency;
* outbox;
* DLQ.

## `EVALS.md`

* datasets;
* metrics;
* release gates;
* evaluation commands.

## `RUNBOOK.md`

* provider outage;
* Slack outage;
* stuck queue;
* DLQ replay;
* database incident;
* accidental prompt release;
* rollback.

## ADRs

Минимально:

* ADR-001: Hexagonal architecture;
* ADR-002: PostgreSQL as source of truth;
* ADR-003: pgvector for initial semantic retrieval;
* ADR-004: BullMQ for MVP workflows;
* ADR-005: LLMs cannot directly mutate domain state;
* ADR-006: Channel adapter abstraction;
* ADR-007: Survey as evidence-based state machine;
* ADR-008: Privacy boundaries for manager analytics;
* ADR-009: Prompt and model versioning;
* ADR-010: Future migration path to Temporal.

---

# 28. Coding standards

* TypeScript strict mode.
* Не использовать `any`, кроме обоснованных boundary cases.
* Все public functions и domain contracts typed.
* Все AI outputs валидируются.
* Все dates хранятся в UTC.
* User timezone применяется только при presentation и scheduling.
* Business rules не находятся в controllers.
* Controllers тонкие.
* ORM entities не используются как domain entities.
* Не создавать generic repository без реальной необходимости.
* Не добавлять abstraction только ради abstraction.
* Использовать dependency inversion на внешних boundaries.
* Ошибки должны быть typed.
* Не скрывать ошибки пустыми `catch`.
* Все background handlers должны быть idempotent.
* Sensitive values не логируются.
* Комментарии объясняют причину, а не повторяют код.
* Названия кода, документации и commit messages — на английском.
* Пользовательские тексты поддерживают localization.

---

# 29. Definition of done

Функциональность считается завершённой, только когда:

* есть рабочая реализация;
* есть unit tests;
* есть integration tests;
* есть error handling;
* есть logs и metrics;
* есть permissions;
* учтена tenant isolation;
* обновлена документация;
* обновлена схема базы;
* есть migration;
* есть rollback consideration;
* AI outputs валидируются;
* sensitive data не попадает в logs;
* добавлен audit trail, если действие чувствительное;
* добавлены evaluation scenarios, если изменяется AI behavior.

---

# 30. Required working style

Во время реализации:

1. Сначала проанализируй репозиторий.
2. Зафиксируй assumptions.
3. Создай architecture plan.
4. Определи boundaries.
5. Создай ADR для значимых решений.
6. После этого реализуй минимальный end-to-end vertical slice.
7. Не создавай сразу десятки disconnected services.
8. Предпочитай modular monolith для MVP.
9. Подготавливай boundaries для дальнейшего выделения сервисов.
10. После каждого этапа запускай lint, typecheck и tests.
11. Исправляй ошибки, а не оставляй их как «future work».
12. Не заменяй реализацию псевдокодом.
13. Не создавай mock implementation в production path.
14. Явно отмечай то, что невозможно завершить без credentials или внешней конфигурации.
15. Не удаляй существующий код без обоснования.
16. Не добавляй LangChain, LangGraph, Temporal или vector database только ради модных технологий.
17. Для каждого инструмента объясняй конкретную продуктовую необходимость.
18. При неоднозначности выбирай безопасное расширяемое решение и документируй assumption.
19. Не задавай уточняющий вопрос по мелким деталям — используй разумные defaults и документируй их.
20. Не утверждай, что production readiness достигнута, если отсутствуют security, monitoring, testing или privacy controls.

---

# 31. Expected first output

Перед началом массовой реализации выдай:

1. Краткое понимание продукта.
2. Список assumptions.
3. Architecture overview.
4. Container diagram в Mermaid.
5. Основные sequence diagrams в Mermaid:

   * inbound Slack message;
   * memory extraction;
   * scheduled follow-up;
   * conversational survey;
   * safety escalation.
6. Monorepo structure.
7. Data model overview.
8. Event catalog.
9. Security and privacy risks.
10. Implementation roadmap.
11. Перечень ADR.
12. Первый vertical slice, который будет реализован.
13. Команды для запуска проекта.
14. Список необходимых environment variables.

После этого переходи к созданию файлов и реализации.

---

# 32. Final architectural target

Целевая схема:

```text
Slack / Future Channels
        |
        v
Channel Adapters
        |
        v
Ingestion API
        |
        v
Event Queue
        |
        v
Conversation Orchestrator
   |        |         |
   |        |         +--> Safety Policy Engine
   |        |
   |        +------------> Survey Engine
   |
   +---------------------> Memory Retrieval
   |
   +---------------------> LLM Gateway
        |
        v
Outgoing Message Queue
        |
        v
Channel Adapter
```

Параллельные процессы:

```text
Persisted Message
   |
   +--> Memory Extraction
   |
   +--> Survey Evidence Extraction
   |
   +--> Risk Analysis
   |
   +--> Follow-up Planning
```

Проактивность:

```text
Scheduled Action
   |
   v
Relevance and Policy Check
   |
   +--> Cancel
   |
   +--> Postpone
   |
   +--> Merge
   |
   +--> Generate Personalized Follow-up
                |
                v
          Channel Adapter
```

Главное правило всей реализации:

> AI помогает понимать и формулировать, но не владеет состоянием продукта и не принимает неконтролируемые бизнес-решения.

Построй систему так, чтобы в будущем можно было заменить:

* Slack на Teams или другой channel adapter;
* OpenAI на Anthropic, Gemini или локальную модель;
* BullMQ на Temporal;
* pgvector на Qdrant;
* modular monolith на отдельные services;
* конкретный survey на другую assessment methodology;

без переписывания conversation domain, memory model, privacy model и основной business logic.
