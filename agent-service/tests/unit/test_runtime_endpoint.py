import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import agent_service.api.runtime as runtime_api
from agent_service.contracts.runtime_contract import (
    validate_runtime_error_response,
    validate_runtime_result,
)
from agent_service.infrastructure.settings import Settings, get_settings
from agent_service.main import create_app
from agent_service.workflows.conversation_workflow import ConversationWorkflowError
from agent_service.workflows.model_provider import (
    ConversationModelReply,
    UnsafeConversationModelOutputError,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_ROOT = REPO_ROOT / "packages/contracts/runtime"
RUNTIME_ENV_KEYS = [
    "AGENT_SERVICE_INTERNAL_API_URL",
    "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET",
    "AGENT_SERVICE_INTERNAL_URL",
    "AGENT_SERVICE_MODEL_PROVIDER",
    "AGENT_SERVICE_MODEL_NAME",
    "AGENT_SERVICE_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "AGENT_SERVICE_OPENAI_ORG_ID",
    "OPENAI_ORG_ID",
    "AGENT_SERVICE_AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_ENDPOINT",
    "AGENT_SERVICE_AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AGENT_SERVICE_AZURE_OPENAI_API_VERSION",
    "AZURE_OPENAI_API_VERSION",
    "AGENT_SERVICE_LLM_SAFETY_MODE",
    "AGENT_SERVICE_LLM_SAFETY_PROVIDER",
    "AGENT_SERVICE_LLM_SAFETY_TIMEOUT_MS",
    "AGENT_SERVICE_AZURE_CONTENT_SAFETY_ENDPOINT",
    "AZURE_CONTENT_SAFETY_ENDPOINT",
    "AGENT_SERVICE_AZURE_CONTENT_SAFETY_KEY",
    "AZURE_CONTENT_SAFETY_KEY",
    "AGENT_SERVICE_AZURE_CONTENT_SAFETY_API_VERSION",
    "AZURE_CONTENT_SAFETY_API_VERSION",
]


def read_fixture(relative_path: str) -> Any:
    return json.loads((CONTRACT_ROOT / "fixtures" / relative_path).read_text())


@pytest.fixture(autouse=True)
def clear_settings_cache(monkeypatch: pytest.MonkeyPatch) -> Any:
    for env_key in RUNTIME_ENV_KEYS:
        monkeypatch.delenv(env_key, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_runtime_endpoint_returns_contract_valid_candidate_result_for_valid_request() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 200
    body = response.json()
    assert validate_runtime_result(body) == {"ok": True}
    assert body["reply"] == {
        "text": "MAF candidate response prepared for shadow comparison.",
        "mode": "candidate",
    }
    assert body["riskAssessment"]["severity"] == "none"
    assert body["memoryCandidates"]
    assert [action["actionType"] for action in body["proposedActions"]] == [
        "save_memory",
        "schedule_follow_up",
    ]
    assert all(action["commitMarker"] is None for action in body["proposedActions"])
    assert all(
        action["executionStatus"] != "committed"
        for action in body["proposedActions"]
    )
    assert body["diagnostics"]["traceId"] == request_body["traceId"]
    assert body["diagnostics"]["runtimeAttempt"] == request_body["runtimeAttempt"]
    assert body["diagnostics"]["modelCalls"] == 0
    assert body["diagnostics"]["toolCalls"] == 0
    assert body["diagnostics"]["retryCount"] == 0


def test_runtime_builds_no_safety_gateway_by_default() -> None:
    assert runtime_api.build_llm_safety_gateway(Settings()) is None


def test_runtime_rejects_block_mode_azure_safety_without_credentials() -> None:
    settings = Settings(
        llm_safety_mode="block",
        llm_safety_provider="azure_prompt_shields",
    )

    with pytest.raises(ConversationWorkflowError) as error:
        runtime_api.build_llm_safety_gateway(settings)

    assert error.value.error_category == "dependency_failed"
    assert "safety" in error.value.safe_message


def test_runtime_endpoint_returns_classification_from_workflow_response() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 200
    body = response.json()
    assert validate_runtime_result(body) == {"ok": True}
    assert body["classification"] == {
        "primaryIntent": "casual_conversation",
        "secondaryIntents": [],
        "emotionalState": [],
        "urgency": "low",
        "confidence": 0.62,
        "requiresSafetyCheck": False,
        "surveyAllowed": True,
        "reasoningSummary": "Python workflow classified intent as casual_conversation.",
        "reminderRequest": None,
        "dialogueAct": "new_substance",
        "latestUserSubstance": "Synthetic message for runtime contract validation.",
        "topicAnchor": None,
    }


def test_runtime_endpoint_rejects_runtime_result_without_classification(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = read_fixture("valid/process-message-request.json")
    result_without_classification = read_fixture("valid/runtime-result.json")
    del result_without_classification["classification"]

    class IncompleteResultWorkflow:
        async def run_async(self, _: dict[str, Any]) -> dict[str, Any]:
            return result_without_classification

    monkeypatch.setattr(runtime_api, "build_runtime_workflow", lambda _: IncompleteResultWorkflow())

    client = TestClient(create_app())
    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 500
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "unsafe_partial_result",
        "retryable": False,
        "fallbackAllowed": True,
        "message": "MAF core workflow produced an unsafe result.",
    }


def test_runtime_endpoint_uses_configured_model_client(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = read_fixture("valid/process-message-request.json")

    class FakeModelClient:
        async def generate_reply(
            self,
            request: dict[str, Any],
            state: dict[str, Any],
        ) -> ConversationModelReply:
            _ = request
            _ = state
            return ConversationModelReply(text="Endpoint model candidate reply.")

    monkeypatch.setattr(runtime_api, "build_model_client", lambda _: FakeModelClient())
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 200
    body = response.json()
    assert validate_runtime_result(body) == {"ok": True}
    assert body["reply"] == {
        "text": "Endpoint model candidate reply.",
        "mode": "candidate",
    }
    assert body["diagnostics"]["modelCalls"] == 1


def test_runtime_endpoint_marks_proactive_probe_only_when_reply_matches_probe(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = read_fixture("valid/proactive-check-in-request.json")

    class FakeModelClient:
        async def generate_reply(
            self,
            request: dict[str, Any],
            state: dict[str, Any],
        ) -> ConversationModelReply:
            _ = request
            _ = state
            return ConversationModelReply(
                text="Quick pulse: what would success look like for you this week?",
            )

    monkeypatch.setattr(runtime_api, "build_model_client", lambda _: FakeModelClient())
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 200
    body = response.json()
    assert validate_runtime_result(body) == {"ok": True}
    assert body["reply"]["metadata"] == {
        "containsSurveyProbe": True,
        "surveyProbeQuestionId": "88888888-8888-4888-8888-888888888888",
    }


def test_runtime_endpoint_does_not_mark_generic_proactive_reply_as_probe_sent(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = read_fixture("valid/proactive-check-in-request.json")

    class FakeModelClient:
        async def generate_reply(
            self,
            request: dict[str, Any],
            state: dict[str, Any],
        ) -> ConversationModelReply:
            _ = request
            _ = state
            return ConversationModelReply(text="Hey, just checking in. How are things today?")

    monkeypatch.setattr(runtime_api, "build_model_client", lambda _: FakeModelClient())
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 200
    body = response.json()
    assert validate_runtime_result(body) == {"ok": True}
    assert "metadata" not in body["reply"]


def test_runtime_endpoint_rejects_unsafe_model_reply_with_safe_error_body(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = read_fixture("valid/process-message-request.json")

    class UnsafeModelClient:
        async def generate_reply(
            self,
            request: dict[str, Any],
            state: dict[str, Any],
        ) -> ConversationModelReply:
            _ = request
            _ = state
            raise UnsafeConversationModelOutputError(
                "Bearer secret-token raw Slack user text",
            )

    monkeypatch.setattr(runtime_api, "build_model_client", lambda _: UnsafeModelClient())
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 500
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "unsafe_partial_result",
        "retryable": False,
        "fallbackAllowed": True,
        "message": "MAF core workflow produced an unsafe result.",
    }
    serialized = json.dumps(body)
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized


def test_runtime_endpoint_returns_safe_error_for_misconfigured_model_provider(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_SERVICE_MODEL_PROVIDER", "openai")
    monkeypatch.delenv("AGENT_SERVICE_MODEL_NAME", raising=False)
    monkeypatch.delenv("AGENT_SERVICE_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    get_settings.cache_clear()
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 502
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "dependency_failed",
        "retryable": True,
        "fallbackAllowed": True,
        "message": "MAF core workflow dependency failed safely.",
    }


def test_runtime_endpoint_rejects_whitespace_model_provider_config(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_SERVICE_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("AGENT_SERVICE_MODEL_NAME", "   ")
    monkeypatch.setenv("AGENT_SERVICE_OPENAI_API_KEY", "   ")
    get_settings.cache_clear()
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 502
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body["errorCategory"] == "dependency_failed"
    assert "   " not in json.dumps(body)


def test_runtime_endpoint_returns_canonical_error_for_workflow_step_failure(
    monkeypatch: MonkeyPatch,
) -> None:
    sensitive_message = "Bearer secret-token raw Slack user text"

    class FailingWorkflow:
        async def run_async(self, _: dict[str, Any]) -> dict[str, Any]:
            raise ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=False,
                fallback_allowed=False,
                message=sensitive_message,
            )

    monkeypatch.setattr(runtime_api, "ConversationWorkflow", FailingWorkflow)
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 502
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "dependency_failed",
        "retryable": True,
        "fallbackAllowed": True,
        "message": "MAF core workflow dependency failed safely.",
    }
    serialized = json.dumps(body)
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized


def test_runtime_endpoint_normalizes_workflow_validation_failure_flags(
    monkeypatch: MonkeyPatch,
) -> None:
    class FailingWorkflow:
        async def run_async(self, _: dict[str, Any]) -> dict[str, Any]:
            raise ConversationWorkflowError(
                error_category="validation_error",
                retryable=True,
                fallback_allowed=False,
                message="unsafe validation detail",
            )

    monkeypatch.setattr(runtime_api, "ConversationWorkflow", FailingWorkflow)
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 400
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "validation_error",
        "retryable": False,
        "fallbackAllowed": True,
        "message": "MAF core workflow validation failed safely.",
    }


def test_runtime_endpoint_redacts_unexpected_workflow_errors(
    monkeypatch: MonkeyPatch,
) -> None:
    sensitive_text = "Bearer secret-token raw Slack user text"

    class ExplodingWorkflow:
        async def run_async(self, payload: dict[str, Any]) -> dict[str, Any]:
            raise RuntimeError(f"leaked {payload['message']['text']}")

    monkeypatch.setattr(runtime_api, "ConversationWorkflow", ExplodingWorkflow)
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = sensitive_text
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 502
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "dependency_failed",
        "retryable": True,
        "fallbackAllowed": True,
        "message": "MAF core workflow dependency failed safely.",
    }
    serialized = json.dumps(body)
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized
    assert "RuntimeError" not in serialized


def test_runtime_endpoint_returns_canonical_error_for_invalid_request() -> None:
    request_body = read_fixture("invalid/missing-idempotency-key.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 400
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body == {
        "traceId": request_body["traceId"],
        "errorCategory": "validation_error",
        "retryable": False,
        "fallbackAllowed": False,
        "message": "Runtime request failed contract validation.",
    }


def test_runtime_endpoint_redacts_unsafe_trace_id_from_error_response() -> None:
    request_body = read_fixture("invalid/missing-idempotency-key.json")
    request_body["traceId"] = "Bearer secret-token raw Slack user text"
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 400
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body["traceId"] == "unknown-trace"
    serialized = json.dumps(body)
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized


def test_runtime_endpoint_returns_canonical_error_for_malformed_json() -> None:
    client = TestClient(create_app())

    response = client.post(
        "/runtime/process-message",
        content="{",
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 400
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body["traceId"] == "unknown-trace"
    assert body["errorCategory"] == "validation_error"
    assert body["retryable"] is False
    assert body["fallbackAllowed"] is False


def test_runtime_endpoint_returns_canonical_error_for_non_object_json() -> None:
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=[])

    assert response.status_code == 400
    body = response.json()
    assert validate_runtime_error_response(body) == {"ok": True}
    assert body["traceId"] == "unknown-trace"


def test_runtime_endpoint_rejects_invalid_request_before_workflow_execution(
    monkeypatch: MonkeyPatch,
) -> None:
    class UnexpectedWorkflow:
        async def run_async(self, _: dict[str, Any]) -> dict[str, Any]:
            raise AssertionError("workflow should not run")

    monkeypatch.setattr(runtime_api, "ConversationWorkflow", UnexpectedWorkflow)
    request_body = read_fixture("invalid/missing-idempotency-key.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 400
    assert validate_runtime_error_response(response.json()) == {"ok": True}


def test_runtime_endpoint_does_not_require_external_dependencies(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    request_body = read_fixture("valid/process-message-request.json")
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    assert response.status_code == 200


def test_runtime_endpoint_uses_configured_context_tool(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["tenant"]["id"] = "00000000-0000-4000-8000-000000000000"
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_API_URL", "http://api.internal")
    monkeypatch.setenv(
        "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET",
        "0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    get_settings.cache_clear()
    constructed_tools: list[Any] = []

    class FakeContextTool:
        def __init__(self, *, settings: Any) -> None:
            self.settings = settings
            constructed_tools.append(self)

        async def read_context(self, _: dict[str, Any]) -> dict[str, Any]:
            return {
                "userProfile": None,
                "memoryItems": [],
                "goals": [],
                "recentTurns": [],
                "surveyState": None,
                "riskSignals": [],
                "diagnostics": {"counts": {}},
            }

    monkeypatch.setattr(runtime_api, "ReadOnlyContextTool", FakeContextTool)
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json=request_body)

    get_settings.cache_clear()
    assert response.status_code == 200
    assert constructed_tools
    assert response.json()["diagnostics"]["toolCalls"] == 1
