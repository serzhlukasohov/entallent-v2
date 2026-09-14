#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import stat
import sys
from datetime import datetime, timezone
from typing import Any


ROOT = Path(__file__).resolve().parent
HOME = Path(os.environ.get("CODEX_CONTEXT_GUARDIAN_HOME", "~/.codex/context-guardian")).expanduser()
CODEX_HOME = Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser()
PACKAGE = HOME / "package"
HOOKS_JSON = CODEX_HOME / "hooks.json"
TAG = "codex-context-guardian"


def load_hooks() -> dict[str, Any]:
    if not HOOKS_JSON.exists():
        return {"hooks": {}}
    return json.loads(HOOKS_JSON.read_text(encoding="utf-8"))


def command(event: str) -> str:
    return f'python3 "{PACKAGE / "hooks" / "guardian.py"}" {event}'


def hook_entry(event: str) -> dict[str, Any]:
    status = {
        "PreCompact": "Creating emergency context handoff...",
        "Stop": "Saving context handoff...",
    }.get(event, "Checking context guardian...")
    return {
        "hooks": [
            {
                "type": "command",
                "command": command(event),
                "timeout": 5,
                "statusMessage": status,
            }
        ]
    }


def merge_hooks(data: dict[str, Any]) -> dict[str, Any]:
    hooks = data.setdefault("hooks", {})
    for event in ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact", "Stop"]:
        entries = hooks.setdefault(event, [])
        entries[:] = [e for e in entries if TAG not in json.dumps(e) and str(PACKAGE) not in json.dumps(e)]
        entry = hook_entry(event)
        if event == "SessionStart":
            entry["matcher"] = "startup|resume|clear"
        entries.append(entry)
    return data


def main() -> int:
    HOME.mkdir(parents=True, exist_ok=True)
    if PACKAGE.exists():
        shutil.rmtree(PACKAGE)
    shutil.copytree(ROOT, PACKAGE, ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache"))

    config = HOME / "config.toml"
    if not config.exists():
        shutil.copyfile(PACKAGE / "config.example.toml", config)

    bin_dir = HOME / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    launcher = bin_dir / "codex-context-guardian"
    launcher.write_text(
        f'#!/bin/sh\nPYTHONPATH="{PACKAGE}:${{PYTHONPATH:-}}" exec python3 -m codex_context_guardian "$@"\n',
        encoding="utf-8",
    )
    launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    data = load_hooks()
    HOOKS_JSON.parent.mkdir(parents=True, exist_ok=True)
    if HOOKS_JSON.exists():
        first_backup = HOOKS_JSON.with_suffix(".json.context-guardian.bak")
        if not first_backup.exists():
            shutil.copyfile(HOOKS_JSON, first_backup)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.copyfile(HOOKS_JSON, HOOKS_JSON.with_suffix(f".json.context-guardian.{stamp}.bak"))
    HOOKS_JSON.write_text(json.dumps(merge_hooks(data), indent=2) + "\n", encoding="utf-8")

    print(f"Installed package: {PACKAGE}")
    print(f"Merged hooks: {HOOKS_JSON}")
    print(f"Config: {config}")
    print(f"CLI: {launcher}")
    print("Codex may ask you to trust the new hook commands on next session start.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
