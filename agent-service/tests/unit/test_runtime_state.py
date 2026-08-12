import sqlite3
from pathlib import Path

import pytest

from agent_service.infrastructure.runtime_state import (
    InMemoryRuntimeStateStore,
    RuntimeStateConfigurationError,
    SessionIdentity,
    SqliteRuntimeStateStore,
    create_runtime_state_store,
    create_session_key,
)
from agent_service.infrastructure.settings import Settings


def test_settings_reject_memory_backend_for_non_local_shadow() -> None:
    with pytest.raises(ValueError, match="process-local runtime state"):
        Settings(non_local_shadow_enabled=True, runtime_state_backend="memory")


def test_settings_allow_sqlite_backend_for_non_local_shadow(tmp_path: Path) -> None:
    settings = Settings(
        non_local_shadow_enabled=True,
        runtime_state_backend="sqlite",
        runtime_state_sqlite_path=tmp_path / "runtime-state.sqlite3",
    )

    assert settings.runtime_state_backend == "sqlite"
    assert settings.non_local_shadow_enabled is True


def test_settings_reject_sqlite_memory_relative_or_directory_paths(tmp_path: Path) -> None:
    invalid_paths = [
        Path(":memory:"),
        Path("relative-runtime-state.sqlite3"),
        tmp_path,
    ]

    for invalid_path in invalid_paths:
        with pytest.raises(ValueError):
            Settings(
                non_local_shadow_enabled=True,
                runtime_state_backend="sqlite",
                runtime_state_sqlite_path=invalid_path,
            )


def test_session_key_includes_required_thread_scope() -> None:
    key = create_session_key(
        SessionIdentity(
            workspace_id="workspace-demo",
            user_id="user-demo",
            external_conversation_id="conversation-demo",
            thread_id="thread-demo",
        )
    )

    assert key == (
        "workspace=workspace-demo|user=user-demo|"
        "conversation=conversation-demo|thread=thread-demo"
    )


def test_session_key_includes_required_dm_scope() -> None:
    key = create_session_key(
        SessionIdentity(
            workspace_id="workspace-demo",
            user_id="user-demo",
            external_conversation_id="conversation-demo",
            dm_user_id="dm-user-demo",
        )
    )

    assert key == (
        "workspace=workspace-demo|user=user-demo|"
        "conversation=conversation-demo|dm=dm-user-demo"
    )


def test_session_key_rejects_missing_or_ambiguous_thread_dm_scope() -> None:
    with pytest.raises(RuntimeStateConfigurationError):
        create_session_key(
            SessionIdentity(
                workspace_id="workspace-demo",
                user_id="user-demo",
                external_conversation_id="conversation-demo",
            )
        )

    with pytest.raises(RuntimeStateConfigurationError):
        create_session_key(
            SessionIdentity(
                workspace_id="workspace-demo",
                user_id="user-demo",
                external_conversation_id="conversation-demo",
                thread_id="thread-demo",
                dm_user_id="dm-user-demo",
            )
        )


def test_session_key_rejects_blank_identity_fields() -> None:
    invalid_identities = [
        SessionIdentity(
            workspace_id=" ",
            user_id="user-demo",
            external_conversation_id="conversation-demo",
            thread_id="thread-demo",
        ),
        SessionIdentity(
            workspace_id="workspace-demo",
            user_id="",
            external_conversation_id="conversation-demo",
            thread_id="thread-demo",
        ),
        SessionIdentity(
            workspace_id="workspace-demo",
            user_id="user-demo",
            external_conversation_id=" ",
            thread_id="thread-demo",
        ),
    ]

    for identity in invalid_identities:
        with pytest.raises(RuntimeStateConfigurationError):
            create_session_key(identity)


def test_sqlite_runtime_state_survives_new_store_instance(tmp_path: Path) -> None:
    db_path = tmp_path / "runtime-state.sqlite3"
    first_store = SqliteRuntimeStateStore(db_path)
    first_store.set_session("session-1", {"checkpoint": "checkpoint-1"})
    first_store.set_checkpoint("checkpoint-1", {"step": 3})

    second_store = SqliteRuntimeStateStore(db_path)

    assert second_store.get_session("session-1") == {"checkpoint": "checkpoint-1"}
    assert second_store.get_checkpoint("checkpoint-1") == {"step": 3}


def test_sqlite_runtime_state_rejects_blank_keys_and_non_standard_json(
    tmp_path: Path,
) -> None:
    store = SqliteRuntimeStateStore(tmp_path / "runtime-state.sqlite3")

    with pytest.raises(RuntimeStateConfigurationError):
        store.set_session(" ", {"checkpoint": "checkpoint-1"})
    with pytest.raises(RuntimeStateConfigurationError):
        store.set_checkpoint(" ", {"step": 1})
    with pytest.raises(RuntimeStateConfigurationError):
        store.set_session("session-1", {"score": float("nan")})


def test_sqlite_runtime_state_wraps_corrupt_payloads(tmp_path: Path) -> None:
    db_path = tmp_path / "runtime-state.sqlite3"
    store = SqliteRuntimeStateStore(db_path)

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO runtime_sessions (session_key, value_json) VALUES (?, ?)",
            ("session-1", "{not-json"),
        )

    with pytest.raises(RuntimeStateConfigurationError, match="invalid JSON"):
        store.get_session("session-1")


def test_sqlite_runtime_state_creates_private_file(tmp_path: Path) -> None:
    db_path = tmp_path / "private" / "runtime-state.sqlite3"

    SqliteRuntimeStateStore(db_path)

    assert db_path.stat().st_mode & 0o077 == 0


def test_memory_backend_is_process_local_and_local_only(tmp_path: Path) -> None:
    settings = Settings(
        non_local_shadow_enabled=False,
        runtime_state_backend="memory",
        runtime_state_sqlite_path=tmp_path / "unused.sqlite3",
    )
    store = create_runtime_state_store(settings)
    assert isinstance(store, InMemoryRuntimeStateStore)

    store.set_session("session-1", {"checkpoint": "checkpoint-1"})

    fresh_store = create_runtime_state_store(settings)
    assert isinstance(fresh_store, InMemoryRuntimeStateStore)
    assert fresh_store.get_session("session-1") is None


def test_memory_backend_rejects_blank_keys_and_non_standard_json(tmp_path: Path) -> None:
    settings = Settings(
        non_local_shadow_enabled=False,
        runtime_state_backend="memory",
        runtime_state_sqlite_path=tmp_path / "unused.sqlite3",
    )
    store = create_runtime_state_store(settings)

    with pytest.raises(RuntimeStateConfigurationError):
        store.set_session(" ", {"checkpoint": "checkpoint-1"})
    with pytest.raises(RuntimeStateConfigurationError):
        store.set_checkpoint(" ", {"step": 1})
    with pytest.raises(RuntimeStateConfigurationError):
        store.set_checkpoint("checkpoint-1", {"score": float("inf")})


def test_factory_selects_sqlite_for_non_local_shadow(tmp_path: Path) -> None:
    settings = Settings(
        non_local_shadow_enabled=True,
        runtime_state_backend="sqlite",
        runtime_state_sqlite_path=tmp_path / "runtime-state.sqlite3",
    )

    store = create_runtime_state_store(settings)

    assert isinstance(store, SqliteRuntimeStateStore)
    store.set_session("session-1", {"checkpoint": "checkpoint-1"})
    assert store.get_session("session-1") == {"checkpoint": "checkpoint-1"}
