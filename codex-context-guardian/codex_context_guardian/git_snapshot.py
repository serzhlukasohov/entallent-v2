from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any


def _run(cwd: Path, timeout: float, *args: str) -> str:
    try:
        cp = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
    except Exception:
        return ""
    return cp.stdout.strip()


def project_root(cwd: str | None, timeout: float = 1.5) -> Path:
    base = Path(cwd or ".").expanduser().resolve()
    root = _run(base, timeout, "rev-parse", "--show-toplevel")
    return Path(root).resolve() if root else base


def git_snapshot(cwd: str | None, timeout: float = 1.5) -> dict[str, Any]:
    root = project_root(cwd, timeout)
    inside = bool(_run(root, timeout, "rev-parse", "--is-inside-work-tree"))
    snap: dict[str, Any] = {"cwd": str(Path(cwd or ".").expanduser().resolve()), "projectRoot": str(root), "isGit": inside}
    if not inside:
        return snap
    snap["branch"] = _run(root, timeout, "branch", "--show-current") or _run(root, timeout, "rev-parse", "--short", "HEAD")
    snap["statusShort"] = _run(root, timeout, "status", "--short")[:12000]
    snap["diffStat"] = _run(root, timeout, "diff", "--stat")[:12000]
    snap["diffNameOnly"] = _run(root, timeout, "diff", "--name-only")[:12000]
    return snap
