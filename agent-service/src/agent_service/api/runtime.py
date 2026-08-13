import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from agent_service.contracts.runtime_contract import (
    validate_runtime_error_response,
    validate_runtime_process_message_request,
    validate_runtime_result,
)
from agent_service.infrastructure.settings import Settings, get_settings
from agent_service.tools.context_tool import ReadOnlyContextTool
from agent_service.workflows.conversation_workflow import (
    ConversationWorkflow,
    ConversationWorkflowError,
    RuntimeErrorCategory,
)
from agent_service.workflows.llm_safety_gateway import (
    AzurePromptShieldsClient,
    LlmSafetyGateway,
)
from agent_service.workflows.model_provider import (
    AgentFrameworkConversationModelClient,
    ConversationModelClient,
    OpenAICompatibleChatClient,
)

router = APIRouter(prefix="/runtime", tags=["runtime"])

VALIDATION_ERROR_MESSAGE = "Runtime request failed contract validation."
SAFE_TRACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_LOGGER = logging.getLogger(__name__)


@router.post("/process-message")
async def process_message(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except ValueError:
        _LOGGER.warning("runtime_process_message_invalid_json")
        return runtime_validation_error_response("unknown-trace")

    validation = validate_runtime_process_message_request(payload)
    if not validation["ok"]:
        _LOGGER.warning(
            "runtime_process_message_validation_failed",
            extra={"trace_id": extract_trace_id(payload)},
        )
        return runtime_validation_error_response(extract_trace_id(payload))

    try:
        result = await build_runtime_workflow(payload).run_async(payload)
    except ConversationWorkflowError as error:
        _LOGGER.warning(
            "runtime_workflow_error",
            extra={
                "trace_id": extract_trace_id(payload),
                "category": error.error_category,
                "retryable": error.retryable,
                "fallback_allowed": error.fallback_allowed,
                "safe_message": error.safe_message,
            },
        )
        return runtime_workflow_error_response(payload, error)
    except Exception:
        _LOGGER.exception(
            "runtime_workflow_unexpected_error",
            extra={"trace_id": extract_trace_id(payload)},
        )
        return runtime_error_response(
            trace_id=extract_trace_id(payload),
            error_category="dependency_failed",
            status_code=500,
        )

    validation = validate_runtime_result(result)
    if not validation["ok"]:
        _LOGGER.warning(
            "runtime_process_message_result_validation_failed",
            extra={
                "trace_id": extract_trace_id(payload),
                "reason": validation["path"],
            },
        )
        return runtime_error_response(
            trace_id=extract_trace_id(payload),
            error_category="unsafe_partial_result",
        )

    return JSONResponse(content=result)


def build_runtime_workflow(payload: dict[str, Any] | None = None) -> ConversationWorkflow:
    settings = get_settings()
    model_client = build_model_client(settings)
    if settings.internal_api_url and _payload_supports_internal_context_tool(payload):
        context_tool = ReadOnlyContextTool(settings=settings)
        if model_client is not None:
            return _instantiate_workflow(context_tool=context_tool, model_client=model_client)
        return _instantiate_workflow(context_tool=context_tool)
    if model_client is not None:
        return _instantiate_workflow(model_client=model_client)
    return _instantiate_workflow()


def _payload_supports_internal_context_tool(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    tenant = payload.get("tenant")
    if not isinstance(tenant, dict):
        return False
    tenant_id = tenant.get("id")
    if not isinstance(tenant_id, str):
        return False
    try:
        uuid.UUID(tenant_id)
    except ValueError:
        return False
    workspace_id = tenant.get("workspaceId")
    return isinstance(workspace_id, str) and bool(workspace_id.strip())


def _instantiate_workflow(
    *,
    context_tool: ReadOnlyContextTool | None = None,
    model_client: ConversationModelClient | None = None,
) -> ConversationWorkflow:
    attempts: list[dict[str, object]] = []
    if context_tool is not None and model_client is not None:
        attempts.append({"context_tool": context_tool, "model_client": model_client})
    if model_client is not None:
        attempts.append({"model_client": model_client})
    if context_tool is not None:
        attempts.append({"context_tool": context_tool})
    attempts.append({})

    last_error: TypeError | None = None
    for candidate in attempts:
        try:
            return ConversationWorkflow(**candidate)  # type: ignore[misc]
        except TypeError as error:
            last_error = error

    if last_error is not None:
        raise last_error
    return ConversationWorkflow()


def build_model_client(settings: Settings) -> ConversationModelClient | None:
    if settings.model_provider == "disabled":
        return None
    safety_gateway = build_llm_safety_gateway(settings)
    if settings.model_provider == "openai":
        model_name = normalized_optional_string(settings.model_name)
        api_key = normalized_optional_string(settings.openai_api_key)
        if not api_key or not model_name:
            raise ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=False,
                fallback_allowed=True,
                message="MAF model provider configuration failed safely.",
            )
        return AgentFrameworkConversationModelClient(
            chat_client=OpenAICompatibleChatClient(
                provider="openai",
                model_name=model_name,
                api_key=api_key,
                timeout_ms=settings.model_timeout_ms,
                organization_id=normalized_optional_string(settings.openai_org_id),
            ),
            model_name=model_name,
            timeout_ms=settings.model_timeout_ms,
            safety_gateway=safety_gateway,
        )
    model_name = normalized_optional_string(settings.model_name)
    endpoint = normalized_optional_string(settings.azure_openai_endpoint)
    api_key = normalized_optional_string(settings.azure_openai_api_key)
    api_version = normalized_optional_string(settings.azure_openai_api_version)
    if (
        not endpoint
        or not api_key
        or not api_version
        or not model_name
    ):
        raise ConversationWorkflowError(
            error_category="dependency_failed",
            retryable=False,
            fallback_allowed=True,
            message="MAF model provider configuration failed safely.",
        )
    return AgentFrameworkConversationModelClient(
        chat_client=OpenAICompatibleChatClient(
            provider="azure_openai",
            model_name=model_name,
            api_key=api_key,
            timeout_ms=settings.model_timeout_ms,
            endpoint=endpoint,
            api_version=api_version,
        ),
        model_name=model_name,
        timeout_ms=settings.model_timeout_ms,
        safety_gateway=safety_gateway,
    )


def build_llm_safety_gateway(settings: Settings) -> LlmSafetyGateway | None:
    if settings.llm_safety_mode == "disabled":
        return None
    azure_prompt_shields = None
    if settings.llm_safety_provider == "azure_prompt_shields":
        endpoint = normalized_optional_string(settings.azure_content_safety_endpoint)
        api_key = normalized_optional_string(settings.azure_content_safety_key)
        if endpoint and api_key:
            azure_prompt_shields = AzurePromptShieldsClient(
                endpoint=endpoint,
                api_key=api_key,
                api_version=settings.azure_content_safety_api_version,
                timeout_ms=settings.llm_safety_timeout_ms,
            )
        elif settings.llm_safety_mode == "block":
            raise ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=False,
                fallback_allowed=True,
                message="MAF LLM safety gateway configuration failed safely.",
            )
    return LlmSafetyGateway(
        mode=settings.llm_safety_mode,
        azure_prompt_shields=azure_prompt_shields,
    )


def normalized_optional_string(value: str | None) -> str | None:
    normalized = value.strip() if isinstance(value, str) else ""
    return normalized or None


def runtime_validation_error_response(trace_id: str) -> JSONResponse:
    return runtime_error_response(
        trace_id=trace_id,
        error_category="validation_error",
        retryable=False,
        fallback_allowed=False,
        message=VALIDATION_ERROR_MESSAGE,
        status_code=400,
    )


def runtime_workflow_error_response(
    payload: dict[str, Any],
    error: ConversationWorkflowError,
) -> JSONResponse:
    return runtime_error_response(
        trace_id=extract_trace_id(payload),
        error_category=error.error_category,
    )


def runtime_error_response(
    *,
    trace_id: str,
    error_category: RuntimeErrorCategory,
    retryable: bool | None = None,
    fallback_allowed: bool | None = None,
    message: str | None = None,
    status_code: int | None = None,
) -> JSONResponse:
    normalized = normalize_runtime_error_response(
        error_category=error_category,
        retryable=retryable,
        fallback_allowed=fallback_allowed,
        message=message,
        status_code=status_code,
    )
    body = {
        "traceId": safe_trace_id(trace_id),
        "errorCategory": normalized.error_category,
        "retryable": normalized.retryable,
        "fallbackAllowed": normalized.fallback_allowed,
        "message": normalized.message,
    }
    validation = validate_runtime_error_response(body)
    if not validation["ok"]:
        body = {
            "traceId": safe_trace_id(trace_id),
            "errorCategory": "unsafe_partial_result",
            "retryable": False,
            "fallbackAllowed": True,
            "message": "MAF core workflow produced an unsafe error response.",
        }

    return JSONResponse(status_code=normalized.status_code, content=body)


@dataclass(frozen=True)
class RuntimeErrorResponseTemplate:
    error_category: RuntimeErrorCategory
    status_code: int
    retryable: bool
    fallback_allowed: bool
    message: str


def normalize_runtime_error_response(
    *,
    error_category: RuntimeErrorCategory,
    retryable: bool | None,
    fallback_allowed: bool | None,
    message: str | None,
    status_code: int | None,
) -> RuntimeErrorResponseTemplate:
    template = RUNTIME_ERROR_RESPONSE_TEMPLATES[error_category]
    if (
        error_category == "validation_error"
        and retryable is False
        and fallback_allowed is False
        and message == VALIDATION_ERROR_MESSAGE
        and status_code == 400
    ):
        return RuntimeErrorResponseTemplate(
            error_category=error_category,
            status_code=400,
            retryable=False,
            fallback_allowed=False,
            message=VALIDATION_ERROR_MESSAGE,
        )

    return template


RUNTIME_ERROR_RESPONSE_TEMPLATES: dict[RuntimeErrorCategory, RuntimeErrorResponseTemplate] = {
    "unavailable": RuntimeErrorResponseTemplate(
        error_category="unavailable",
        status_code=503,
        retryable=True,
        fallback_allowed=True,
        message="MAF core workflow is unavailable.",
    ),
    "validation_error": RuntimeErrorResponseTemplate(
        error_category="validation_error",
        status_code=400,
        retryable=False,
        fallback_allowed=True,
        message="MAF core workflow validation failed safely.",
    ),
    "timeout": RuntimeErrorResponseTemplate(
        error_category="timeout",
        status_code=504,
        retryable=True,
        fallback_allowed=True,
        message="MAF core workflow timed out safely.",
    ),
    "duplicate_request": RuntimeErrorResponseTemplate(
        error_category="duplicate_request",
        status_code=409,
        retryable=False,
        fallback_allowed=False,
        message="MAF core workflow rejected a duplicate request.",
    ),
    "dependency_failed": RuntimeErrorResponseTemplate(
        error_category="dependency_failed",
        status_code=502,
        retryable=True,
        fallback_allowed=True,
        message="MAF core workflow dependency failed safely.",
    ),
    "unsafe_partial_result": RuntimeErrorResponseTemplate(
        error_category="unsafe_partial_result",
        status_code=500,
        retryable=False,
        fallback_allowed=True,
        message="MAF core workflow produced an unsafe result.",
    ),
}


def extract_trace_id(payload: Any) -> str:
    if not isinstance(payload, dict):
        return "unknown-trace"

    trace_id = payload.get("traceId")
    if isinstance(trace_id, str) and trace_id:
        return trace_id

    return "unknown-trace"


def safe_trace_id(trace_id: str) -> str:
    return trace_id if SAFE_TRACE_ID_PATTERN.fullmatch(trace_id) else "unknown-trace"
