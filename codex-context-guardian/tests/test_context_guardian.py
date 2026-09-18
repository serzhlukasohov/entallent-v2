from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from codex_context_guardian.config import GuardianConfig
from codex_context_guardian.handoff import END, START, HandoffStore, extract_handoff, project_id
from codex_context_guardian.hooks import handle
from codex_context_guardian.rollout_parser import newest_context_usage, sample_from_event
from codex_context_guardian.state import SessionStateStore


def token_event(last: int, window: int = 100, total: int = 999999) -> dict:
    return {
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {"total_tokens": total},
                "last_token_usage": {"total_tokens": last},
                "model_context_window": window,
            },
        },
    }


class GuardianTests(unittest.TestCase):
    def test_context_calculation_ignores_cumulative_total(self):
        sample = sample_from_event(token_event(80, 100, total=1_000_000))
        self.assertIsNotNone(sample)
        self.assertEqual(sample.used_percent, 80)
        self.assertEqual(sample.used_tokens, 80)

    def test_thresholds_and_repeated_warning(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            cfg = home / "config.toml"
            cfg.write_text("[context_guardian]\nwarning_threshold=70\nhandoff_threshold=80\n", encoding="utf-8")
            base = {"session_id": "s1", "cwd": td}
            self.assertEqual(handle("PostToolUse", {**base, **token_event(699, 1000)}, home), {})
            warn = handle("PostToolUse", {**base, **token_event(700, 1000)}, home)
            self.assertIn("additionalContext", warn["hookSpecificOutput"])
            self.assertEqual(handle("PostToolUse", {**base, **token_event(750, 1000)}, home), {})
            handoff = handle("PostToolUse", {**base, **token_event(800, 1000)}, home)
            self.assertIn("HANDOFF REQUIRED", handoff["hookSpecificOutput"]["additionalContext"])
            again = handle("PostToolUse", {**base, **token_event(850, 1000)}, home)
            self.assertIn("HANDOFF REQUIRED", again["hookSpecificOutput"]["additionalContext"])

    def test_rollout_parser_defensive_cases(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rollout.jsonl"
            p.write_text(
                "\n".join([
                    "{bad json",
                    json.dumps(token_event(10, 100)),
                    json.dumps(token_event(80, 100, total=9_000_000)),
                    '{"partial":',
                ]),
                encoding="utf-8",
            )
            sample = newest_context_usage(p)
            self.assertIsNotNone(sample)
            self.assertEqual(sample.used_percent, 80)
            p.write_text(json.dumps(token_event(1, 0)), encoding="utf-8")
            self.assertIsNone(newest_context_usage(p))
            p.write_text(json.dumps({"payload": {"type": "token_count", "info": {}}}), encoding="utf-8")
            self.assertIsNone(newest_context_usage(p))

    def test_state_isolation_and_subagent_isolation(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = {"cwd": td}
            handle("PostToolUse", {**base, "session_id": "a", **token_event(80, 100)}, home)
            self.assertEqual(SessionStateStore(home).load("b")["state"], "NORMAL")
            out = handle("PostToolUse", {**base, "session_id": "parent", "agent_id": "sub", **token_event(99, 100)}, home)
            self.assertEqual(out, {})
            self.assertEqual(SessionStateStore(home).load("parent")["state"], "NORMAL")

    def test_tool_blocking_stop_closed_and_new_session_notice(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = {"session_id": "s1", "cwd": td}
            handle("PostToolUse", {**base, **token_event(80, 100)}, home)
            deny = handle("PreToolUse", {**base, "tool_name": "Bash"}, home)
            self.assertEqual(deny["hookSpecificOutput"]["permissionDecision"], "deny")

            msg = f"{START}\n# Session Handoff\n\n## Objective\nDone\n{END}"
            stop = handle("Stop", {**base, "last_assistant_message": msg}, home)
            self.assertIn("handoff saved", stop["hookSpecificOutput"]["additionalContext"].lower())
            closed = handle("UserPromptSubmit", {**base, "prompt": "continue"}, home)
            self.assertEqual(closed["decision"], "block")
            notice = handle("SessionStart", {"session_id": "s2", "cwd": td}, home)
            self.assertIn("Pending handoff", notice["hookSpecificOutput"]["additionalContext"])

    def test_stop_missing_markers_saves_incomplete_fallback(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            base = {"session_id": "s1", "cwd": td}
            handle("PostToolUse", {**base, **token_event(80, 100)}, home)
            handle("Stop", {**base, "last_assistant_message": "plain fallback"}, home)
            meta = json.loads((HandoffStore(home).project_dir(td) / "latest.json").read_text(encoding="utf-8"))
            self.assertTrue(meta["incomplete"])

    def test_precompact_emergency_non_git_and_spaces(self):
        with tempfile.TemporaryDirectory(prefix="cg path ") as td:
            home = Path(td) / "home"
            out = handle("PreCompact", {"session_id": "s1", "cwd": td, "prompt": "latest request"}, home)
            self.assertEqual(out["decision"], "block")
            latest = HandoffStore(home).latest_path(str(Path(td).resolve()))
            self.assertTrue(latest.exists())
            self.assertIn("EMERGENCY", latest.read_text(encoding="utf-8").upper())

    def test_extract_handoff_and_project_id(self):
        body, incomplete = extract_handoff(f"x{START}\nhello\n{END}y")
        self.assertEqual(body, "hello")
        self.assertFalse(incomplete)
        self.assertIn("-", project_id("/tmp/same/name"))


if __name__ == "__main__":
    unittest.main()
