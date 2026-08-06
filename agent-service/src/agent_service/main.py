from fastapi import FastAPI

from agent_service.api import health_router
from agent_service.infrastructure.settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="enTalent Agent Service",
        version="0.1.0",
        docs_url="/docs" if settings.environment == "local" else None,
        redoc_url=None,
    )
    app.include_router(health_router)
    return app


app = create_app()
