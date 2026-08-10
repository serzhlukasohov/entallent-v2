import asyncio
import base64
import json
from typing import Any, cast

import httpx
import pytest

from agent_service.infrastructure.settings import Settings
from agent_service.tools.context_tool import (
    INTERNAL_MAF_CONTEXT_READ_ENDPOINT,
    ReadOnlyContextTool,
)
from agent_service.workflows.conversation_workflow import ConversationWorkflowError

TENANT_ID = "00000000-0000-4000-8000-000000000000"
WORKSPACE_ID = "T01234567"
USER_ID = "33333333-3333-4333-8333-333333333333"
CONVERSATION_ID = "55555555-5555-4555-8555-555555555555"
SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef"


def test_context_tool_signs_scoped_read_token_and_sends_minimum_body(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_API_URL", raising=False)
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_URL", raising=False)

    client = FakeClient(
        FakeResponse(
            200,
            {
                "userProfile": None,
                "memoryItems": [],
                "goals": [],
                "recentTurns": [],
                "surveyState": None,
                "riskSignals": [],
                "diagnostics": {"counts": {}},
            },
        )
    )
    tool = ReadOnlyContextTool(settings=make_settings(), client=client)

    result = asyncio.run(tool.read_context(make_runtime_request()))

    assert result["memoryItems"] == []
    assert client.calls == [
        {
            "url": f"http://api.internal{INTERNAL_MAF_CONTEXT_READ_ENDPOINT}",
            "json": {
                "tenantId": TENANT_ID,
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "conversationId": CONVERSATION_ID,
                "sessionKey": "T01234567:user:conversation:thread",
                "recentTurnLimit": 10,
                "memoryLimit": 10,
                "goalLimit": 10,
                "riskLimit": 10,
            },
            "timeout": 2.5,
        }
    ]
    headers = client.headers[0]
    assert headers["x-trace-id"] == "trace-safe-1"
    token = headers["authorization"].removeprefix("Bearer ")
    claims = decode_claims(token)
    assert claims["tenantId"] == TENANT_ID
    assert claims["workspaceId"] == WORKSPACE_ID
    assert claims["permissions"] == ["read"]
    assert sorted(claims["endpointAllowlist"]) == [
        INTERNAL_MAF_CONTEXT_READ_ENDPOINT,
        f"{INTERNAL_MAF_CONTEXT_READ_ENDPOINT}/",
    ]
    assert "message" not in json.dumps(client.calls[0]["json"])
    assert "raw user text" not in json.dumps(client.calls[0]["json"])


def test_context_tool_forwards_thread_id_to_internal_context_read() -> None:
    client = FakeClient(
        FakeResponse(
            200,
            {
                "userProfile": None,
                "memoryItems": [],
                "goals": [],
                "recentTurns": [],
                "surveyState": None,
                "riskSignals": [],
                "diagnostics": {"counts": {}},
            },
        )
    )
    tool = ReadOnlyContextTool(settings=make_settings(), client=client)

    asyncio.run(tool.read_context(make_runtime_request(thread_id="1700000000.001")))

    assert client.calls[0]["json"]["threadId"] == "1700000000.001"


def test_context_tool_signs_context_endpoint_allowlist_with_api_prefix() -> None:
    client = FakeClient(
        FakeResponse(
            200,
            {
                "userProfile": None,
                "memoryItems": [],
                "goals": [],
                "recentTurns": [],
                "surveyState": None,
                "riskSignals": [],
                "diagnostics": {"counts": {}},
            },
        )
    )
    tool = ReadOnlyContextTool(
        settings=Settings(
            internal_api_url="http://api.internal/api/v1",
            internal_service_auth_secret=SECRET,
            context_tool_timeout_ms=2500,
        ),
        client=client,
    )

    asyncio.run(tool.read_context(make_runtime_request()))

    claims = decode_claims(client.headers[0]["authorization"].removeprefix("Bearer "))
    assert sorted(claims["endpointAllowlist"]) == [
        "/api/v1/internal/maf/context/read",
        "/api/v1/internal/maf/context/read/",
        "/internal/maf/context/read",
        "/internal/maf/context/read/",
    ]


@pytest.mark.parametrize(
    ("status_code", "payload", "category", "retryable"),
    [
        (400, {"error": "bad raw payload"}, "validation_error", False),
        (401, {"error": "Bearer secret-token"}, "dependency_failed", False),
        (403, {"error": "forbidden"}, "dependency_failed", False),
        (200, [], "unsafe_partial_result", False),
    ],
)
def test_context_tool_maps_http_and_malformed_failures_to_safe_workflow_errors(
    status_code: int,
    payload: Any,
    category: str,
    retryable: bool,
) -> None:
    tool = ReadOnlyContextTool(
        settings=make_settings(),
        client=FakeClient(FakeResponse(status_code, payload)),
    )

    with pytest.raises(ConversationWorkflowError) as error:
        asyncio.run(tool.read_context(make_runtime_request(raw_text="Bearer token raw user text")))

    assert error.value.error_category == category
    assert error.value.retryable is retryable
    assert error.value.fallback_allowed is True
    serialized = json.dumps(
        {
            "message": str(error.value),
            "safe_message": error.value.safe_message,
        }
    )
    assert "Bearer token" not in serialized
    assert "raw user text" not in serialized
    assert "bad raw payload" not in serialized


def test_context_tool_rejects_malformed_success_response_shapes() -> None:
    unsafe_payloads: list[Any] = [
        {
            "userProfile": None,
            "memoryItems": [],
            "goals": [],
            "recentTurns": [],
            "surveyState": None,
            "riskSignals": [],
            "diagnostics": {"counts": {}},
            "unexpected": "raw payload",
        },
        {
            "userProfile": None,
            "memoryItems": [{}] * 51,
            "goals": [],
            "recentTurns": [],
            "surveyState": None,
            "riskSignals": [],
            "diagnostics": {"counts": {}},
        },
        {
            "userProfile": None,
            "memoryItems": [],
            "goals": [],
            "recentTurns": [{"textPreview": "x" * 161}],
            "surveyState": None,
            "riskSignals": [],
            "diagnostics": {"counts": {}},
        },
    ]

    for payload in unsafe_payloads:
        tool = ReadOnlyContextTool(
            settings=make_settings(),
            client=FakeClient(FakeResponse(200, payload)),
        )

        with pytest.raises(ConversationWorkflowError) as error:
            asyncio.run(tool.read_context(make_runtime_request()))

        assert error.value.error_category == "unsafe_partial_result"


def test_context_tool_maps_timeout_and_network_failures_to_safe_workflow_errors() -> None:
    timeout_tool = ReadOnlyContextTool(
        settings=make_settings(),
        client=FakeClient(httpx.TimeoutException("raw timeout payload")),
    )
    network_tool = ReadOnlyContextTool(
        settings=make_settings(),
        client=FakeClient(httpx.ConnectError("raw network payload")),
    )

    with pytest.raises(ConversationWorkflowError) as timeout_error:
        asyncio.run(timeout_tool.read_context(make_runtime_request()))
    with pytest.raises(ConversationWorkflowError) as network_error:
        asyncio.run(network_tool.read_context(make_runtime_request()))

    assert timeout_error.value.error_category == "timeout"
    assert timeout_error.value.retryable is True
    assert "raw timeout payload" not in str(timeout_error.value)
    assert network_error.value.error_category == "unavailable"
    assert network_error.value.retryable is True
    assert "raw network payload" not in str(network_error.value)


def test_context_tool_fails_closed_when_required_config_is_missing() -> None:
    tool = ReadOnlyContextTool(
        settings=Settings(
            internal_api_url=None,
            internal_service_auth_secret=None,
        ),
        client=FakeClient(FakeResponse(200, {})),
    )

    with pytest.raises(ConversationWorkflowError) as error:
        asyncio.run(tool.read_context(make_runtime_request()))

    assert error.value.error_category == "dependency_failed"
    assert error.value.retryable is False
    assert error.value.fallback_allowed is True


def test_context_tool_fails_closed_when_internal_api_url_is_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_API_URL", raising=False)
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_URL", raising=False)

    tool = ReadOnlyContextTool(
        settings=Settings(
            internal_api_url="ftp://api.internal",
            internal_service_auth_secret=SECRET,
        ),
        client=FakeClient(FakeResponse(200, {})),
    )

    with pytest.raises(ConversationWorkflowError) as error:
        asyncio.run(tool.read_context(make_runtime_request()))

    assert error.value.error_category == "dependency_failed"
    assert error.value.retryable is False
    assert error.value.fallback_allowed is True


def make_settings() -> Settings:
    return Settings(
        internal_api_url="http://api.internal",
        internal_service_auth_secret=SECRET,
        context_tool_timeout_ms=2500,
    )


def make_runtime_request(
    raw_text: str = "raw user text",
    thread_id: str | None = None,
) -> dict[str, Any]:
    return {
        "tenant": {"id": TENANT_ID, "workspaceId": WORKSPACE_ID},
        "user": {"id": USER_ID},
        "conversation": {
            "id": CONVERSATION_ID,
            **({"threadId": thread_id} if thread_id else {}),
            "sessionKey": "T01234567:user:conversation:thread",
        },
        "message": {"text": raw_text},
        "traceId": "trace-safe-1",
    }


def decode_claims(token: str) -> dict[str, Any]:
    _, encoded_claims, _ = token.split(".")
    padded = encoded_claims + "=" * (-len(encoded_claims) % 4)
    return cast(dict[str, Any], json.loads(base64.urlsafe_b64decode(padded)))


class FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> Any:
        return self._payload


class FakeClient:
    def __init__(self, response_or_error: FakeResponse | Exception) -> None:
        self._response_or_error = response_or_error
        self.calls: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []

    async def post(
        self,
        url: str,
        *,
        json: dict[str, Any],
        headers: dict[str, str],
        timeout: float,
    ) -> FakeResponse:
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        self.headers.append(headers)
        if isinstance(self._response_or_error, Exception):
            raise self._response_or_error
        return self._response_or_error
