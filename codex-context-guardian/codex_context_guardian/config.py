from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import tomllib


DEFAULT_HOME = Path(os.environ.get("CODEX_CONTEXT_GUARDIAN_HOME", "~/.codex/context-guardian")).expanduser()


@dataclass(frozen=True)
class GuardianConfig:
    enabled: bool = True
    warning_threshold: float = 70.0
    handoff_threshold: float = 80.0
    monitor_subagents: bool = False
    block_closed_sessions: bool = True
    show_session_start_handoff_notice: bool = True
    max_tail_bytes: int = 1024 * 1024
    git_timeout_seconds: float = 1.5
    log_max_bytes: int = 1024 * 1024


def load_config(home: Path | None = None) -> GuardianConfig:
    home = home or DEFAULT_HOME
    path = home / "config.toml"
    cfg = GuardianConfig()
    if not path.exists():
        return cfg
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return cfg
    section = data.get("context_guardian", data)
    if not isinstance(section, dict):
        return cfg
    values = cfg.__dict__.copy()
    for key in values:
        if key in section:
            values[key] = section[key]
    try:
        loaded = GuardianConfig(**values)
    except TypeError:
        return cfg
    if loaded.warning_threshold < 0 or loaded.handoff_threshold <= loaded.warning_threshold:
        return cfg
    return loaded
