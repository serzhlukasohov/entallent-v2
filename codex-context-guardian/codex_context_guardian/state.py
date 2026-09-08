from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from .config import DEFAULT_HOME

NORMAL = "NORMAL"
WARNING = "WARNING"
HANDOFF_REQUIRED = "HANDOFF_REQUIRED"
HANDOFF_RENDERING = "HANDOFF_RENDERING"
HANDOFF_SAVED = "HANDOFF_SAVED"
SESSION_CLOSED = "SESSION_CLOSED"
FROZEN_STATES = {HANDOFF_REQUIRED, HANDOFF_RENDERING, HANDOFF_SAVED, SESSION_CLOSED}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class SessionStateStore:
    home: Path = DEFAULT_HOME

    def path(self, session_id: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in session_id or "unknown")
        return self.home / "state" / f"{safe}.json"

    def load(self, session_id: str) -> dict[str, Any]:
        path = self.path(session_id)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"sessionId": session_id, "state": NORMAL, "createdAt": now(), "warningEmitted": False}

    def save(self, session_id: str, state: dict[str, Any]) -> None:
        path = self.path(session_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        state["sessionId"] = session_id
        state["updatedAt"] = now()
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(path)

    def reset(self, session_id: str | None = None) -> int:
        state_dir = self.home / "state"
        if not state_dir.exists():
            return 0
        paths = [self.path(session_id)] if session_id else list(state_dir.glob("*.json"))
        removed = 0
        for path in paths:
            try:
                path.unlink()
                removed += 1
            except FileNotFoundError:
                pass
        return removed
