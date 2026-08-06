from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_SERVICE_",
        extra="ignore",
    )

    service_name: str = "agent-service"
    environment: str = "local"
    log_level: str = "INFO"
    otlp_endpoint: str | None = None
    tracing_enabled: bool = False
    otel_service_name: str = Field(default="agent-service", alias="OTEL_SERVICE_NAME")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
