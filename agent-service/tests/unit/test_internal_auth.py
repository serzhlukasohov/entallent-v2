import base64
import json
from datetime import UTC, datetime, timedelta

import pytest

from agent_service.infrastructure.internal_auth import (
    InternalServiceAuthConfigurationError,
    create_internal_service_token,
)
from agent_service.infrastructure.settings import Settings

SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef"
NOW = datetime(2026, 8, 6, 12, 0, 0, tzinfo=UTC)


def test_create_internal_service_token_uses_signed_scoped_claims() -> None:
    token = create_internal_service_token(
        secret=SECRET,
        service_identity="agent-service",
        tenant_id="00000000-0000-4000-8000-000000000000",
        workspace_id="T01234567",
        permissions=("read",),
        endpoint_allowlist=("/internal/maf/context/read",),
        now=NOW,
        expires_in=timedelta(minutes=5),
        trace_id="trace-story-4-3",
    )

    version, encoded_claims, signature = token.split(".")
    claims = json.loads(_base64url_decode(encoded_claims).decode("utf-8"))

    assert version == "v1"
    assert signature
    assert claims == {
        "serviceIdentity": "agent-service",
        "tenantId": "00000000-0000-4000-8000-000000000000",
        "workspaceId": "T01234567",
        "permissions": ["read"],
        "endpointAllowlist": ["/internal/maf/context/read"],
        "iat": 1786017600,
        "exp": 1786017900,
        "traceId": "trace-story-4-3",
    }


def test_create_internal_service_token_fails_closed_without_secret() -> None:
    with pytest.raises(InternalServiceAuthConfigurationError):
        create_internal_service_token(
            secret=None,
            service_identity="agent-service",
            tenant_id="00000000-0000-4000-8000-000000000000",
            workspace_id="T01234567",
            permissions=("read",),
            endpoint_allowlist=("/internal/maf/context/read",),
            now=NOW,
            expires_in=timedelta(minutes=5),
        )


def test_create_internal_service_token_fails_closed_with_weak_secret() -> None:
    with pytest.raises(InternalServiceAuthConfigurationError):
        create_internal_service_token(
            secret="too-short",
            service_identity="agent-service",
            tenant_id="00000000-0000-4000-8000-000000000000",
            workspace_id="T01234567",
            permissions=("read",),
            endpoint_allowlist=("/internal/maf/context/read",),
            now=NOW,
            expires_in=timedelta(minutes=5),
        )


def test_create_internal_service_token_fails_closed_with_invalid_claim_inputs() -> None:
    expect_invalid_token_input(tenant_id="not-a-uuid")
    expect_invalid_token_input(workspace_id="")
    expect_invalid_token_input(permissions=())
    expect_invalid_token_input(permissions=("admin",))
    expect_invalid_token_input(endpoint_allowlist=("relative/path",))
    expect_invalid_token_input(expires_in=timedelta(minutes=6))
    expect_invalid_token_input(trace_id="private employee message with spaces")


def test_settings_use_prefixed_internal_service_auth_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET", SECRET)
    monkeypatch.setenv("AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY", "agent-service-test")

    settings = Settings()

    assert settings.internal_service_auth_secret == SECRET
    assert settings.internal_service_identity == "agent-service-test"


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def expect_invalid_token_input(
    *,
    tenant_id: str = "00000000-0000-4000-8000-000000000000",
    workspace_id: str = "T01234567",
    permissions: tuple[str, ...] = ("read",),
    endpoint_allowlist: tuple[str, ...] = ("/internal/maf/context/read",),
    expires_in: timedelta = timedelta(minutes=5),
    trace_id: str | None = None,
) -> None:
    with pytest.raises(InternalServiceAuthConfigurationError):
        create_internal_service_token(
            secret=SECRET,
            service_identity="agent-service",
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            permissions=permissions,
            endpoint_allowlist=endpoint_allowlist,
            now=NOW,
            expires_in=expires_in,
            trace_id=trace_id,
        )
