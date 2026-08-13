from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import ValidationError

from agent_service.contracts.runtime_contract import (
    RUNTIME_CONTRACT_ROOT,
    validate_runtime_error_response,
    validate_runtime_process_message_request,
    validate_runtime_result,
)
from agent_service.infrastructure.settings import Settings, get_settings
from agent_service.main import create_app

RUNTIME_ENDPOINT_PATH = "/runtime/process-message"
DEFAULT_REQUEST_FIXTURE = RUNTIME_CONTRACT_ROOT / "fixtures/valid/process-message-request.json"

LiveModelSmokeStatus = Literal[
    "valid",
    "configuration_missing",
    "request_invalid",
    "response_invalid",
    "runtime_error",
    "configuration_invalid",
    "http_failed",
    "side_effect_boundary_failed",
    "model_call_count_invalid",
]


@dataclass(frozen=True)
class LiveModelSmokeHttpResponse:
    status_code: int
    body: dict[str, Any]


@dataclass(frozen=True)
class LiveModelSmokeResult:
    ok: bool
    status: LiveModelSmokeStatus
    exit_code: int
    evidence: dict[str, Any]


PostJson = Callable[[dict[str, Any]], Awaitable[LiveModelSmokeHttpResponse]]


async def run_live_model_smoke(
    *,
    settings: Settings | None = None,
    request_body: dict[str, Any] | None = None,
    post_json: PostJson | None = None,
) -> LiveModelSmokeResult:
    try:
        active_settings = settings if settings is not None else get_settings()
    except ValidationError:
        return LiveModelSmokeResult(
            ok=False,
            status="configuration_invalid",
            exit_code=2,
            evidence={
                "status": "configuration_invalid",
            },
        )

    missing_config = collect_missing_model_config_keys(active_settings)
    if missing_config:
        return LiveModelSmokeResult(
            ok=False,
            status="configuration_missing",
            exit_code=2,
            evidence={
                "status": "configuration_missing",
                "missingConfigKeys": missing_config,
            },
        )

    payload = request_body if request_body is not None else load_default_request()
    request_validation = validate_runtime_process_message_request(payload)
    if not request_validation["ok"]:
        return LiveModelSmokeResult(
            ok=False,
            status="request_invalid",
            exit_code=1,
            evidence={
                "status": "request_invalid",
                "traceId": safe_trace_id(payload.get("traceId")),
                "errorCategory": request_validation["errorCategory"],
                "path": request_validation["path"],
            },
        )

    response = await safe_post_json(payload, post_json)
    if response is None:
        return LiveModelSmokeResult(
            ok=False,
            status="http_failed",
            exit_code=1,
            evidence={
                "status": "http_failed",
                "traceId": safe_string(payload.get("traceId")),
            },
        )

    error_validation = validate_runtime_error_response(response.body)
    if response.status_code >= 400 and error_validation["ok"]:
        return LiveModelSmokeResult(
            ok=False,
            status="runtime_error",
            exit_code=1,
            evidence={
                "status": "runtime_error",
                "statusCode": response.status_code,
                "traceId": safe_trace_id(response.body.get("traceId")),
                "errorCategory": safe_reason_code(response.body.get("errorCategory")),
                "retryable": bool(response.body.get("retryable")),
                "fallbackAllowed": bool(response.body.get("fallbackAllowed")),
            },
        )

    if response.status_code >= 400:
        return LiveModelSmokeResult(
            ok=False,
            status="http_failed",
            exit_code=1,
            evidence={
                "status": "http_failed",
                "statusCode": response.status_code,
                "traceId": safe_trace_id(payload.get("traceId")),
            },
        )

    if has_committed_proposed_actions(response.body):
        return LiveModelSmokeResult(
            ok=False,
            status="side_effect_boundary_failed",
            exit_code=1,
            evidence={
                "status": "side_effect_boundary_failed",
                "traceId": result_trace_id(response.body),
            },
        )

    result_validation = validate_runtime_result(response.body)
    if not result_validation["ok"]:
        return LiveModelSmokeResult(
            ok=False,
            status="response_invalid",
            exit_code=1,
            evidence={
                "status": "response_invalid",
                "traceId": safe_trace_id(payload.get("traceId")),
                "errorCategory": safe_reason_code(result_validation["errorCategory"]),
                "path": result_validation["path"],
            },
        )

    diagnostics = response.body.get("diagnostics", {})
    model_calls = diagnostics.get("modelCalls") if isinstance(diagnostics, dict) else None
    reply_renderer = (
        diagnostics.get("replyRenderer") if isinstance(diagnostics, dict) else None
    )
    if not valid_smoke_model_calls(model_calls, reply_renderer):
        return LiveModelSmokeResult(
            ok=False,
            status="model_call_count_invalid",
            exit_code=1,
            evidence={
                "status": "model_call_count_invalid",
                "traceId": result_trace_id(response.body),
                "modelCalls": model_calls,
            },
        )

    return LiveModelSmokeResult(
        ok=True,
        status="valid",
        exit_code=0,
        evidence=build_success_evidence(response.body),
    )


def valid_smoke_model_calls(model_calls: Any, reply_renderer: Any) -> bool:
    if not isinstance(model_calls, int) or isinstance(model_calls, bool):
        return False
    if isinstance(reply_renderer, str) and reply_renderer.startswith("deterministic_"):
        return model_calls == 0
    return model_calls == 1


def collect_missing_model_config_keys(settings: Settings) -> list[str]:
    if settings.model_provider == "disabled":
        return ["AGENT_SERVICE_MODEL_PROVIDER"]

    missing = []
    if not normalized(settings.model_name):
        missing.append("AGENT_SERVICE_MODEL_NAME")

    if settings.model_provider == "openai":
        if not normalized(settings.openai_api_key):
            missing.append("AGENT_SERVICE_OPENAI_API_KEY")
        return missing

    if not normalized(settings.azure_openai_endpoint):
        missing.append("AGENT_SERVICE_AZURE_OPENAI_ENDPOINT")
    if not normalized(settings.azure_openai_api_key):
        missing.append("AGENT_SERVICE_AZURE_OPENAI_API_KEY")
    if not normalized(settings.azure_openai_api_version):
        missing.append("AGENT_SERVICE_AZURE_OPENAI_API_VERSION")
    return missing


def build_success_evidence(result: dict[str, Any]) -> dict[str, Any]:
    diagnostics = result["diagnostics"]
    reply_text = result["reply"]["text"]
    return {
        "status": "valid",
        "traceId": result_trace_id(result),
        "runtimeVersion": runtime_version(result),
        "modelCalls": diagnostics["modelCalls"],
        "toolCalls": diagnostics["toolCalls"],
        "retryCount": diagnostics["retryCount"],
        "riskSeverity": result["riskAssessment"]["severity"],
        "actionCount": len(result.get("proposedActions", [])),
        "memoryCandidateCount": len(result.get("memoryCandidates", [])),
        "replyDigest": hashlib.sha256(reply_text.encode("utf-8")).hexdigest()[:16],
        "replyLength": len(reply_text),
        "validationStatus": "contract_valid",
    }


def has_committed_proposed_actions(result: dict[str, Any]) -> bool:
    proposed_actions = result.get("proposedActions")
    if not isinstance(proposed_actions, list):
        return False
    for action in proposed_actions:
        if not isinstance(action, dict):
            continue
        if action.get("executionStatus") not in {"not_started", "blocked"}:
            return True
        if action.get("commitMarker") is not None:
            return True
    return False


def result_trace_id(result: dict[str, Any]) -> str:
    diagnostics = result.get("diagnostics")
    if isinstance(diagnostics, dict):
        return safe_trace_id(diagnostics.get("traceId"))
    return safe_trace_id(result.get("traceId"))


def runtime_version(result: dict[str, Any]) -> str:
    diagnostics = result.get("diagnostics")
    if isinstance(diagnostics, dict):
        return safe_reason_code(diagnostics.get("runtimeVersion"))
    return safe_reason_code(result.get("runtimeVersion"))


async def safe_post_json(
    payload: dict[str, Any],
    post_json: PostJson | None,
) -> LiveModelSmokeHttpResponse | None:
    try:
        if post_json is not None:
            return await post_json(payload)
        return await post_runtime_message(payload)
    except Exception:
        return None


async def post_runtime_message(payload: dict[str, Any]) -> LiveModelSmokeHttpResponse:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://agent-service.local",
    ) as client:
        response = await client.post(RUNTIME_ENDPOINT_PATH, json=payload)
    try:
        body = response.json()
    except ValueError:
        body = {}
    return LiveModelSmokeHttpResponse(status_code=response.status_code, body=body)


def load_default_request(path: Path = DEFAULT_REQUEST_FIXTURE) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("live smoke request fixture must be a JSON object")
    return payload


def redacted_json(evidence: dict[str, Any]) -> str:
    return json.dumps(evidence, indent=2, sort_keys=True)


def normalized(value: str | None) -> str | None:
    stripped = value.strip() if isinstance(value, str) else ""
    return stripped or None


def safe_string(value: Any) -> str:
    return value if isinstance(value, str) else "unknown"


def safe_trace_id(value: Any) -> str:
    if not isinstance(value, str):
        return "unknown"
    if len(value) > 128:
        return "unknown"
    if all(character.isalnum() or character in "._:-" for character in value):
        return value
    return "unknown"


def safe_reason_code(value: Any) -> str:
    if not isinstance(value, str):
        return "unknown"
    if len(value) > 128:
        return "unknown"
    if all(character.isalnum() or character in "._:-/" for character in value):
        return value
    return "unknown"


def main() -> int:
    result = asyncio.run(run_live_model_smoke())
    print(redacted_json(result.evidence))
    return result.exit_code
