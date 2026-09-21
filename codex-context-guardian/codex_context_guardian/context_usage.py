from __future__ import annotations

from typing import Any

from .config import GuardianConfig
from .rollout_parser import ContextUsageSample, newest_context_usage, sample_from_event


class ContextUsageProvider:
    def sample(self, hook_input: dict[str, Any], config: GuardianConfig) -> ContextUsageSample | None:
        direct = sample_from_event(hook_input)
        if direct:
            return direct
        return newest_context_usage(hook_input.get("transcript_path"), config.max_tail_bytes)
