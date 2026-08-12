from pytest import MonkeyPatch

from agent_service.infrastructure.settings import Settings


def test_settings_defaults_do_not_require_external_dependencies(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_API_URL", raising=False)
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_URL", raising=False)

    settings = Settings(internal_api_url=None)

    assert settings.service_name == "agent-service"
    assert settings.environment == "local"
    assert settings.otlp_endpoint is None
    assert settings.tracing_enabled is False
    assert settings.runtime_state_backend == "memory"
    assert settings.non_local_shadow_enabled is False
    assert settings.internal_api_url is None
    assert settings.context_tool_timeout_ms == 2500
    assert settings.model_provider == "disabled"
    assert settings.model_name is None


def test_settings_allow_opentelemetry_configuration_without_secrets() -> None:
    settings = Settings(
        otlp_endpoint="http://collector:4318",
        tracing_enabled=True,
        otel_service_name="agent-service-test",
    )

    assert settings.otlp_endpoint == "http://collector:4318"
    assert settings.tracing_enabled is True
    assert settings.otel_service_name == "agent-service-test"


def test_settings_use_service_prefixed_opentelemetry_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_OTEL_SERVICE_NAME", "agent-service-env")

    settings = Settings()

    assert settings.otel_service_name == "agent-service-env"


def test_settings_keep_unprefixed_opentelemetry_service_name_compatibility(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("OTEL_SERVICE_NAME", "agent-service-otel")

    settings = Settings()

    assert settings.otel_service_name == "agent-service-otel"


def test_settings_use_prefixed_runtime_state_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_RUNTIME_STATE_BACKEND", "sqlite")
    monkeypatch.setenv(
        "AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH",
        "/tmp/agent-service-runtime-state.sqlite3",
    )
    monkeypatch.setenv("AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED", "true")

    settings = Settings()

    assert settings.runtime_state_backend == "sqlite"
    assert str(settings.runtime_state_sqlite_path) == "/tmp/agent-service-runtime-state.sqlite3"
    assert settings.non_local_shadow_enabled is True


def test_settings_use_prefixed_context_tool_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_API_URL", "http://api.internal")
    monkeypatch.setenv("AGENT_SERVICE_CONTEXT_TOOL_TIMEOUT_MS", "1500")

    settings = Settings()

    assert settings.internal_api_url == "http://api.internal"
    assert settings.context_tool_timeout_ms == 1500


def test_settings_use_legacy_internal_url_alias_for_internal_api(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_SERVICE_INTERNAL_API_URL", raising=False)
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_URL", "http://api.internal-legacy")

    settings = Settings()

    assert settings.internal_api_url == "http://api.internal-legacy"


def test_settings_prefers_internal_api_url_over_legacy_alias(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_API_URL", "http://api.internal")
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_URL", "http://api.internal-legacy")

    settings = Settings()

    assert settings.internal_api_url == "http://api.internal"


def test_settings_use_prefixed_model_provider_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("AGENT_SERVICE_MODEL_NAME", "gpt-test")
    monkeypatch.setenv("AGENT_SERVICE_OPENAI_API_KEY", "test-key")

    settings = Settings()

    assert settings.model_provider == "openai"
    assert settings.model_name == "gpt-test"
    assert settings.openai_api_key == "test-key"
