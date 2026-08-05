---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - ../../PRODUCT_AND_FUNCTIONAL_REQUIREMENTS.md
  - ../specs/spec-maf-runtime-migration/SPEC.md
  - ../specs/spec-maf-runtime-migration/migration-plan.md
  - ../specs/spec-maf-runtime-migration/runtime-contract.md
  - ../specs/spec-maf-runtime-migration/validation-baseline.md
  - planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md
---

# enTalentNew - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the MAF runtime migration, decomposing the migration SPEC, current product requirements, and architecture spine into implementable stories. The active scope is the migration of agent orchestration behind the existing TypeScript worker, not a rewrite of the full enTalent product.

## Requirements Inventory

### Functional Requirements

FR1: The worker MUST route inbound conversation processing through a framework-neutral `AgentRuntimePort.processMessage` boundary.

FR2: The current TypeScript conversation path MUST remain available as `TypeScriptAgentRuntime` and preserve existing behavior.

FR3: The system MUST support a future `MafAgentRuntimeClient` that calls a Python service over JSON HTTP.

FR4: Runtime selection MUST be owned by an `AgentRuntimeRouter` behind `AGENT_RUNTIME_PORT`, evaluated per job.

FR5: Runtime selection MUST follow precedence: global kill switch, tenant/user denylist, shadow mode, canary mode, then TypeScript default.

FR6: Runtime flag evaluation failures MUST fail closed to TypeScript-only processing.

FR7: The first Python runtime service MUST expose `POST /runtime/process-message` for one inbound conversation turn.

FR8: The Python runtime service MUST return structured reply, risk assessment, memory candidates, proposed actions, trace ID, diagnostics, and runtime version.

FR9: The TypeScript/Python runtime HTTP contract MUST have one canonical schema source before either side of the HTTP boundary is implemented.

FR10: TypeScript and Python validators MUST be generated from the canonical schema source or proven equivalent with shared contract fixtures in CI.

FR11: Python/MAF MUST return proposals or commands only; TypeScript MUST validate and execute all first-slice side effects.

FR12: Proposed actions MUST use a canonical envelope containing action ID, aggregate type, payload, validation result, execution status, commit marker, and idempotency key.

FR13: Runtime attempts and proposed actions MUST be recorded in a persisted ledger before any user-facing MAF execution.

FR14: Fallback from MAF to TypeScript MUST be forbidden once the attempt ledger reaches actions-committed or reply-committed.

FR15: Shadow mode MUST run both current and MAF candidate runtimes while sending only the current TypeScript result to Slack.

FR16: Shadow comparison MUST record current result, candidate result, validation status, risk comparison, memory/action comparison, latency, model-call count, tool-call count, retry count, estimated cost, trace ID, redaction status, and runtime version.

FR17: MAF MUST NOT enter canary unless `conversation-sim` and migration baseline gates pass at or above TypeScript thresholds.

FR18: Migration baseline cases MUST include burnout/severe stress, potential crisis/self-harm, harassment, manager/privacy request, unwanted proactivity, explicit reminder, delayed follow-up, assessment preparation, goal creation/update, memory extraction, incorrect memory correction, casual conversation, and terse acknowledgement.

FR19: Python-to-TypeScript tool calls MUST use scoped internal service auth with tenant/workspace claims, endpoint allowlist, audit fields, and read-vs-command permissions.

FR20: TypeScript MUST validate tenant scope from authenticated service claims, not only from JSON payload fields.

FR21: The Python service MUST use FastAPI-owned routes over stable core `agent-framework`; prerelease hosting helpers MUST remain outside the first slice.

FR22: The Python service MUST define Docker build strategy, start command, health endpoint, readiness endpoint, internal URL, env vars, secret ownership, and deployment service registration before non-local shadow mode.

FR23: Durable MAF session/checkpoint storage MUST be selected and implemented before non-local or production shadow execution.

FR24: MAF session keys MUST include workspace, user, external conversation, and thread-or-DM scope.

FR25: Runtime retry budgets MUST propagate one runtime attempt number through BullMQ, HTTP, Python workflow, model calls, tool calls, and action execution.

FR26: The existing Slack webhook ingestion, HMAC verification, event persistence, BullMQ queues, message-send jobs, memory extraction jobs, survey evidence jobs, follow-up jobs, and admin APIs MUST remain TypeScript-owned in the first slice.

FR27: Existing safety behavior MUST be preserved: risk detection suppresses surveys/proactive outreach, persists risk signals, and triggers escalation for critical/immediate cases.

FR28: Existing privacy behavior MUST be preserved: manager analytics never expose raw individual conversation text, cohort minimums remain server-enforced, and GDPR deletion/export behavior remains TypeScript-owned.

FR29: Existing consent behavior MUST be preserved for survey and proactive messaging opt-in/opt-out.

FR30: Existing conversation observability MUST preserve trace linkage across Slack event, worker job, runtime execution, model/tool calls, DB writes, and queued side effects.

### NonFunctional Requirements

NFR1: The migration MUST be incremental and rollbackable; no one-PR rewrite of TypeScript to Python.

NFR2: MAF framework types MUST stay inside `agent-service` and MUST NOT leak into TypeScript domain contracts or shared modules.

NFR3: No domain aggregate may have concurrent TypeScript and Python writers.

NFR4: Production or non-local shadow execution MUST NOT rely on process-local MAF session/history storage.

NFR5: Sensitive scenarios MUST include deterministic policy checks and manual review sampling; LLM-as-judge alone is insufficient.

NFR6: Runtime errors MUST be classified with HTTP semantics, retryability, fallback eligibility, side-effect barrier status, and diagnostic fields.

NFR7: The runtime client MUST avoid multiplying retries across BullMQ, HTTP, Python workflow, model calls, tool calls, and action execution.

NFR8: Shadow diagnostics MUST be redacted and stored in a TypeScript-owned canonical record.

NFR9: The Python service target is Python 3.13.x; Python 3.12 is not the default for new service work.

NFR10: Existing Node services use Node 22 Docker images; the root `>=20.0.0` engine floor is platform cleanup debt, not the migration target.

NFR11: The migration MUST preserve the existing queue reliability posture: at-least-once delivery, 3x exponential retries, and DLQ/admin retry behavior.

NFR12: The migration MUST preserve multi-tenant isolation and tenant-filtered queries.

NFR13: The migration MUST preserve cost observability for model calls and runtime comparisons.

NFR14: The migration MUST preserve privacy-safe manager analytics and audit logging.

### Additional Requirements

- Add or preserve a global MAF kill switch and tenant/user runtime controls.
- Add an `AgentRuntimeRouter` provider behind `AGENT_RUNTIME_PORT`; concrete runtime selection must not be a process-start-only DI decision.
- Decide the canonical runtime schema source before implementing the Python endpoint or TypeScript HTTP client.
- Add shared contract fixtures that validate request/result/action/error envelopes on both sides.
- Define the runtime-attempt ledger schema and action ledger schema before user-facing MAF execution.
- Define the action execution lifecycle before MAF-generated replies can mention committed actions.
- Define an internal service auth contract for Python tools, including header/credential shape, tenant/workspace claims, endpoint allowlist, and audit fields.
- Define retry budgets and timeout ownership for BullMQ, HTTP, Python workflow, model calls, tool calls, and action execution.
- Define the shadow diagnostics record shape and redaction policy.
- Define `agent-service` deployable unit metadata before non-local shadow mode.
- Choose durable MAF session/checkpoint backend before non-local shadow mode.
- Keep Slack adapter, BullMQ scheduler, admin API, manager analytics, tenant authorization, and existing persistence repositories out of first-slice migration.
- Update migration-plan and downstream stories to use Python 3.13.x, not Python 3.12.

### UX Design Requirements

No UX design contract was found or required for this backend/runtime migration. Dashboard/admin UI changes are out of scope unless a later story needs read-only runtime/shadow diagnostics visibility.

### FR Coverage Map

FR1: Epic 1 - Runtime boundary remains the entry point for inbound turns.
FR2: Epic 1 - Existing TypeScript runtime remains the default behavior.
FR3: Epic 5 - MAF HTTP client integration is introduced after contract and service readiness.
FR4: Epic 1 - Runtime router owns per-job selection.
FR5: Epic 1 - Runtime precedence is implemented.
FR6: Epic 1 - Flag failures fail closed to TypeScript.
FR7: Epic 4 - Python service exposes the runtime endpoint.
FR8: Epic 5 - MAF workflow returns structured runtime results.
FR9: Epic 2 - Canonical schema source is chosen.
FR10: Epic 2 - Shared contract fixtures validate both sides.
FR11: Epic 2 - TypeScript remains first-slice side-effect executor.
FR12: Epic 2 - Canonical action envelope is defined.
FR13: Epic 2 - Runtime attempt/action ledger is introduced.
FR14: Epic 2 - Fallback barrier is enforced from ledger state.
FR15: Epic 3 - Shadow mode executes candidate runtime without user-facing replies.
FR16: Epic 3 - Shadow diagnostics are recorded canonically.
FR17: Epic 6 - Canary is blocked by baseline gates.
FR18: Epic 3 - Migration baseline scenarios are added.
FR19: Epic 4 - Python tools use scoped service auth.
FR20: Epic 4 - TypeScript validates tenant scope from authenticated service claims.
FR21: Epic 4 - Python service uses FastAPI routes over stable core MAF.
FR22: Epic 4 - Python service becomes deployable before non-local shadow.
FR23: Epic 4 - Durable session/checkpoint backend is selected before non-local shadow.
FR24: Epic 4 - Session keys include Slack conversation scope.
FR25: Epic 2 - Retry budgets and runtime attempt numbers are shared.
FR26: Epic 1 - Existing TypeScript transport, queues, and first-slice ownership are preserved.
FR27: Epic 6 - Safety behavior is regression-gated before rollout.
FR28: Epic 6 - Privacy and manager analytics behavior are regression-gated before rollout.
FR29: Epic 6 - Consent behavior is regression-gated before rollout.
FR30: Epic 3 - Trace linkage and runtime observability are preserved in shadow diagnostics.

## Epic List

### Epic 1: Runtime Boundary And Operator Control
Operators can keep the current TypeScript runtime as the default, route each conversation job through a runtime router, and disable all MAF behavior safely with a kill switch.
**FRs covered:** FR1, FR2, FR4, FR5, FR6, FR26.

### Epic 2: Contract, Ledger, And Side-Effect Safety
Engineers can connect TypeScript and Python through one validated runtime contract, with action envelopes, idempotency, retry budgets, and a persisted side-effect barrier that makes fallback safe.
**FRs covered:** FR9, FR10, FR11, FR12, FR13, FR14, FR25.

### Epic 3: Baseline And Shadow Comparison
Product and engineering can compare the current runtime against MAF candidates on real and simulated turns without changing user-facing Slack behavior.
**FRs covered:** FR15, FR16, FR18, FR30.

### Epic 4: Deployable Python Agent Service Foundation
The platform can run a secure, deployable Python/FastAPI MAF service with scoped internal tool access, durable session/checkpoint storage, and production-ready health/readiness surfaces.
**FRs covered:** FR7, FR19, FR20, FR21, FR22, FR23, FR24.

### Epic 5: MAF Conversation Workflow Candidate
The MAF runtime can process one inbound conversation turn behind the HTTP client and return structured reply, risk, memory, action, and diagnostics output while TypeScript still owns side effects.
**FRs covered:** FR3, FR8, FR11.

### Epic 6: Canary Readiness And Rollout Gates
The team can decide whether MAF is safe to expose to users using regression gates, safety/privacy/consent preservation checks, and staged rollout controls.
**FRs covered:** FR17, FR27, FR28, FR29.

## Epic 1: Runtime Boundary And Operator Control

Operators can keep the current TypeScript runtime as the default, route each conversation job through a runtime router, and disable all MAF behavior safely with a kill switch.

### Story 1.1: Preserve TypeScript Runtime Through AgentRuntimePort

As an operator,
I want inbound conversation jobs to continue using the current TypeScript runtime through `AgentRuntimePort`,
So that the migration starts with a behavior-preserving insertion point.

**Requirements covered:** FR1, FR2, FR26.

**Acceptance Criteria:**

**Given** the worker processes a normal `conversation` job
**When** no MAF runtime mode is enabled
**Then** the job is handled by `TypeScriptAgentRuntime`
**And** existing `ConversationOrchestrator` behavior, logs, retries, outbound messages, and tests remain unchanged.

**Given** `ConversationProcessor` is constructed
**When** dependencies are inspected
**Then** it depends on `AGENT_RUNTIME_PORT`
**And** it does not inject `ConversationOrchestrator` directly.

### Story 1.2: Add Runtime Router With TypeScript Default

As an operator,
I want a runtime router behind `AGENT_RUNTIME_PORT`,
So that runtime mode can be evaluated per job without changing worker processors again.

**Requirements covered:** FR4, FR6.

**Acceptance Criteria:**

**Given** a conversation job reaches the worker
**When** the router evaluates runtime mode
**Then** it returns `typescript` by default
**And** delegates to `TypeScriptAgentRuntime`.

**Given** runtime mode evaluation fails
**When** the worker must continue processing
**Then** the router fails closed to `typescript`
**And** records a warning with the job trace ID.

### Story 1.3: Add MAF Runtime Control Flags

As an operator,
I want explicit MAF runtime control flags and kill-switch semantics,
So that MAF can be disabled globally or scoped by tenant/user before rollout.

**Requirements covered:** FR5, FR6.

**Acceptance Criteria:**

**Given** the global MAF kill switch is enabled
**When** any conversation job is processed
**Then** runtime mode resolves to `maf_disabled`
**And** the router invokes only `TypeScriptAgentRuntime`.

**Given** tenant/user denylist rules match a job
**When** shadow or canary mode would otherwise apply
**Then** denylist precedence wins
**And** the job uses TypeScript-only processing.

### Story 1.4: Log Runtime Decisions Per Job

As an operator,
I want every runtime routing decision logged with trace context,
So that rollout behavior can be audited before shadow and canary modes.

**Requirements covered:** FR30.

**Acceptance Criteria:**

**Given** a conversation job is routed
**When** runtime mode is resolved
**Then** the log includes trace ID, tenant ID, user ID, selected mode, decision source, and fallback reason when present
**And** no message text is logged.

## Epic 2: Contract, Ledger, And Side-Effect Safety

Engineers can connect TypeScript and Python through one validated runtime contract, with action envelopes, idempotency, retry budgets, and a persisted side-effect barrier that makes fallback safe.

### Story 2.1: Choose Canonical Runtime Schema Source

As an engineer,
I want one canonical schema source for the runtime HTTP contract,
So that TypeScript and Python cannot drift into incompatible request/result shapes.

**Requirements covered:** FR9, FR10.

**Acceptance Criteria:**

**Given** runtime HTTP boundary work is about to start
**When** the schema-source decision is recorded
**Then** it names TypeScript Zod, Python Pydantic, or neutral OpenAPI as the canonical source
**And** updates the architecture/spec companion if the choice changes an open question.

**Given** shared contract fixtures exist
**When** TypeScript and Python validators are run
**Then** both accept valid fixtures and reject invalid fixtures with equivalent error categories.

### Story 2.2: Define Runtime Request And Result Contract

As an engineer,
I want a validated `ProcessMessageRequest` and `ProcessMessageResult` contract,
So that `MafAgentRuntimeClient` and `agent-service` can integrate safely.

**Requirements covered:** FR3, FR8, FR9, FR10.

**Acceptance Criteria:**

**Given** the target runtime contract is generated or authored
**When** it is consumed by TypeScript
**Then** request fields include request ID, event ID, trace ID, runtime attempt, tenant, user, conversation, message, and context.

**Given** the target runtime contract is consumed by Python
**When** a runtime result is returned
**Then** it validates reply, risk assessment, memory candidates, proposed actions, diagnostics, trace ID, and runtime version.

### Story 2.3: Define Canonical Action Envelope

As an engineer,
I want proposed actions to use a canonical envelope,
So that TypeScript can validate and execute MAF proposals without ambiguous side effects.

**Requirements covered:** FR11, FR12.

**Acceptance Criteria:**

**Given** MAF proposes a memory, follow-up, or goal action
**When** TypeScript validates the proposal
**Then** the payload includes `actionId`, aggregate type, proposed payload, validation result, execution status, commit marker, and idempotency key.

**Given** an action proposal is invalid
**When** TypeScript rejects it
**Then** the runtime result is marked validation-failed
**And** no domain write or queued side effect is executed.

### Story 2.4: Add Runtime Attempt And Action Ledgers

As an operator,
I want runtime attempts and action execution persisted,
So that fallback decisions are based on durable state rather than process-local guesses.

**Requirements covered:** FR13, FR25.

**Acceptance Criteria:**

**Given** a runtime attempt starts
**When** the worker records it
**Then** the ledger stores request ID, event ID, message ID, runtime attempt, trace ID, runtime mode, and phase.

**Given** action validation or execution advances
**When** the ledger is updated
**Then** phases include at least `started`, `candidate_received`, `actions_validated`, `actions_committed`, `reply_committed`, and `failed`.

### Story 2.5: Enforce Fallback Barrier From Ledger State

As an operator,
I want fallback to TypeScript blocked after committed side effects,
So that retries cannot duplicate replies, memories, or follow-ups.

**Requirements covered:** FR14, FR25.

**Acceptance Criteria:**

**Given** a MAF attempt fails before candidate receipt or action execution
**When** the router checks the ledger
**Then** fallback to TypeScript is allowed.

**Given** the ledger is at `actions_committed` or `reply_committed`
**When** the MAF path fails or times out
**Then** fallback to TypeScript is forbidden
**And** the job fails or resumes according to idempotent retry policy.

### Story 2.6: Define Runtime Retry Budget And Error Mapping

As an engineer,
I want runtime errors and retries to share one attempt budget,
So that BullMQ, HTTP, Python workflow, model calls, and tool calls do not multiply work for one Slack event.

**Requirements covered:** FR25.

**Acceptance Criteria:**

**Given** a runtime HTTP call fails
**When** TypeScript classifies the error
**Then** the classification includes error code, HTTP status, retryable, fallback allowed, side-effect barrier status, and diagnostic fields.

**Given** Python retries model or tool calls
**When** it returns diagnostics
**Then** retry count and runtime attempt number are included
**And** TypeScript records them in shadow diagnostics or attempt ledger.

## Epic 3: Baseline And Shadow Comparison

Product and engineering can compare the current runtime against MAF candidates on real and simulated turns without changing user-facing Slack behavior.

### Story 3.1: Expand Migration Baseline Scenarios

As a product reviewer,
I want sensitive and ordinary migration scenarios added to the baseline,
So that MAF can be judged against current behavior before rollout.

**Requirements covered:** FR17, FR18, FR27, FR28, FR29.

**Acceptance Criteria:**

**Given** the migration baseline is run
**When** scenario coverage is inspected
**Then** it includes burnout/severe stress, crisis/self-harm, harassment, manager/privacy request, unwanted proactivity, reminder, delayed follow-up, assessment preparation, goal create/update, memory extraction, incorrect memory correction, casual conversation, and terse acknowledgement.

**Given** sensitive scenarios are evaluated
**When** results are reviewed
**Then** manual review sampling is required
**And** LLM-as-judge alone cannot pass the gate.

### Story 3.2: Add Shadow Diagnostics Record

As an operator,
I want one canonical shadow diagnostics record,
So that current and candidate runtimes can be compared consistently.

**Requirements covered:** FR16, FR30.

**Acceptance Criteria:**

**Given** a shadow run completes
**When** diagnostics are persisted
**Then** the record includes runtime mode, current result, candidate result, validation status, risk comparison, memory/action comparison, latency, model-call count, tool-call count, retry count, estimated cost, trace ID, redaction status, and runtime version.

**Given** candidate output contains message text or sensitive evidence
**When** diagnostics are stored
**Then** the configured redaction policy is applied before persistence.

### Story 3.3: Run MAF Candidate In Shadow Mode

As an operator,
I want MAF to run in shadow mode while TypeScript remains user-facing,
So that production-like comparisons can be collected without user exposure.

**Requirements covered:** FR15, FR16.

**Acceptance Criteria:**

**Given** runtime mode resolves to `maf_shadow`
**When** a conversation job is processed
**Then** TypeScript runtime sends the Slack-visible reply
**And** MAF candidate runs asynchronously or non-blockingly for diagnostics.

**Given** MAF candidate execution fails in shadow mode
**When** TypeScript user-facing execution succeeds
**Then** the user still receives the TypeScript reply
**And** the candidate failure is recorded without triggering duplicate side effects.

### Story 3.4: Report Shadow Comparison Readiness

As a product reviewer,
I want a summarized shadow comparison report,
So that the team can decide when MAF is ready for canary.

**Requirements covered:** FR16, FR17, FR18.

**Acceptance Criteria:**

**Given** shadow diagnostics exist for baseline scenarios
**When** the report is generated
**Then** it summarizes quality, risk parity, memory/action differences, latency, model-call count, tool-call count, estimated cost, and validation failures.

**Given** critical risk false negatives or duplicate action proposals are detected
**When** the report is evaluated
**Then** canary readiness is blocked.

## Epic 4: Deployable Python Agent Service Foundation

The platform can run a secure, deployable Python/FastAPI MAF service with scoped internal tool access, durable session/checkpoint storage, and production-ready health/readiness surfaces.

### Story 4.1: Scaffold `agent-service`

As an engineer,
I want a Python/FastAPI service scaffold in the monorepo,
So that MAF runtime work has a deployable home.

**Requirements covered:** FR21, FR22.

**Acceptance Criteria:**

**Given** `agent-service/` is added
**When** local checks run
**Then** it uses Python 3.13.x, FastAPI, Pydantic, pytest, ruff, pyright or mypy, and OpenTelemetry-ready settings.

**Given** the service starts locally
**When** `/health/live` is called
**Then** it returns healthy without requiring model, Redis, or Postgres dependencies.

### Story 4.2: Add Runtime Endpoint Skeleton

As an engineer,
I want `POST /runtime/process-message` to validate the runtime contract,
So that TypeScript can integrate before full MAF orchestration exists.

**Requirements covered:** FR7, FR8.

**Acceptance Criteria:**

**Given** a valid `ProcessMessageRequest`
**When** it is posted to `/runtime/process-message`
**Then** the service validates the request and returns a contract-valid stub or not-implemented result.

**Given** an invalid request
**When** it is posted to the endpoint
**Then** the service returns the canonical validation error shape
**And** marks fallback eligibility according to the error mapping.

### Story 4.3: Add Scoped Internal Service Auth

As a security reviewer,
I want Python-to-TypeScript calls to use scoped service authentication,
So that MAF tools cannot reuse admin credentials or trust caller-supplied tenant IDs.

**Requirements covered:** FR19, FR20.

**Acceptance Criteria:**

**Given** Python calls a TypeScript internal read endpoint
**When** TypeScript receives the request
**Then** it validates a service credential with tenant/workspace claims
**And** rejects requests outside the endpoint allowlist.

**Given** a tool call is authorized or rejected
**When** audit fields are recorded
**Then** trace ID, service identity, tenant/workspace scope, endpoint, and decision are captured without raw message text.

### Story 4.4: Add Durable Session And Checkpoint Store

As an operator,
I want non-local MAF session/checkpoint state to be durable,
So that shadow execution can survive restarts and avoid stale process-local state.

**Requirements covered:** FR23, FR24.

**Acceptance Criteria:**

**Given** non-local shadow mode is enabled
**When** MAF needs session or checkpoint state
**Then** it uses the selected durable backend
**And** process-local storage is rejected by configuration validation.

**Given** a session key is created
**When** it is inspected
**Then** it includes workspace, user, external conversation, and thread-or-DM scope.

### Story 4.5: Define Deployable Service Envelope

As an operator,
I want `agent-service` deployment metadata defined,
So that worker integration cannot merge before the Python service can run in the fleet.

**Requirements covered:** FR22.

**Acceptance Criteria:**

**Given** non-local shadow mode is planned
**When** deployment configuration is inspected
**Then** the service defines Docker build strategy, start command, health endpoint, readiness endpoint, internal URL, env vars, secret ownership, and service registration.

**Given** `/health/ready` is called
**When** required dependencies are unavailable
**Then** readiness fails while liveness can still pass.

## Epic 5: MAF Conversation Workflow Candidate

The MAF runtime can process one inbound conversation turn behind the HTTP client and return structured reply, risk, memory, action, and diagnostics output while TypeScript still owns side effects.

### Story 5.1: Add Disabled `MafAgentRuntimeClient`

As an engineer,
I want a disabled MAF HTTP client implementation,
So that the router can reference the future runtime without enabling behavior.

**Requirements covered:** FR3, FR4, FR6.

**Acceptance Criteria:**

**Given** MAF runtime mode is not enabled
**When** the worker starts
**Then** `MafAgentRuntimeClient` construction does not require `AGENT_SERVICE_URL`.

**Given** MAF runtime mode is enabled without required configuration
**When** the router evaluates the job
**Then** it fails closed to TypeScript
**And** records a configuration diagnostic.

### Story 5.2: Implement MAF Workflow Skeleton

As an engineer,
I want a MAF workflow skeleton for one inbound turn,
So that agent orchestration can be developed behind the runtime contract.

**Requirements covered:** FR7, FR8, FR11.

**Acceptance Criteria:**

**Given** a valid runtime request reaches Python
**When** the workflow runs
**Then** it executes load context, classify intent, risk detection, memory extraction, deterministic policy application, response generation, follow-up planning, action validation, and result preparation steps.

**Given** a workflow step fails
**When** the service returns an error
**Then** the error uses the canonical error shape with retryability and fallback eligibility.

### Story 5.3: Implement Read-Only Context Tools

As an engineer,
I want MAF to read existing TypeScript context through scoped tools,
So that the Python workflow uses current product state without owning persistence.

**Requirements covered:** FR19, FR20, FR26.

**Acceptance Criteria:**

**Given** the workflow needs user profile, memory, goals, recent conversation summary, survey state, or risk context
**When** it calls a tool
**Then** the tool uses scoped service auth and returns tenant-filtered data.

**Given** a read tool fails authorization or validation
**When** the workflow handles the failure
**Then** it returns a safe runtime error
**And** no side effect is attempted.

### Story 5.4: Return Structured MAF Candidate Results

As a product reviewer,
I want MAF candidate output to include structured reply, risk, memory, actions, and diagnostics,
So that shadow comparison can evaluate behavior before canary.

**Requirements covered:** FR8, FR11, FR27.

**Acceptance Criteria:**

**Given** the MAF workflow completes
**When** the Python service returns a result
**Then** the result validates against `ProcessMessageResult`
**And** proposed memory, goal, and follow-up changes remain proposals only.

**Given** deterministic policy blocks a survey or proactive action
**When** MAF proposes output
**Then** the blocked action is omitted or marked rejected
**And** diagnostics identify the policy decision.

### Story 5.5: Integrate MAF Candidate Into Shadow Mode

As an operator,
I want the MAF candidate workflow connected to shadow diagnostics,
So that real comparison data is collected through the same path the worker will use later.

**Requirements covered:** FR3, FR15, FR16, FR30.

**Acceptance Criteria:**

**Given** `maf_shadow` mode is enabled for a job
**When** the worker processes the job
**Then** it invokes `MafAgentRuntimeClient` for candidate output
**And** records the candidate in the TypeScript-owned shadow diagnostics record.

**Given** the candidate result fails validation
**When** diagnostics are recorded
**Then** the validation failure blocks canary readiness
**And** the user-facing TypeScript reply is unaffected.

## Epic 6: Canary Readiness And Rollout Gates

The team can decide whether MAF is safe to expose to users using regression gates, safety/privacy/consent preservation checks, and staged rollout controls.

### Story 6.1: Add Canary Gate Evaluation

As a release owner,
I want canary readiness computed from baseline and shadow results,
So that MAF cannot be exposed before safety and quality thresholds pass.

**Requirements covered:** FR17, FR18, FR27, FR28, FR29.

**Acceptance Criteria:**

**Given** baseline and shadow diagnostics exist
**When** canary readiness is evaluated
**Then** the gate checks critical risk false negatives, duplicate scheduled actions, sensitive memory false positives, validation failures, latency, and cost.

**Given** any blocking metric fails
**When** the gate result is produced
**Then** canary mode remains disabled.

### Story 6.2: Add Staged Rollout Controls

As an operator,
I want staged rollout controls for internal users, workspace, and percentage cohorts,
So that MAF exposure can increase gradually and rollback immediately.

**Requirements covered:** FR5, FR6, FR17.

**Acceptance Criteria:**

**Given** canary readiness is passed
**When** runtime flags are configured
**Then** canary can target internal users, one workspace, or a stable percentage bucket.

**Given** the global kill switch is enabled during canary
**When** a job is routed
**Then** it uses TypeScript-only processing regardless of canary settings.

### Story 6.3: Preserve Safety, Privacy, And Consent In Canary

As a safety and privacy reviewer,
I want canary rollout to prove existing safety, privacy, and consent behavior is preserved,
So that MAF does not weaken product guarantees.

**Requirements covered:** FR27, FR28, FR29.

**Acceptance Criteria:**

**Given** canary scenarios include risk, survey, proactive messaging, manager analytics, and GDPR-sensitive cases
**When** MAF behavior is compared to TypeScript baseline
**Then** risk suppression, escalation triggers, manager privacy, cohort minimums, user consent, and deletion/export ownership remain intact.

**Given** a privacy or consent regression is detected
**When** the gate is evaluated
**Then** rollout is blocked
**And** the finding is recorded with traceable evidence that excludes raw sensitive text when possible.

### Story 6.4: Document Rollback And Ownership Transfer Rules

As an operator,
I want rollback and ownership-transfer rules documented with the implementation,
So that future migration steps do not accidentally introduce dual writers.

**Requirements covered:** FR11, FR14, FR17, FR26.

**Acceptance Criteria:**

**Given** MAF canary is ready
**When** the runbook is reviewed
**Then** it documents kill switch use, runtime mode precedence, fallback barrier behavior, shadow/canary gate interpretation, and emergency rollback.

**Given** a future story proposes moving aggregate ownership to Python
**When** the architecture rules are applied
**Then** it requires an explicit ownership-transfer AD before Python writes that aggregate.
