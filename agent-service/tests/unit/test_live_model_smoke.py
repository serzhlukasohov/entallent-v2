import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from pytest import MonkeyPatch

import agent_service.api.runtime as runtime_api
import agent_service.smoke.live_model as live_model
from agent_service.infrastructure.settings import Settings
from agent_service.smoke.live_model import (
    LiveModelSmokeHttpResponse,
    collect_missing_model_config_keys,
    redacted_json,
    run_live_model_smoke,
)
from agent_service.workflows.conversation_workflow import ConversationWorkflow
from agent_service.workflows.model_provider import ConversationModelReply

SMOKE_ENV_KEYS = [
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
]


@pytest.fixture(autouse=True)
def isolate_smoke_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for env_key in SMOKE_ENV_KEYS:
        monkeypatch.delenv(env_key, raising=False)


def test_live_model_smoke_reports_missing_openai_config_without_calling_provider() -> None:
    called = False

    async def unexpected_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        nonlocal called
        called = True
        raise AssertionError("provider path should not be called")

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(model_provider="openai", model_name="gpt-4o"),
            post_json=unexpected_post_json,
        )
    )

    assert result.ok is False
    assert result.status == "configuration_missing"
    assert result.exit_code == 2
    assert result.evidence == {
        "status": "configuration_missing",
        "missingConfigKeys": ["AGENT_SERVICE_OPENAI_API_KEY"],
    }
    assert called is False


def test_live_model_smoke_reports_disabled_provider_without_calling_provider() -> None:
    called = False

    async def unexpected_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        nonlocal called
        called = True
        raise AssertionError("provider path should not be called")

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(),
            post_json=unexpected_post_json,
        )
    )

    assert result.ok is False
    assert result.status == "configuration_missing"
    assert result.evidence == {
        "status": "configuration_missing",
        "missingConfigKeys": ["AGENT_SERVICE_MODEL_PROVIDER"],
    }
    assert called is False


def test_live_model_smoke_reports_invalid_settings_safely(monkeypatch: MonkeyPatch) -> None:
    def raise_validation_error() -> Settings:
        return Settings(port=70000)

    monkeypatch.setattr(live_model, "get_settings", raise_validation_error)

    result = asyncio.run(run_live_model_smoke())

    assert result.ok is False
    assert result.status == "configuration_invalid"
    assert result.evidence == {"status": "configuration_invalid"}


def test_live_model_smoke_reports_missing_azure_config_without_calling_provider() -> None:
    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="azure_openai",
                model_name="deployment-a",
                azure_openai_endpoint="https://example.openai.azure.com",
            ),
            post_json=lambda _: (_ for _ in ()).throw(
                AssertionError("provider path should not be called")
            ),
        )
    )

    assert result.ok is False
    assert result.status == "configuration_missing"
    assert result.evidence == {
        "status": "configuration_missing",
        "missingConfigKeys": [
            "AGENT_SERVICE_AZURE_OPENAI_API_KEY",
            "AGENT_SERVICE_AZURE_OPENAI_API_VERSION",
        ],
    }


def test_live_model_smoke_success_evidence_is_redacted() -> None:
    request_body = load_valid_request()
    runtime_result = asyncio.run(build_model_runtime_result(request_body))

    async def fake_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        return LiveModelSmokeHttpResponse(status_code=200, body=runtime_result)

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
            post_json=fake_post_json,
        )
    )

    assert result.ok is True
    assert result.status == "valid"
    assert result.exit_code == 0
    assert result.evidence["status"] == "valid"
    assert result.evidence["modelCalls"] == 1
    assert result.evidence["toolCalls"] == 0
    assert result.evidence["retryCount"] == 0
    assert result.evidence["riskSeverity"] == "none"
    assert result.evidence["actionCount"] == 2
    assert result.evidence["memoryCandidateCount"] == 1
    assert result.evidence["replyLength"] == len("Live model candidate reply.")
    assert "replyDigest" in result.evidence

    serialized = redacted_json(result.evidence)
    assert "Live model candidate reply." not in serialized
    assert request_body["message"]["text"] not in serialized
    assert "Synthetic memory content." not in serialized
    assert "sk-secret-value" not in serialized
    assert "actionPayload" not in serialized


def test_live_model_smoke_uses_in_process_runtime_endpoint(
    monkeypatch: MonkeyPatch,
) -> None:
    request_body = load_valid_request()

    class FakeModelClient:
        async def generate_reply(
            self,
            request: dict[str, Any],
            state: dict[str, Any],
        ) -> ConversationModelReply:
            _ = request
            _ = state
            return ConversationModelReply(text="In-process live model candidate reply.")

    monkeypatch.setattr(runtime_api, "build_model_client", lambda _: FakeModelClient())

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
        )
    )

    assert result.ok is True
    assert result.status == "valid"
    assert result.evidence["modelCalls"] == 1
    assert result.evidence["runtimeVersion"] == "agent-service-maf-core/1.13.0"
    assert "replyDigest" in result.evidence
    assert "In-process live model candidate reply." not in redacted_json(result.evidence)


def test_live_model_smoke_runtime_error_evidence_is_safe() -> None:
    request_body = load_valid_request()

    async def fake_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        return LiveModelSmokeHttpResponse(
            status_code=502,
            body={
                "traceId": request_body["traceId"],
                "errorCategory": "dependency_failed",
                "retryable": True,
                "fallbackAllowed": True,
                "message": "MAF core workflow dependency failed safely.",
            },
        )

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
            post_json=fake_post_json,
        )
    )

    assert result.ok is False
    assert result.status == "runtime_error"
    assert result.exit_code == 1
    assert result.evidence == {
        "status": "runtime_error",
        "statusCode": 502,
        "traceId": request_body["traceId"],
        "errorCategory": "dependency_failed",
        "retryable": True,
        "fallbackAllowed": True,
    }
    serialized = redacted_json(result.evidence)
    assert "sk-secret-value" not in serialized
    assert "MAF core workflow dependency failed safely." not in serialized


def test_live_model_smoke_rejects_http_error_with_result_shaped_body() -> None:
    request_body = load_valid_request()
    runtime_result = asyncio.run(build_model_runtime_result(request_body))

    async def fake_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        return LiveModelSmokeHttpResponse(status_code=500, body=runtime_result)

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
            post_json=fake_post_json,
        )
    )

    assert result.ok is False
    assert result.status == "http_failed"
    assert result.evidence == {
        "status": "http_failed",
        "statusCode": 500,
        "traceId": request_body["traceId"],
    }


def test_live_model_smoke_rejects_committed_actions() -> None:
    request_body = load_valid_request()
    runtime_result = asyncio.run(build_model_runtime_result(request_body))
    runtime_result["proposedActions"][0]["executionStatus"] = "committed"
    runtime_result["proposedActions"][0]["commitMarker"] = {
        "committedAt": "2026-08-07T10:00:00Z",
        "committedBy": "python",
    }

    async def fake_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        return LiveModelSmokeHttpResponse(status_code=200, body=runtime_result)

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
            post_json=fake_post_json,
        )
    )

    assert result.ok is False
    assert result.status == "side_effect_boundary_failed"
    assert result.evidence == {
        "status": "side_effect_boundary_failed",
        "traceId": request_body["traceId"],
    }


@pytest.mark.parametrize("execution_status", ["committed", "failed"])
def test_live_model_smoke_rejects_non_candidate_action_statuses(
    execution_status: str,
) -> None:
    request_body = load_valid_request()
    runtime_result = asyncio.run(build_model_runtime_result(request_body))
    runtime_result["proposedActions"][0]["executionStatus"] = execution_status

    async def fake_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        return LiveModelSmokeHttpResponse(status_code=200, body=runtime_result)

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
            post_json=fake_post_json,
        )
    )

    assert result.ok is False
    assert result.status == "side_effect_boundary_failed"


def test_live_model_smoke_redacts_unsafe_trace_ids() -> None:
    request_body = load_valid_request()
    request_body["traceId"] = "Bearer secret-token raw Slack user text"

    async def fake_post_json(_: dict[str, Any]) -> LiveModelSmokeHttpResponse:
        return LiveModelSmokeHttpResponse(
            status_code=502,
            body={
                "traceId": "Bearer secret-token raw Slack user text",
                "errorCategory": "dependency_failed",
                "retryable": True,
                "fallbackAllowed": True,
                "message": "MAF core workflow dependency failed safely.",
            },
        )

    result = asyncio.run(
        run_live_model_smoke(
            settings=Settings(
                model_provider="openai",
                model_name="gpt-4o",
                openai_api_key="sk-secret-value",
            ),
            request_body=request_body,
            post_json=fake_post_json,
        )
    )

    assert result.ok is False
    assert result.evidence["traceId"] == "unknown"
    serialized = redacted_json(result.evidence)
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized


def test_collect_missing_model_config_requires_explicit_provider() -> None:
    assert collect_missing_model_config_keys(Settings()) == ["AGENT_SERVICE_MODEL_PROVIDER"]


def load_valid_request() -> dict[str, Any]:
    fixture_path = (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/runtime/fixtures/valid/process-message-request.json"
    )
    payload = json.loads(
        fixture_path.read_text(),
    )
    if not isinstance(payload, dict):
        raise AssertionError("valid runtime request fixture must be an object")
    return payload


async def build_model_runtime_result(request_body: dict[str, Any]) -> dict[str, Any]:
    class FakeModelClient:
        async def generate_reply(
            self,
            request: dict[str, Any],
            state: dict[str, Any],
        ) -> ConversationModelReply:
            _ = request
            _ = state
            return ConversationModelReply(text="Live model candidate reply.")

    return await ConversationWorkflow(model_client=FakeModelClient()).run_async(request_body)
