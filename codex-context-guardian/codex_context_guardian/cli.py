from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .config import DEFAULT_HOME, load_config
from .git_snapshot import project_root
from .handoff import HandoffStore
from .state import SessionStateStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="codex-context-guardian")
    parser.add_argument("--home", default=str(DEFAULT_HOME))
    parser.add_argument("--cwd", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)
    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--home", default=None)
        p.add_argument("--cwd", default=None)

    latest_p = sub.add_parser("latest")
    add_common(latest_p)
    show_p = sub.add_parser("show")
    add_common(show_p)
    status = sub.add_parser("status")
    add_common(status)
    status.add_argument("--session")
    reset = sub.add_parser("reset")
    add_common(reset)
    reset.add_argument("--session")
    args = parser.parse_args(argv)

    home = Path(args.home or str(DEFAULT_HOME)).expanduser()
    root = str(project_root(args.cwd or "."))
    handoffs = HandoffStore(home)
    latest = handoffs.latest_path(root)

    if args.cmd == "latest":
        print(latest if latest.exists() else "")
        return 0 if latest.exists() else 1
    if args.cmd == "show":
        if latest.exists():
            print(latest.read_text(encoding="utf-8"), end="")
            return 0
        print("No Context Guardian handoff for this project.", file=sys.stderr)
        return 1
    if args.cmd == "reset":
        removed = SessionStateStore(home).reset(args.session)
        print(f"Removed {removed} session state file(s).")
        return 0
    if args.cmd == "status":
        config = load_config(home)
        state = SessionStateStore(home).load(args.session or "unknown") if args.session else {}
        print("Context Guardian")
        print(f"Project: {root}")
        print(f"Current session: {args.session or 'unknown'}")
        print(f"State: {state.get('state', 'unknown')}")
        print(f"Context: {state.get('lastUsage', {}).get('usedPercent', 'unknown')}%")
        print(f"Threshold: {config.handoff_threshold:g}%")
        print(f"Latest handoff: {latest if latest.exists() else 'none'}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
