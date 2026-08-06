from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = REPO_ROOT / "agent-service"


def test_story_4_1_does_not_introduce_out_of_scope_runtime_wiring() -> None:
    maf_client = REPO_ROOT / "packages/application/src/use-cases/maf-agent-runtime-client.ts"

    assert not maf_client.exists()
    assert not (SERVICE_ROOT / "src/agent_service/workflows").exists()
    assert not (SERVICE_ROOT / "src/agent_service/tools").exists()
    assert not (SERVICE_ROOT / "Dockerfile").exists()
    assert not (SERVICE_ROOT / "src/agent_service/api/runtime.py").exists()


def test_story_4_1_has_liveness_but_not_readiness() -> None:
    assert (SERVICE_ROOT / "src/agent_service/api/health.py").exists()

    health_source = (SERVICE_ROOT / "src/agent_service/api/health.py").read_text()

    assert '"/live"' in health_source
    assert '"/ready"' not in health_source
