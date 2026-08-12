from __future__ import annotations

from urllib.parse import urlparse

from collections.abc import Mapping
import logging
from typing import Any, NoReturn, Protocol, cast

import httpx

from agent_service.infrastructure.internal_auth import (
    TRACE_ID_PATTERN,
    InternalServiceAuthConfigurationError,
    create_internal_service_token,
)
from agent_service.infrastructure.settings import Settings
from agent_service.workflows.conversation_workflow import (
    ConversationWorkflowError,
    RuntimeErrorCategory,
)

INTERNAL_MAF_CONTEXT_READ_ENDPOINT = "/internal/maf/context/read"
SAFE_CONFIG_ERROR_MESSAGE = "MAF context tool configuration failed safely."
SAFE_AUTH_ERROR_MESSAGE = "MAF context tool authorization failed safely."
SAFE_VALIDATION_ERROR_MESSAGE = "MAF context tool validation failed safely."
SAFE_TIMEOUT_ERROR_MESSAGE = "MAF context tool timed out safely."
SAFE_NETWORK_ERROR_MESSAGE = "MAF context tool is unavailable."
SAFE_MALFORMED_ERROR_MESSAGE = "MAF context tool returned an unsafe response."
_LOGGER = logging.getLogger(__name__)


class AsyncContextHttpClient(Protocol):
    async def post(
        self,
        url: str,
        *,
        json: dict[str, Any],
        headers: dict[str, str],
        timeout: float,
    ) -> Any: ...


class ReadOnlyContextTool:
    def __init__(
        self,
        *,
        settings: Settings,
        client: AsyncContextHttpClient | None = None,
    ) -> None:
        self._settings = settings
        self._client = client

    async def read_context(self, request: dict[str, Any]) -> dict[str, Any]:
        base_url = safe_required_string(self._settings.internal_api_url)
        if base_url is None or not is_http_url(base_url):
            _LOGGER.warning("Context tool blocked by missing or invalid AGENT_SERVICE_INTERNAL_API_URL", extra={
                "trace_id": safe_trace_id(request.get("traceId")),
            })
            raise_workflow_error(
                "dependency_failed",
                retryable=False,
                message=SAFE_CONFIG_ERROR_MESSAGE,
            )

        body = build_context_request_body(request)
        trace_id = safe_trace_id(request.get("traceId"))
        try:
            token = create_internal_service_token(
                secret=self._settings.internal_service_auth_secret,
                service_identity=self._settings.internal_service_identity,
                tenant_id=body["tenantId"],
                workspace_id=body["workspaceId"],
                permissions=("read",),
                endpoint_allowlist=resolve_context_endpoint_allowlist(base_url),
                trace_id=trace_id,
            )
        except InternalServiceAuthConfigurationError as exc:
            raise_workflow_error(
                "dependency_failed",
                retryable=False,
                message=SAFE_CONFIG_ERROR_MESSAGE,
                original_error=exc,
            )

        headers = {
            "authorization": f"Bearer {token}",
            **({"x-trace-id": trace_id} if trace_id else {}),
        }
        url = f"{base_url.rstrip('/')}{INTERNAL_MAF_CONTEXT_READ_ENDPOINT}"
        timeout_seconds = self._settings.context_tool_timeout_ms / 1000

        try:
            response = await self._post(url, body, headers, timeout_seconds)
        except httpx.TimeoutException as exc:
            _LOGGER.warning(
                f"Context tool request timed out (url={url}, timeout_ms={timeout_seconds})",
                extra={
                    "trace_id": trace_id,
                    "url": url,
                    "error": exc.__class__.__name__,
                },
            )
            raise_workflow_error(
                "timeout",
                retryable=True,
                message=SAFE_TIMEOUT_ERROR_MESSAGE,
                original_error=exc,
            )
        except httpx.RequestError as exc:
            _LOGGER.warning(
                f"Context tool request failed (url={url}, error={exc.__class__.__name__})",
                extra={
                    "trace_id": trace_id,
                    "url": url,
                    "error": exc.__class__.__name__,
                },
            )
            raise_workflow_error(
                "unavailable",
                retryable=True,
                message=SAFE_NETWORK_ERROR_MESSAGE,
                original_error=exc,
            )

        status_code = getattr(response, "status_code", None)
        if status_code == 400:
            preview = safe_preview_response(response)
            _LOGGER.warning(
                f"Context tool returned 400 (status={status_code}, url={url}, body={preview})",
                extra={
                    "trace_id": trace_id,
                    "status": status_code,
                    "body": preview,
                },
            )
            raise_workflow_error(
                "validation_error",
                retryable=False,
                message=SAFE_VALIDATION_ERROR_MESSAGE,
            )
        if status_code in {401, 403}:
            _LOGGER.warning(
                f"Context tool authorization failed (status={status_code}, url={url})",
                extra={"trace_id": trace_id, "status": status_code},
            )
            raise_workflow_error(
                "dependency_failed",
                retryable=False,
                message=SAFE_AUTH_ERROR_MESSAGE,
            )
        if status_code != 200:
            preview = safe_preview_response(response)
            _LOGGER.warning(
                f"Context tool returned non-200 (status={status_code}, url={url}, body={preview})",
                extra={
                    "trace_id": trace_id,
                    "status": status_code,
                    "url": url,
                    "body": preview,
                },
            )
            raise_workflow_error(
                "dependency_failed",
                retryable=True,
                message=SAFE_NETWORK_ERROR_MESSAGE,
            )

        try:
            payload = response.json()
        except ValueError as exc:
            _LOGGER.warning(
                "Context tool response is not valid JSON",
                extra={"trace_id": trace_id, "status": status_code},
            )
            raise_workflow_error(
                "unsafe_partial_result",
                retryable=False,
                message=SAFE_MALFORMED_ERROR_MESSAGE,
                original_error=exc,
            )
        if not is_context_response(payload):
            _LOGGER.warning(
                "Context tool returned malformed payload",
                extra={"trace_id": trace_id, "status": status_code},
            )
            raise_workflow_error(
                "unsafe_partial_result",
                retryable=False,
                message=SAFE_MALFORMED_ERROR_MESSAGE,
            )

        return cast(dict[str, Any], payload)

    async def _post(
        self,
        url: str,
        body: dict[str, Any],
        headers: dict[str, str],
        timeout_seconds: float,
    ) -> Any:
        if self._client is not None:
            return await self._client.post(
                url,
                json=body,
                headers=headers,
                timeout=timeout_seconds,
            )

        async with httpx.AsyncClient() as client:
            return await client.post(
                url,
                json=body,
                headers=headers,
                timeout=timeout_seconds,
            )


def safe_preview_response(response: Any) -> str | None:
    body = getattr(response, "text", None)
    if isinstance(body, str):
        return body[:512]

    raw_content = getattr(response, "content", None)
    if isinstance(raw_content, (bytes, bytearray)):
        return raw_content[:512].decode("utf-8", errors="replace")

    if isinstance(raw_content, str):
        return raw_content[:512]

    return None


def build_context_request_body(request: Mapping[str, Any]) -> dict[str, Any]:
    tenant = request.get("tenant")
    user = request.get("user")
    conversation = request.get("conversation")
    if (
        not isinstance(tenant, Mapping)
        or not isinstance(user, Mapping)
        or not isinstance(conversation, Mapping)
    ):
        raise_workflow_error(
            "validation_error",
            retryable=False,
            message=SAFE_VALIDATION_ERROR_MESSAGE,
        )

    tenant_id = safe_required_string(tenant.get("id"))
    workspace_id = safe_required_string(tenant.get("workspaceId"))
    user_id = safe_required_string(user.get("id"))
    conversation_id = safe_required_string(conversation.get("id"))
    if not tenant_id or not workspace_id or not user_id or not conversation_id:
        raise_workflow_error(
            "validation_error",
            retryable=False,
            message=SAFE_VALIDATION_ERROR_MESSAGE,
        )

    body = {
        "tenantId": tenant_id,
        "workspaceId": workspace_id,
        "userId": user_id,
        "conversationId": conversation_id,
    }

    thread_id = safe_required_string(conversation.get("threadId"))
    if thread_id:
        body["threadId"] = thread_id

    body["recentTurnLimit"] = 10
    body["memoryLimit"] = 10
    body["goalLimit"] = 10
    body["riskLimit"] = 10
    session_key = safe_required_string(conversation.get("sessionKey"))
    if session_key:
        body["sessionKey"] = session_key

    return body


def is_context_response(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    expected_keys = {
        "userProfile",
        "memoryItems",
        "goals",
        "recentTurns",
        "surveyState",
        "riskSignals",
        "diagnostics",
    }
    if set(payload.keys()) != expected_keys:
        return False
    if not (payload["userProfile"] is None or isinstance(payload["userProfile"], dict)):
        return False
    if not (payload["surveyState"] is None or isinstance(payload["surveyState"], dict)):
        return False
    if not isinstance(payload["diagnostics"], dict):
        return False
    for key in ("memoryItems", "goals", "recentTurns", "riskSignals"):
        if not is_bounded_object_array(payload[key]):
            return False
    return recent_turn_previews_are_safe(payload["recentTurns"])


def is_bounded_object_array(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) <= 50
        and all(isinstance(item, dict) for item in value)
    )


def recent_turn_previews_are_safe(value: Any) -> bool:
    if not isinstance(value, list):
        return False
    for item in value:
        preview = item.get("textPreview")
        if preview is not None and (not isinstance(preview, str) or len(preview) > 160):
            return False
    return True


def safe_required_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def safe_trace_id(value: Any) -> str | None:
    if isinstance(value, str) and TRACE_ID_PATTERN.fullmatch(value):
        return value
    return None


def resolve_context_endpoint_allowlist(base_url: str | None) -> tuple[str, ...]:
    endpoints = {INTERNAL_MAF_CONTEXT_READ_ENDPOINT}
    parsed = urlparse(base_url or "")
    base_path = parsed.path.rstrip("/")
    if base_path and base_path != "/":
        endpoints.add(f"{base_path}{INTERNAL_MAF_CONTEXT_READ_ENDPOINT}")
        endpoints.add(f"{base_path}{INTERNAL_MAF_CONTEXT_READ_ENDPOINT}/")

    endpoints.add(f"{INTERNAL_MAF_CONTEXT_READ_ENDPOINT}/")

    return tuple(sorted(endpoints))


def is_http_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def raise_workflow_error(
    error_category: RuntimeErrorCategory,
    *,
    retryable: bool,
    message: str,
    original_error: Exception | None = None,
) -> NoReturn:
    error = ConversationWorkflowError(
        error_category=error_category,
        retryable=retryable,
        fallback_allowed=True,
        message=message,
    )
    if original_error is None:
        raise error
    raise error from original_error
