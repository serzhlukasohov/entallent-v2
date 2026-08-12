import sqlite3
from urllib.parse import urlparse
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agent_service import __version__
from agent_service.infrastructure.runtime_state import (
    RuntimeStateConfigurationError,
    create_runtime_state_store,
)
from agent_service.infrastructure.internal_auth import MIN_INTERNAL_SERVICE_AUTH_SECRET_LENGTH
from agent_service.infrastructure.settings import Settings, get_settings

router = APIRouter(prefix="/health", tags=["health"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class LivenessResponse(BaseModel):
    status: str
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: str
    service: str
    version: str
    checks: dict[str, str]
    message: str | None = None


@router.get("/live", response_model=LivenessResponse)
def live(settings: SettingsDependency) -> LivenessResponse:
    return LivenessResponse(
        status="healthy",
        service=settings.service_name,
        version=__version__,
    )


@router.get("/ready", response_model=ReadinessResponse, response_model_exclude_none=True)
def ready(settings: SettingsDependency) -> ReadinessResponse | JSONResponse:
    checks = {
        "settings": "ok",
        "runtimeState": "ok",
        "internalAuth": "ok",
    }

    settings_check = validate_settings_readiness(settings)
    if settings_check["internalAuth"] != "ok":
        checks["internalAuth"] = "failed"
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": settings.service_name,
                "version": __version__,
                "checks": checks,
                "message": "Readiness dependency check failed.",
            },
        )

    try:
        runtime_state = create_runtime_state_store(settings)
        runtime_state.get_session("__readiness_missing_session__")
    except (RuntimeStateConfigurationError, OSError, sqlite3.Error):
        checks["runtimeState"] = "failed"
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": settings.service_name,
                "version": __version__,
                "checks": checks,
                "message": "Readiness dependency check failed.",
            },
        )

    return ReadinessResponse(
        status="ready",
        service=settings.service_name,
        version=__version__,
        checks=checks,
    )


def validate_settings_readiness(settings: Settings) -> dict[str, str]:
    if settings.internal_api_url is None:
        return {"internalAuth": "ok"}

    if not is_http_url(settings.internal_api_url):
        return {"internalAuth": "failed"}

    if (
        settings.internal_service_auth_secret is None
        or len(settings.internal_service_auth_secret.strip())
        < MIN_INTERNAL_SERVICE_AUTH_SECRET_LENGTH
    ):
        return {"internalAuth": "failed"}

    return {"internalAuth": "ok"}


def is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
