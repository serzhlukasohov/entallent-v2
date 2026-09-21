from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any

from .config import DEFAULT_HOME

START = "<!-- CODEX_HANDOFF_START -->"
END = "<!-- CODEX_HANDOFF_END -->"


def project_id(project_root: str) -> str:
    root = str(Path(project_root).expanduser().resolve())
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", Path(root).name).strip("-") or "project"
    digest = hashlib.sha256(root.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}"


def extract_handoff(message: str) -> tuple[str, bool]:
    if START in message and END in message:
        body = message.split(START, 1)[1].split(END, 1)[0].strip()
        if body:
            return body, False
    return (message or "").strip(), True


class HandoffStore:
    def __init__(self, home: Path = DEFAULT_HOME):
        self.home = home

    def project_dir(self, project_root: str) -> Path:
        return self.home / "handoffs" / project_id(project_root)

    def latest_path(self, project_root: str) -> Path:
        return self.project_dir(project_root) / "latest.md"

    def has_pending(self, project_root: str) -> bool:
        meta = self.project_dir(project_root) / "latest.json"
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            return data.get("status") == "pending" and self.latest_path(project_root).exists()
        except Exception:
            return self.latest_path(project_root).exists()

    def save(self, handoff: str, metadata: dict[str, Any], incomplete: bool = False) -> dict[str, str]:
        project_root = metadata.get("projectRoot") or metadata.get("cwd") or "."
        target_dir = self.project_dir(project_root)
        target_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
        session = metadata.get("sessionId", "unknown")
        safe_session = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(session))
        path = target_dir / f"{stamp}_{safe_session}.md"
        text = handoff.strip() + "\n"
        path.write_text(text, encoding="utf-8")
        shutil.copyfile(path, target_dir / "latest.md")
        meta = dict(metadata)
        meta.update({"createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "pending", "incomplete": incomplete, "path": str(path), "latest": str(target_dir / "latest.md")})
        (target_dir / f"{stamp}_{safe_session}.json").write_text(json.dumps(meta, indent=2, sort_keys=True), encoding="utf-8")
        (target_dir / "latest.json").write_text(json.dumps(meta, indent=2, sort_keys=True), encoding="utf-8")
        return {"path": str(path), "latest": str(target_dir / "latest.md"), "metadata": str(target_dir / "latest.json")}


def emergency_handoff(metadata: dict[str, Any]) -> str:
    snapshot = metadata.get("snapshot", {})
    return "\n".join([
        "# Session Handoff",
        "",
        "## Objective",
        "Continue the task that was active when Codex was about to compact context.",
        "",
        "## Current User Request",
        metadata.get("latestUserRequest") or "Unknown from deterministic hook metadata.",
        "",
        "## Context",
        "Context Guardian missed the normal handoff threshold and created this emergency handoff from hook metadata only.",
        "",
        "## Current State",
        "The previous session has been frozen. The repository may be in an intermediate state.",
        "",
        "## Git / Working Tree State",
        f"Branch: {snapshot.get('branch', 'unknown')}",
        "",
        "Changed files:",
        snapshot.get("diffNameOnly") or snapshot.get("statusShort") or "none recorded",
        "",
        "Diff stat:",
        snapshot.get("diffStat") or "not available",
        "",
        "## Tests and Validation",
        "Unknown. Do not assume tests passed.",
        "",
        "## Next Steps",
        "1. Read this handoff and inspect the current working tree before continuing.",
        "2. Determine the intended task from changed files and recent explicit user input.",
        "3. Continue in a new Codex session with a clean context window.",
        "",
        "## Do Not Repeat",
        "Do not load the full previous transcript unless this emergency handoff is insufficient.",
        "",
        "## Useful References",
        f"Transcript path: {metadata.get('transcriptPath', 'unknown')}",
        f"Project root: {metadata.get('projectRoot', 'unknown')}",
        "",
        "## Continuation Instruction",
        "Continue from this emergency handoff. Start by inspecting the listed changed files and reconstruct only the missing details needed to proceed.",
    ])
