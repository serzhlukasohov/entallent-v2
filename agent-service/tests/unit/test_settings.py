from agent_service.infrastructure.settings import Settings


def test_settings_defaults_do_not_require_external_dependencies() -> None:
    settings = Settings()

    assert settings.service_name == "agent-service"
    assert settings.environment == "local"
    assert settings.otlp_endpoint is None
    assert settings.tracing_enabled is False


def test_settings_allow_opentelemetry_configuration_without_secrets() -> None:
    settings = Settings(otlp_endpoint="http://collector:4318", tracing_enabled=True)

    assert settings.otlp_endpoint == "http://collector:4318"
    assert settings.tracing_enabled is True
