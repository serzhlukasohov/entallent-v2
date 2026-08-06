from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from agent_service import __version__
from agent_service.infrastructure.settings import Settings, get_settings

router = APIRouter(prefix="/health", tags=["health"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class LivenessResponse(BaseModel):
    status: str
    service: str
    version: str


@router.get("/live", response_model=LivenessResponse)
def live(settings: SettingsDependency) -> LivenessResponse:
    return LivenessResponse(
        status="healthy",
        service=settings.service_name,
        version=__version__,
    )
