---
title: 'LLM Safety Gateway for agent-service model path'
type: 'feature'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e377c5a7289780a4d909c08aa960b3c1c5711efa'
context:
  - `{project-root}/agent-service/README.md`
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The opt-in `agent-service` model-provider path sends assembled prompts to OpenAI/Azure OpenAI and normalizes model replies, but it has no explicit safety gateway between user/context/model/output beyond local unsafe-output checks. This matters because employee conversations include sensitive HR context, memory snippets, Slack text, survey evidence, and prompt-injection risks.

**Approach:** Add a bounded `LlmSafetyGateway` abstraction in `agent-service`, with deterministic local checks always available and Azure AI Content Safety Prompt Shields as the first optional managed provider. Wire it around the existing model call so input is inspected before `Agent.run(...)`, output is inspected after response normalization, and the default remains disabled or inspect-only unless explicitly configured to block.

## Boundaries & Constraints

**Always:** Keep the existing runtime request/result contract stable. Do not log raw prompts, raw user text, memory contents, provider request bodies, provider responses, API keys, or model replies. Default local behavior must not require Azure credentials. Gateway provider failures must fail open in `inspect_only` mode and fail safely through existing `ConversationModelProviderError` semantics in block mode. Gateway findings should be represented as redacted verdict metadata/reasons only.

**Ask First:** Adding a database table, changing TypeScript runtime contracts, adding a new external dependency, making Azure Content Safety mandatory for local/dev, or enabling blocking in production defaults.

**Never:** Do not route model calls through a new LLM provider, replace Microsoft Agent Framework usage, expose safety findings to end users, persist full flagged text, or implement broad content policy/product escalation workflows in this change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inspect-only safe input/output | Gateway enabled with `inspect_only`; local checks and Azure return no attack | Model call proceeds and reply returns normally | No user-visible change |
| Inspect-only detected injection | Azure Prompt Shields returns `attackDetected: true` for input | Model call still proceeds, but redacted gateway verdict is available for diagnostics/logging | Provider raw response is not logged |
| Block mode detected injection | Gateway mode is `block`; input inspection flags `prompt_injection` | Model call is skipped and runtime returns existing safe dependency/unsafe error path | Error body excludes raw prompt/user text |
| Azure unavailable in inspect-only | Azure HTTP call times out/fails | Model call proceeds with a redacted `provider_unavailable` verdict | No raw request/provider details in logs |
| Unsafe deterministic output | Model reply contains bearer token/system prompt leakage pattern | Existing unsafe-output failure remains fail-closed | Safe canonical runtime error |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- central model prompt assembly, provider call, response normalization, and existing unsafe-output exception path.
- `agent-service/src/agent_service/api/runtime.py` -- builds the configured model client from `Settings`; right place to construct/inject the safety gateway.
- `agent-service/src/agent_service/infrastructure/settings.py` -- Pydantic env configuration for model provider; extend with optional gateway/provider settings.
- `agent-service/tests/unit/test_model_provider.py` -- current model-provider safety tests; extend with gateway wrapping behavior.
- `agent-service/tests/unit/test_settings.py` -- settings validation coverage for new env fields.
- `agent-service/README.md` -- document opt-in gateway env vars and failure semantics.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/llm_safety_gateway.py` -- add gateway interfaces, deterministic local detector, Azure Prompt Shields client, composite mode/enforcement logic, and redacted verdict structures.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- inject optional gateway around prompt construction/model call/output normalization without changing `ConversationModelClient` protocol.
- [x] `agent-service/src/agent_service/api/runtime.py` -- build gateway from settings and pass it into `AgentFrameworkConversationModelClient`.
- [x] `agent-service/src/agent_service/infrastructure/settings.py` -- add optional `AGENT_SERVICE_LLM_SAFETY_*` and Azure Content Safety env settings with safe defaults.
- [x] `agent-service/tests/unit/test_llm_safety_gateway.py` and `agent-service/tests/unit/test_model_provider.py` -- cover local checks, Azure response mapping, inspect-only fail-open, block mode skip/fail, and output blocking.
- [x] `agent-service/tests/unit/test_settings.py` -- cover safe defaults and env aliases for Azure Content Safety config.
- [x] `agent-service/README.md` -- document gateway modes, Azure Prompt Shields endpoint/key/api-version, and redaction/failure behavior.

**Acceptance Criteria:**
- Given no new gateway env vars, when the model-provider path is used, then behavior remains compatible with the current model path and no Azure call is required.
- Given Azure Prompt Shields is configured in inspect-only mode, when it reports `attackDetected`, then the model call still runs and only redacted verdict metadata is retained/loggable.
- Given block mode and a detected prompt injection, when `generate_reply` runs, then the LLM provider is not called and the runtime returns a safe existing error category/body.
- Given Azure Prompt Shields fails in inspect-only mode, when `generate_reply` runs, then the model call proceeds and the outage is represented without raw request/provider data.
- Given local deterministic checks detect secret/system-prompt leakage in output, when the model reply is normalized, then the unsafe-output path remains fail-closed.

## Spec Change Log

## Design Notes

Use the Azure REST shape documented for Content Safety API version `2024-09-01`: `POST {endpoint}/contentsafety/text:shieldPrompt?api-version=2024-09-01`, body `{ "userPrompt": "...", "documents": [...] }`, response fields `userPromptAnalysis.attackDetected` and `documentsAnalysis[].attackDetected`. The gateway should treat memory/recent-turn context as `documents` only if readily available from the existing request; otherwise input inspection can focus on the assembled prompt to avoid introducing new context plumbing.

## Verification

**Commands:**
- `cd agent-service && pytest tests/unit/test_llm_safety_gateway.py tests/unit/test_model_provider.py tests/unit/test_settings.py` -- expected: all targeted unit tests pass.
- `cd agent-service && ruff check src tests` -- expected: no lint errors in touched Python files.

## Suggested Review Order

**Gateway Design**

- Start here for the safety verdict and redacted metadata contract.
  [`llm_safety_gateway.py:44`](../../agent-service/src/agent_service/workflows/llm_safety_gateway.py#L44)

- Azure Prompt Shields REST shape is isolated behind a small transport.
  [`llm_safety_gateway.py:95`](../../agent-service/src/agent_service/workflows/llm_safety_gateway.py#L95)

- Enforcement mode decides inspect-only versus block behavior.
  [`llm_safety_gateway.py:133`](../../agent-service/src/agent_service/workflows/llm_safety_gateway.py#L133)

- Azure malformed verdicts become safe provider findings in block mode.
  [`llm_safety_gateway.py:256`](../../agent-service/src/agent_service/workflows/llm_safety_gateway.py#L256)

**Model Path Integration**

- Input inspection runs before the MAF Agent provider call.
  [`model_provider.py:83`](../../agent-service/src/agent_service/workflows/model_provider.py#L83)

- Blocked verdicts are retained before safe exceptions are raised.
  [`model_provider.py:90`](../../agent-service/src/agent_service/workflows/model_provider.py#L90)

- Output inspection runs after existing normalization.
  [`model_provider.py:120`](../../agent-service/src/agent_service/workflows/model_provider.py#L120)

**Configuration**

- Runtime builder wires optional gateway into both OpenAI paths.
  [`runtime.py:153`](../../agent-service/src/agent_service/api/runtime.py#L153)

- Azure safety credentials are optional except explicit block mode.
  [`runtime.py:210`](../../agent-service/src/agent_service/api/runtime.py#L210)

- Environment defaults keep local/dev free of Azure requirements.
  [`settings.py:42`](../../agent-service/src/agent_service/infrastructure/settings.py#L42)

**Verification**

- Gateway unit tests cover inspect-only, block, and Azure malformed responses.
  [`test_llm_safety_gateway.py:47`](../../agent-service/tests/unit/test_llm_safety_gateway.py#L47)

- Model provider tests cover skip-call, per-call verdicts, and output blocking.
  [`test_model_provider.py:83`](../../agent-service/tests/unit/test_model_provider.py#L83)

- README documents rollout knobs and redaction semantics.
  [`README.md:203`](../../agent-service/README.md#L203)
