from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = REPO_ROOT / "agent-service"


def test_dockerfile_defines_python_build_strategy_and_start_command() -> None:
    dockerfile = (SERVICE_ROOT / "Dockerfile").read_text()

    assert "FROM python:3.13-slim" in dockerfile
    assert "pip install --no-cache-dir ." in dockerfile
    assert "agent_service.main:create_app" in dockerfile
    assert "--factory" in dockerfile
    assert "--host" in dockerfile
    assert "0.0.0.0" in dockerfile
    assert "AGENT_SERVICE_PORT" in dockerfile
    assert "/health/ready" in dockerfile
    assert "/data/agent-service" in dockerfile
    assert "chown -R agentservice:agentservice /data/agent-service" in dockerfile


def test_deployment_metadata_defines_service_registration_and_env_ownership() -> None:
    deployment_doc = (SERVICE_ROOT / "deployment.md").read_text()
    railway_template = (SERVICE_ROOT / "deployment/railway-service.toml").read_text()

    for expected in [
        "agent-service",
        "agent-service/Dockerfile",
        "/health/live",
        "/health/ready",
        "AGENT_SERVICE_INTERNAL_URL",
        "AGENT_SERVICE_LOG_LEVEL",
        "AGENT_SERVICE_TRACING_ENABLED",
        "AGENT_SERVICE_RUNTIME_STATE_BACKEND",
        "AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH",
        "AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED",
        "AGENT_SERVICE_INTERNAL_API_URL",
        "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET",
        "AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY",
        "/data/agent-service",
        "Railway volume",
        "Secret",
        "Owner",
    ]:
        assert expected in deployment_doc

    assert 'name = "agent-service"' in railway_template
    assert 'root_directory = "agent-service"' in railway_template
    assert 'dockerfile_path = "agent-service/Dockerfile"' in railway_template
    assert 'healthcheck_path = "/health/ready"' in railway_template
    assert "AGENT_SERVICE_INTERNAL_URL" in railway_template
    assert "AGENT_SERVICE_INTERNAL_API_URL" in railway_template
    assert "AGENT_SERVICE_LOG_LEVEL" in railway_template
    assert "AGENT_SERVICE_TRACING_ENABLED" in railway_template
    assert "AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY" in railway_template
    assert "railway up" not in deployment_doc
