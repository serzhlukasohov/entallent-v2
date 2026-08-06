from fastapi.testclient import TestClient

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


def test_runtime_endpoint_is_not_part_of_scaffold() -> None:
    client = TestClient(create_app())

    response = client.post("/runtime/process-message", json={})

    assert response.status_code == 404
