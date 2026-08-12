from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

from agent_service.infrastructure.settings import Settings


class RuntimeStateConfigurationError(RuntimeError):
    """Raised when runtime state identity or backend configuration is invalid."""


@dataclass(frozen=True)
class SessionIdentity:
    workspace_id: str
    user_id: str
    external_conversation_id: str
    thread_id: str | None = None
    dm_user_id: str | None = None


class RuntimeStateStore(Protocol):
    def get_session(self, session_key: str) -> dict[str, object] | None: ...

    def set_session(self, session_key: str, value: dict[str, object]) -> None: ...

    def get_checkpoint(self, checkpoint_key: str) -> dict[str, object] | None: ...

    def set_checkpoint(self, checkpoint_key: str, value: dict[str, object]) -> None: ...


def create_session_key(identity: SessionIdentity) -> str:
    workspace_id = _require_non_blank("workspace_id", identity.workspace_id)
    user_id = _require_non_blank("user_id", identity.user_id)
    external_conversation_id = _require_non_blank(
        "external_conversation_id",
        identity.external_conversation_id,
    )
    thread_id = _normalize_optional(identity.thread_id)
    dm_user_id = _normalize_optional(identity.dm_user_id)

    if bool(thread_id) == bool(dm_user_id):
        raise RuntimeStateConfigurationError(
            "exactly one of thread_id or dm_user_id is required for session scope"
        )

    scope_key = "thread" if thread_id else "dm"
    scope_value = thread_id or dm_user_id
    if scope_value is None:
        raise RuntimeStateConfigurationError("session scope value is required")

    return "|".join(
        [
            f"workspace={_encode_key_part(workspace_id)}",
            f"user={_encode_key_part(user_id)}",
            f"conversation={_encode_key_part(external_conversation_id)}",
            f"{scope_key}={_encode_key_part(scope_value)}",
        ]
    )


def create_runtime_state_store(settings: Settings) -> RuntimeStateStore:
    if settings.non_local_shadow_enabled and settings.runtime_state_backend == "memory":
        raise RuntimeStateConfigurationError(
            "process-local runtime state is not allowed when non-local shadow is enabled"
        )

    if settings.runtime_state_backend == "memory":
        return InMemoryRuntimeStateStore()

    if settings.runtime_state_backend == "sqlite":
        return SqliteRuntimeStateStore(settings.runtime_state_sqlite_path)

    raise RuntimeStateConfigurationError(
        f"unsupported runtime state backend: {settings.runtime_state_backend}"
    )


class InMemoryRuntimeStateStore:
    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, object]] = {}
        self._checkpoints: dict[str, dict[str, object]] = {}

    def get_session(self, session_key: str) -> dict[str, object] | None:
        key = _require_non_blank("session_key", session_key)
        return _copy_json_object(self._sessions.get(key))

    def set_session(self, session_key: str, value: dict[str, object]) -> None:
        key = _require_non_blank("session_key", session_key)
        self._sessions[key] = _copy_json_object(value) or {}

    def get_checkpoint(self, checkpoint_key: str) -> dict[str, object] | None:
        key = _require_non_blank("checkpoint_key", checkpoint_key)
        return _copy_json_object(self._checkpoints.get(key))

    def set_checkpoint(self, checkpoint_key: str, value: dict[str, object]) -> None:
        key = _require_non_blank("checkpoint_key", checkpoint_key)
        self._checkpoints[key] = _copy_json_object(value) or {}


class SqliteRuntimeStateStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.db_path.parent, 0o700)
        if not self.db_path.exists():
            self.db_path.touch(mode=0o600)
        os.chmod(self.db_path, 0o600)
        self._initialize()

    def get_session(self, session_key: str) -> dict[str, object] | None:
        key = _require_non_blank("session_key", session_key)
        return self._get("runtime_sessions", "session_key", key)

    def set_session(self, session_key: str, value: dict[str, object]) -> None:
        key = _require_non_blank("session_key", session_key)
        self._set("runtime_sessions", "session_key", key, value)

    def get_checkpoint(self, checkpoint_key: str) -> dict[str, object] | None:
        return self._get(
            "runtime_checkpoints",
            "checkpoint_key",
            _require_non_blank("checkpoint_key", checkpoint_key),
        )

    def set_checkpoint(self, checkpoint_key: str, value: dict[str, object]) -> None:
        self._set(
            "runtime_checkpoints",
            "checkpoint_key",
            _require_non_blank("checkpoint_key", checkpoint_key),
            value,
        )

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runtime_sessions (
                    session_key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runtime_checkpoints (
                    checkpoint_key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _get(self, table: str, key_column: str, key: str) -> dict[str, object] | None:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT value_json FROM {table} WHERE {key_column} = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None

        try:
            value = json.loads(row[0])
        except json.JSONDecodeError as exc:
            raise RuntimeStateConfigurationError("runtime state payload is invalid JSON") from exc
        if not isinstance(value, dict):
            raise RuntimeStateConfigurationError("runtime state payload must decode to an object")
        return value

    def _set(self, table: str, key_column: str, key: str, value: dict[str, object]) -> None:
        value_json = _json_dumps_object(value)
        with self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {table} ({key_column}, value_json, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT({key_column}) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (key, value_json),
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)


def _require_non_blank(field_name: str, value: object) -> str:
    if not isinstance(value, str):
        raise RuntimeStateConfigurationError(f"{field_name} must be a string")
    normalized = value.strip()
    if not normalized:
        raise RuntimeStateConfigurationError(f"{field_name} is required for session key")
    return normalized


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _encode_key_part(value: str) -> str:
    return quote(value, safe="-._~")


def _copy_json_object(value: dict[str, object] | None) -> dict[str, object] | None:
    if value is None:
        return None
    copied = json.loads(_json_dumps_object(value))
    if not isinstance(copied, dict):
        raise RuntimeStateConfigurationError("runtime state payload must be a JSON object")
    return copied


def _json_dumps_object(value: dict[str, object]) -> str:
    try:
        return json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":"))
    except ValueError as exc:
        raise RuntimeStateConfigurationError("runtime state payload must be standard JSON") from exc
