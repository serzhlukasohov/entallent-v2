import json
from pathlib import Path
from typing import Any

from agent_service.contracts.runtime_contract import (
    validate_runtime_contract,
    validate_runtime_error_response,
    validate_runtime_process_message_request,
    validate_runtime_result,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_ROOT = REPO_ROOT / "packages/contracts/runtime"
PACKAGED_CONTRACT_PATH = (
    REPO_ROOT / "agent-service/src/agent_service/contracts/openapi.json"
)


def read_fixture(relative_path: str) -> Any:
    return json.loads((CONTRACT_ROOT / "fixtures" / relative_path).read_text())


def read_manifest() -> dict[str, list[dict[str, str]]]:
    manifest = json.loads((CONTRACT_ROOT / "fixtures/manifest.json").read_text())
    if not isinstance(manifest, dict):
        raise TypeError("fixture manifest must be an object")
    valid = manifest.get("valid")
    invalid = manifest.get("invalid")
    if not isinstance(valid, list) or not isinstance(invalid, list):
        raise TypeError("fixture manifest must contain valid and invalid lists")
    return {"valid": valid, "invalid": invalid}


def test_python_service_packages_shared_runtime_openapi_schema() -> None:
    shared_schema = json.loads((CONTRACT_ROOT / "openapi.json").read_text())
    packaged_schema = json.loads(PACKAGED_CONTRACT_PATH.read_text())

    assert packaged_schema == shared_schema


def test_python_service_accepts_shared_runtime_contract_valid_fixtures() -> None:
    manifest = read_manifest()

    for fixture in manifest["valid"]:
        result = validate_runtime_contract(
            fixture["schemaName"],
            read_fixture(fixture["path"]),
        )

        assert result == {"ok": True}, fixture["path"]


def test_python_service_rejects_shared_runtime_contract_invalid_fixtures() -> None:
    manifest = read_manifest()

    for fixture in manifest["invalid"]:
        result = validate_runtime_contract(
            fixture["schemaName"],
            read_fixture(fixture["path"]),
        )

        assert result["ok"] is False, fixture["path"]
        assert result["errorCategory"] == fixture["expectedErrorCategory"], fixture["path"]


def test_named_runtime_contract_helpers_cover_endpoint_boundary_schemas() -> None:
    assert validate_runtime_process_message_request(
        read_fixture("valid/process-message-request.json")
    ) == {"ok": True}
    assert validate_runtime_result(read_fixture("valid/runtime-result.json")) == {
        "ok": True
    }
    assert validate_runtime_error_response(
        read_fixture("valid/runtime-error-response.json")
    ) == {"ok": True}
