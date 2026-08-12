from fastapi import FastAPI

from agent_service.api import health_router, runtime_router
from agent_service.infrastructure.settings import get_settings


def create_app() -> FastAPI:
    get_settings()
    app = FastAPI(
        title="enTalent Agent Service",
        version="0.1.0",
        docs_url=None,
        openapi_url=None,
        redoc_url=None,
    )
    app.include_router(health_router)
    app.include_router(runtime_router)
    return app
