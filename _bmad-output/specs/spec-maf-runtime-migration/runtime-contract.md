# Runtime Contract

## Current Shim

The first code boundary introduced in this branch keeps the existing `OrchestrateInput` shape and exposes it as `ProcessMessageRequest`. That is intentional: it creates the insertion point without changing message loading, context assembly, side effects, or worker behavior.

The richer contract below is the target HTTP contract for `MafAgentRuntimeClient` and the Python service.

## Canonical Schema Source

The canonical schema source for the runtime HTTP contract is neutral OpenAPI 3.1 in `packages/contracts/runtime/openapi.json`.

TypeScript Zod and Python Pydantic models may be generated from, checked against, or manually aligned to this OpenAPI artifact, but they are not the source of truth. The shared fixture manifest in `packages/contracts/runtime/fixtures/manifest.json` defines the cross-language contract acceptance baseline:

- valid fixtures must pass TypeScript and Python validation;
- invalid fixtures must fail in both validators with equivalent stable error categories;
- fixture data must stay synthetic and must not include real Slack IDs, user text, workspace IDs, or production event IDs.

This resolves AD-14 for the first MAF runtime contract slice without introducing `MafAgentRuntimeClient`, `agent-service`, FastAPI routes, or MAF workflow code.

## TypeScript Boundary

```ts
export interface AgentRuntimePort {
  processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult>;
}
```

This boundary must not mention MAF, FastAPI, OpenAI, LangChain, or Python-specific types.

## ProcessMessageRequest

```ts
export type ProcessMessageRequest = {
  requestId: string;
  eventId: string;
  traceId: string;
  idempotencyKey: string;
  runtimeAttempt: number;

  tenant: {
    id: string;
    workspaceId: string;
  };

  user: {
    id: string;
    displayName?: string;
    timezone?: string;
    locale?: string;
  };

  conversation: {
    id: string;
    channel: "slack";
    externalWorkspaceId: string;
    externalConversationId: string;
    threadId?: string;
    sessionKey: string;
  };

  message: {
    id: string;
    text: string;
    createdAt: string;
  };

  context: {
    recentTurns: Array<{
      role: "user" | "assistant";
      content: string;
      timestamp: string;
    }>;
    memoryItems: Array<{
      id: string;
      category: string;
      content: string;
      importance: number;
    }>;
    goals: Array<{
      id: string;
      title: string;
      status: string;
    }>;
  };
};
```

## ProcessMessageResult

```ts
export type ProcessMessageResult = {
  reply: {
    text: string;
    mode?: string;
  };

  riskAssessment?: {
    type: string | null;
    severity: "none" | "low" | "medium" | "high" | "critical";
    confidence: number;
    evidence: string[];
    immediateResponseRequired: boolean;
    escalationRecommended: boolean;
    surveyMustBeBlocked: boolean;
    proactiveMessagesMustBePaused: boolean;
  };

  memoryCandidates: Array<{
    actionId: string;
    type: string;
    content: string;
    confidence: number;
    sensitivity?: "normal" | "sensitive" | "highly_sensitive";
    sourceMessageIds: string[];
  }>;

  proposedActions: Array<
    | {
        actionId: string;
        aggregateType: "memory";
        actionType: "save_memory";
        idempotencyKey: string;
        payload: {
          memoryCandidateId: string;
        };
        validationResult: ActionValidationResult;
        executionStatus: ActionExecutionStatus;
        commitMarker: ActionCommitMarker;
      }
    | {
        actionId: string;
        aggregateType: "follow_up";
        actionType: "schedule_follow_up";
        idempotencyKey: string;
        payload: {
          executeAt: string;
          intent: string;
          deduplicationKey: string;
        };
        validationResult: ActionValidationResult;
        executionStatus: ActionExecutionStatus;
        commitMarker: ActionCommitMarker;
      }
    | {
        actionId: string;
        aggregateType: "goal";
        actionType: "update_goal";
        idempotencyKey: string;
        payload: {
          goalId?: string;
          changes: Record<string, RuntimeJsonValue>;
        };
        validationResult: ActionValidationResult;
        executionStatus: ActionExecutionStatus;
        commitMarker: ActionCommitMarker;
      }
  >;

  diagnostics: {
    traceId: string;
    runtimeVersion: string;
    modelCalls: number;
    toolCalls: number;
    latencyMs: number;
  };
};

type ActionValidationResult = {
  status: "pending" | "valid" | "invalid";
  reasonCodes: string[];
  message?: string;
};

type ActionExecutionStatus =
  | "not_started"
  | "blocked"
  | "committed"
  | "failed";

type ActionCommitMarker = {
  committedAt: string;
  referenceId: string;
} | null;

type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };
```

## Runtime Error Response

```ts
export type RuntimeErrorResponse = {
  traceId: string;
  errorCategory:
    | "unavailable"
    | "validation_error"
    | "timeout"
    | "duplicate_request"
    | "dependency_failed"
    | "unsafe_partial_result";
  retryable: boolean;
  fallbackAllowed: boolean;
  message: string;
};
```

## Side-Effect Rule

The Python service returns proposals. TypeScript validates and executes them through existing domain policies and repositories. The action envelope can represent validation-failed or blocked actions with `commitMarker: null`; ledger persistence and actual action execution are separate later slices. `executionStatus: "committed"` requires `validationResult.status: "valid"` and a non-null `commitMarker`; uncommitted statuses require `commitMarker: null`.

```text
MAF proposes -> TypeScript validates -> TypeScript writes -> queues emit side effects
```

Fallback from MAF to TypeScript is allowed only if no proposed action has been executed.

## Session Key

```text
{workspace_id}:{user_id}:{external_conversation_id}:{thread_id_or_dm}
```

Do not use `user_id` alone. Parallel Slack threads must not share session state.
