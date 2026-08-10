from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agent_service.infrastructure.runtime_state import RuntimeStateConfigurationError
from agent_service.infrastructure.settings import get_settings
from agent_service.main import create_app


def test_liveness_returns_healthy_without_external_dependencies() -> None:
    client = TestClient(create_app())

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "service": "agent-service",
        "version": "0.1.0",
    }


def test_readiness_returns_healthy_for_valid_local_dependencies() -> None:
    client = TestClient(create_app())

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "agent-service",
        "version": "0.1.0",
        "checks": {
            "settings": "ok",
            "runtimeState": "ok",
            "internalAuth": "ok",
        },
    }


def test_readiness_fails_when_runtime_state_dependency_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    monkeypatch.setattr(
        "agent_service.api.health.create_runtime_state_store",
        lambda _settings: (_ for _ in ()).throw(
            RuntimeStateConfigurationError("runtime state unavailable")
        ),
    )

    client = TestClient(create_app())

    ready_response = client.get("/health/ready")
    live_response = client.get("/health/live")

    assert ready_response.status_code == 503
    assert ready_response.json()["status"] == "not_ready"
    assert ready_response.json()["checks"]["runtimeState"] == "failed"
    assert ready_response.json()["checks"]["internalAuth"] == "ok"
    assert ready_response.json()["message"] == "Readiness dependency check failed."
    assert live_response.status_code == 200

    get_settings.cache_clear()


def test_readiness_fails_safely_when_sqlite_dependency_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    get_settings.cache_clear()
    blocked_parent = tmp_path / "not-a-directory"
    blocked_parent.write_text("file blocks directory creation")
    monkeypatch.setenv("AGENT_SERVICE_RUNTIME_STATE_BACKEND", "sqlite")
    monkeypatch.setenv(
        "AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH",
        str(blocked_parent / "runtime-state.sqlite3"),
    )

    client = TestClient(create_app())

    ready_response = client.get("/health/ready")
    live_response = client.get("/health/live")

    assert ready_response.status_code == 503
    assert ready_response.json() == {
        "status": "not_ready",
        "service": "agent-service",
        "version": "0.1.0",
        "checks": {
            "settings": "ok",
            "runtimeState": "failed",
            "internalAuth": "ok",
        },
        "message": "Readiness dependency check failed.",
    }
    assert live_response.status_code == 200

    get_settings.cache_clear()


def test_readiness_fails_with_invalid_internal_auth_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET", raising=False)
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_API_URL", "http://api.internal")
    client = TestClient(create_app())

    ready_response = client.get("/health/ready")
    live_response = client.get("/health/live")

    assert ready_response.status_code == 503
    assert ready_response.json()["checks"]["internalAuth"] == "failed"
    assert ready_response.json()["checks"]["runtimeState"] == "ok"
    assert ready_response.json()["message"] == "Readiness dependency check failed."
    assert live_response.status_code == 200

    get_settings.cache_clear()


def test_readiness_passes_with_valid_internal_api_auth_dependency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_API_URL", "https://api.internal.example.com")
    monkeypatch.setenv(
        "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET",
        "a".ljust(32, "0"),
    )

    client = TestClient(create_app())

    ready_response = client.get("/health/ready")
    live_response = client.get("/health/live")

    assert ready_response.status_code == 200
    assert ready_response.json()["checks"]["internalAuth"] == "ok"
    assert live_response.status_code == 200

    get_settings.cache_clear()


def test_create_app_rejects_process_local_state_for_non_local_shadow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED", "true")
    monkeypatch.setenv("AGENT_SERVICE_RUNTIME_STATE_BACKEND", "memory")

    with pytest.raises(ValueError, match="process-local runtime state"):
        create_app()

    get_settings.cache_clear()


def test_runtime_endpoint_skeleton_is_available_after_story_4_2() -> None:
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json={})

    assert response.status_code == 400


def test_documentation_endpoints_are_not_part_of_liveness_scaffold() -> None:
    client = TestClient(create_app())

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404
