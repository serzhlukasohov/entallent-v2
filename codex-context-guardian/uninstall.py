#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
from typing import Any


HOME = Path(os.environ.get("CODEX_CONTEXT_GUARDIAN_HOME", "~/.codex/context-guardian")).expanduser()
CODEX_HOME = Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser()
PACKAGE = HOME / "package"
HOOKS_JSON = CODEX_HOME / "hooks.json"


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    remove_files = "--remove-files" in argv
    if HOOKS_JSON.exists():
        data: dict[str, Any] = json.loads(HOOKS_JSON.read_text(encoding="utf-8"))
        hooks = data.get("hooks", {})
        for event, entries in list(hooks.items()):
            hooks[event] = [e for e in entries if str(PACKAGE) not in json.dumps(e)]
            if not hooks[event]:
                del hooks[event]
        shutil.copyfile(HOOKS_JSON, HOOKS_JSON.with_suffix(".json.context-guardian-uninstall.bak"))
        HOOKS_JSON.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(f"Removed Context Guardian hooks from {HOOKS_JSON}")
    if remove_files:
        shutil.rmtree(HOME, ignore_errors=True)
        print(f"Removed {HOME}")
    else:
        print(f"Kept state, config, logs, and handoffs under {HOME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
