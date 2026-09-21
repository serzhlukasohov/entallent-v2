from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ContextUsageSample:
    used_tokens: int
    context_window: int
    used_percent: float
    source: str


def _tail_lines(path: Path, max_bytes: int) -> list[str]:
    size = path.stat().st_size
    start = max(0, size - max_bytes)
    with path.open("rb") as f:
        f.seek(start)
        data = f.read(max_bytes)
    text = data.decode("utf-8", errors="ignore")
    lines = text.splitlines()
    if start > 0 and lines:
        lines = lines[1:]
    return lines


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _sample_from_mapping(obj: dict[str, Any], source: str) -> ContextUsageSample | None:
    info = obj.get("info") if isinstance(obj.get("info"), dict) else obj
    last = info.get("last_token_usage") if isinstance(info, dict) else None
    window = info.get("model_context_window") if isinstance(info, dict) else None
    if not isinstance(last, dict):
        return None
    used_tokens = _int(last.get("total_tokens"))
    context_window = _int(window)
    if used_tokens is None or context_window is None:
        return None
    if used_tokens < 0 or context_window <= 0:
        return None
    if used_tokens > context_window * 4:
        return None
    return ContextUsageSample(
        used_tokens=used_tokens,
        context_window=context_window,
        used_percent=(used_tokens / context_window) * 100,
        source=source,
    )


def sample_from_event(obj: dict[str, Any]) -> ContextUsageSample | None:
    sample = _sample_from_mapping(obj, "hook_input")
    if sample:
        return sample
    payload = obj.get("payload")
    if isinstance(payload, dict):
        if payload.get("type") == "token_count":
            sample = _sample_from_mapping(payload, "event_msg.payload")
            if sample:
                return sample
        sample = _sample_from_mapping(payload, "payload")
        if sample:
            return sample
    return None


def newest_context_usage(path: str | Path | None, max_bytes: int = 1024 * 1024) -> ContextUsageSample | None:
    if not path:
        return None
    p = Path(path)
    if not p.exists() or not p.is_file():
        return None
    for line in reversed(_tail_lines(p, max_bytes)):
        if "last_token_usage" not in line or "model_context_window" not in line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        sample = sample_from_event(obj)
        if sample:
            return sample
    return None
