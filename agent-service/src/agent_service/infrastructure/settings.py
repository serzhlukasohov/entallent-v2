from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_SERVICE_",
        extra="ignore",
        populate_by_name=True,
    )

    service_name: str = "agent-service"
    environment: str = "local"
    port: int = Field(default=8001, gt=0, lt=65536)
    log_level: str = "INFO"
    otlp_endpoint: str | None = None
    tracing_enabled: bool = False
    otel_service_name: str = Field(
        default="agent-service",
        validation_alias=AliasChoices("AGENT_SERVICE_OTEL_SERVICE_NAME", "OTEL_SERVICE_NAME"),
    )
    internal_service_auth_secret: str | None = None
    internal_service_identity: str = "agent-service"
    internal_api_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AGENT_SERVICE_INTERNAL_API_URL",
            "AGENT_SERVICE_INTERNAL_URL",
        ),
    )
    context_tool_timeout_ms: int = Field(default=2500, gt=0, le=30000)
    runtime_state_backend: Literal["memory", "sqlite"] = "memory"
    runtime_state_sqlite_path: Path = Path("/tmp/agent-service/runtime-state.sqlite3")
    non_local_shadow_enabled: bool = False
    model_provider: Literal["disabled", "openai", "azure_openai"] = "disabled"
    model_name: str | None = None
    model_timeout_ms: int = Field(default=10000, gt=0, le=60000)
    openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("AGENT_SERVICE_OPENAI_API_KEY", "OPENAI_API_KEY"),
    )
    openai_org_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("AGENT_SERVICE_OPENAI_ORG_ID", "OPENAI_ORG_ID"),
    )
    azure_openai_endpoint: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AGENT_SERVICE_AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_ENDPOINT",
        ),
    )
    azure_openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AGENT_SERVICE_AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_API_KEY",
        ),
    )
    azure_openai_api_version: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "AGENT_SERVICE_AZURE_OPENAI_API_VERSION",
            "AZURE_OPENAI_API_VERSION",
        ),
    )

    @model_validator(mode="after")
    def validate_runtime_state_backend(self) -> "Settings":
        if self.non_local_shadow_enabled and self.runtime_state_backend == "memory":
            raise ValueError(
                "process-local runtime state is not allowed when non-local shadow is enabled"
            )
        if self.runtime_state_backend == "sqlite":
            path_text = str(self.runtime_state_sqlite_path).strip()
            if not path_text or path_text == ":memory:":
                raise ValueError("durable sqlite runtime state path is required")
            if not self.runtime_state_sqlite_path.is_absolute():
                raise ValueError("runtime_state_sqlite_path must be absolute")
            if self.runtime_state_sqlite_path.exists() and self.runtime_state_sqlite_path.is_dir():
                raise ValueError("runtime_state_sqlite_path must be a file path")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
