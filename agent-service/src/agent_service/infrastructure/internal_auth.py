from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta


class InternalServiceAuthConfigurationError(RuntimeError):
    """Raised when scoped internal auth is requested without required config."""


MIN_INTERNAL_SERVICE_AUTH_SECRET_LENGTH = 32
MAX_INTERNAL_SERVICE_AUTH_TOKEN_LIFETIME = timedelta(minutes=5)
TRACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
VALID_PERMISSIONS = {"read", "command"}


def create_internal_service_token(
    *,
    secret: str | None,
    service_identity: str,
    tenant_id: str,
    workspace_id: str,
    permissions: Sequence[str],
    endpoint_allowlist: Sequence[str],
    now: datetime | None = None,
    expires_in: timedelta = timedelta(minutes=5),
    trace_id: str | None = None,
) -> str:
    if not secret:
        raise InternalServiceAuthConfigurationError(
            "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET is required for internal service auth"
        )
    if len(secret) < MIN_INTERNAL_SERVICE_AUTH_SECRET_LENGTH:
        raise InternalServiceAuthConfigurationError(
            "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET must be at least 32 characters"
        )
    if len(secret.strip()) < MIN_INTERNAL_SERVICE_AUTH_SECRET_LENGTH:
        raise InternalServiceAuthConfigurationError(
            "AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET must be at least 32 "
            "non-whitespace characters"
        )
    _validate_claim_inputs(
        service_identity=service_identity,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        permissions=permissions,
        endpoint_allowlist=endpoint_allowlist,
        expires_in=expires_in,
        trace_id=trace_id,
    )

    issued_at = now or datetime.now(tz=UTC)
    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=UTC)

    claims: dict[str, object] = {
        "serviceIdentity": service_identity,
        "tenantId": tenant_id,
        "workspaceId": workspace_id,
        "permissions": list(permissions),
        "endpointAllowlist": list(endpoint_allowlist),
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + expires_in).timestamp()),
    }
    if trace_id:
        claims["traceId"] = trace_id

    encoded_claims = _base64url_encode(
        json.dumps(claims, separators=(",", ":")).encode("utf-8")
    )
    signed_part = f"v1.{encoded_claims}"
    signature = _base64url_encode(
        hmac.new(
            secret.strip().encode("utf-8"),
            signed_part.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )
    return f"{signed_part}.{signature}"


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _validate_claim_inputs(
    *,
    service_identity: str,
    tenant_id: str,
    workspace_id: str,
    permissions: Sequence[str],
    endpoint_allowlist: Sequence[str],
    expires_in: timedelta,
    trace_id: str | None,
) -> None:
    try:
        uuid.UUID(tenant_id)
    except ValueError as exc:
        raise InternalServiceAuthConfigurationError("tenant_id must be a UUID") from exc

    if not service_identity.strip():
        raise InternalServiceAuthConfigurationError("service_identity is required")
    if not workspace_id.strip():
        raise InternalServiceAuthConfigurationError("workspace_id is required")
    if not permissions or any(permission not in VALID_PERMISSIONS for permission in permissions):
        raise InternalServiceAuthConfigurationError("permissions must contain read and/or command")
    if not endpoint_allowlist or any(
        not endpoint.startswith("/") for endpoint in endpoint_allowlist
    ):
        raise InternalServiceAuthConfigurationError(
            "endpoint_allowlist must contain absolute paths"
        )
    if expires_in <= timedelta(seconds=0) or expires_in > MAX_INTERNAL_SERVICE_AUTH_TOKEN_LIFETIME:
        raise InternalServiceAuthConfigurationError(
            "expires_in must be greater than zero and at most five minutes"
        )
    if trace_id is not None and not TRACE_ID_PATTERN.fullmatch(trace_id):
        raise InternalServiceAuthConfigurationError("trace_id contains unsupported characters")
