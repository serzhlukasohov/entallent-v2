from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .config import DEFAULT_HOME, GuardianConfig


def log(message: str, home: Path | None = None, config: GuardianConfig | None = None) -> None:
    home = home or DEFAULT_HOME
    config = config or GuardianConfig()
    path = home / "logs" / "guardian.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > config.log_max_bytes:
            path.replace(path.with_suffix(".log.1"))
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        clean = message.replace("\n", " ")[:2000]
        with path.open("a", encoding="utf-8") as f:
            f.write(f"{stamp} {clean}\n")
    except Exception:
        pass
