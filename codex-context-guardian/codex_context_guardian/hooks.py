from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .config import DEFAULT_HOME, GuardianConfig, load_config
from .context_usage import ContextUsageProvider
from .git_snapshot import git_snapshot, project_root
from .handoff import HandoffStore, emergency_handoff, extract_handoff
from .logging import log
from .state import FROZEN_STATES, HANDOFF_REQUIRED, HANDOFF_RENDERING, SESSION_CLOSED, WARNING, SessionStateStore


DENIAL = (
    "Context Guardian has frozen this session because the handoff threshold was reached. "
    "No additional task work is allowed. Produce the session handoff and stop."
)


def hook_output(event: str, context: str = "", system: str = "CONTEXT_GUARDIAN") -> dict[str, Any]:
    out: dict[str, Any] = {"systemMessage": system}
    if context:
        out["hookSpecificOutput"] = {"hookEventName": event, "additionalContext": context}
    return out


def deny_tool(event: str = "PreToolUse") -> dict[str, Any]:
    return {
        "systemMessage": DENIAL,
        "hookSpecificOutput": {"hookEventName": event, "permissionDecision": "deny"},
    }


def block_prompt(message: str) -> dict[str, Any]:
    return {"decision": "block", "reason": message, "systemMessage": message}


def _is_subagent(data: dict[str, Any], config: GuardianConfig) -> bool:
    if config.monitor_subagents:
        return False
    agent_type = str(data.get("agent_type") or "").lower()
    if agent_type and agent_type not in {"primary", "main", "root"}:
        return True
    return bool(data.get("agent_id") and not agent_type)


def _session_id(data: dict[str, Any]) -> str:
    return str(data.get("session_id") or data.get("thread_id") or "unknown")


def _metadata(data: dict[str, Any], config: GuardianConfig, usage: Any | None = None) -> dict[str, Any]:
    snap = git_snapshot(data.get("cwd"), config.git_timeout_seconds)
    meta = {
        "sessionId": _session_id(data),
        "cwd": snap.get("cwd"),
        "projectRoot": snap.get("projectRoot"),
        "model": data.get("model"),
        "transcriptPath": data.get("transcript_path"),
        "snapshot": snap,
    }
    if usage:
        meta.update({"contextUsedPercent": round(usage.used_percent, 2), "contextTokens": usage.used_tokens, "contextWindow": usage.context_window})
    return meta


def _handoff_instruction(meta: dict[str, Any]) -> str:
    snap = meta.get("snapshot", {})
    latest = HandoffStore().latest_path(meta["projectRoot"])
    return f"""CONTEXT GUARDIAN: HANDOFF REQUIRED.

Current context usage: {meta.get('contextUsedPercent', 'unknown')}%.
Context tokens: {meta.get('contextTokens', 'unknown')} / {meta.get('contextWindow', 'unknown')}.

Stop the original task immediately.

Do not call any more tools.
Do not edit application code.
Do not run tests.
Do not inspect additional files.
Do not continue implementation.

Your only remaining responsibility in this session is to produce the English session handoff using the exact marker protocol below. After emitting the handoff, end your response.

Persist target after Stop hook:
{latest}

Deterministic project snapshot:
- cwd: {meta.get('cwd')}
- project root: {meta.get('projectRoot')}
- session id: {meta.get('sessionId')}
- branch: {snap.get('branch', 'non-git or unknown')}
- git status --short:
{snap.get('statusShort') or '(none or unavailable)'}
- git diff --stat:
{snap.get('diffStat') or '(none or unavailable)'}
- git diff --name-only:
{snap.get('diffNameOnly') or '(none or unavailable)'}

Required final response:
<!-- CODEX_HANDOFF_START -->
# Session Handoff

## Objective

## Current User Request

## Context

## What Has Been Completed

## Current State

## Files Changed

## Important Decisions

## Discoveries

## Failed Approaches

## Tests and Validation

## Git / Working Tree State

## Open Questions

## Next Steps

## Do Not Repeat

## Useful References

## Continuation Instruction
<!-- CODEX_HANDOFF_END -->"""


def _evaluate_context(event: str, data: dict[str, Any], config: GuardianConfig, store: SessionStateStore) -> dict[str, Any]:
    if _is_subagent(data, config):
        return {}
    session_id = _session_id(data)
    state = store.load(session_id)
    if state.get("state") in FROZEN_STATES:
        return hook_output(event, _handoff_instruction(state.get("metadata", _metadata(data, config))))
    usage = ContextUsageProvider().sample(data, config)
    if not usage:
        log(f"parser failure or missing context sample session={session_id}", config=config)
        return {}
    state["lastUsage"] = {"usedPercent": round(usage.used_percent, 2), "usedTokens": usage.used_tokens, "contextWindow": usage.context_window, "source": usage.source}
    if usage.used_percent >= config.handoff_threshold:
        meta = _metadata(data, config, usage)
        state["state"] = HANDOFF_REQUIRED
        state["metadata"] = meta
        store.save(session_id, state)
        log(f"handoff threshold crossed session={session_id} used={usage.used_percent:.2f}", config=config)
        return hook_output(event, _handoff_instruction(meta))
    if usage.used_percent >= config.warning_threshold and not state.get("warningEmitted"):
        state["state"] = WARNING
        state["warningEmitted"] = True
        store.save(session_id, state)
        log(f"warning threshold crossed session={session_id} used={usage.used_percent:.2f}", config=config)
        return hook_output(event, f"""[CONTEXT GUARDIAN]

Current context usage: {usage.used_percent:.1f}%.
Context pressure is increasing.

Continue the current task normally, but avoid redundant file reads, unnecessarily large tool outputs, unrelated exploration, and side quests. Keep important decisions explicit.

A mandatory handoff will occur at {config.handoff_threshold:g}%.""")
    store.save(session_id, state)
    return {}


def handle(event: str, data: dict[str, Any], home: Path = DEFAULT_HOME) -> dict[str, Any]:
    config = load_config(home)
    if not config.enabled:
        return {}
    store = SessionStateStore(home)
    session_id = _session_id(data)
    state = store.load(session_id)

    if event == "SessionStart":
        root = project_root(data.get("cwd"), config.git_timeout_seconds)
        if config.show_session_start_handoff_notice and HandoffStore(home).has_pending(str(root)):
            log(f"session started with pending handoff session={session_id}", home, config)
            return hook_output(event, f"""[CONTEXT GUARDIAN]

A previous Codex session for this project was stopped because its context window reached the configured handoff threshold.

Pending handoff:
{HandoffStore(home).latest_path(str(root))}

If the user asks to continue or resume the previous task, read this handoff before doing anything else.
Do not load the previous full conversation transcript.""")
        log(f"session started session={session_id}", home, config)
        return {}

    if event == "PreToolUse" and state.get("state") in FROZEN_STATES:
        log(f"tool blocked session={session_id} tool={data.get('tool_name')}", home, config)
        return deny_tool(event)

    if event == "UserPromptSubmit" and config.block_closed_sessions and state.get("state") == SESSION_CLOSED:
        latest = state.get("lastHandoffPath") or state.get("metadata", {}).get("latest")
        msg = f"""This Codex session was closed by Context Guardian because it reached {state.get('lastUsage', {}).get('usedPercent', 'the configured')}% context usage.

Handoff:
{latest or 'unknown'}

Start a new Codex session in the same project and say:

"Continue from the latest Context Guardian handoff."

Emergency override:
codex-context-guardian reset --session {session_id}"""
        return block_prompt(msg)

    if event in {"PostToolUse", "UserPromptSubmit"}:
        return _evaluate_context(event, data, config, store)

    if event == "PreCompact":
        meta = _metadata(data, config, ContextUsageProvider().sample(data, config))
        meta["latestUserRequest"] = str(data.get("prompt") or "")[:1000]
        body = emergency_handoff(meta)
        paths = HandoffStore(home).save(body, meta, incomplete=True)
        state["state"] = SESSION_CLOSED
        state["metadata"] = meta
        state["lastHandoffPath"] = paths["latest"]
        store.save(session_id, state)
        msg = f"Context Guardian emergency handoff created before compaction: {paths['latest']}"
        log(f"PreCompact emergency triggered session={session_id}", home, config)
        return {"decision": "block", "reason": msg, "systemMessage": msg, "hookSpecificOutput": {"hookEventName": event, "additionalContext": msg}}

    if event == "Stop" and state.get("state") in FROZEN_STATES:
        state["state"] = HANDOFF_RENDERING
        store.save(session_id, state)
        body, incomplete = extract_handoff(str(data.get("last_assistant_message") or ""))
        meta = state.get("metadata") or _metadata(data, config)
        paths = HandoffStore(home).save(body or "No assistant handoff content was captured.", meta, incomplete=incomplete)
        state["state"] = SESSION_CLOSED
        state["lastHandoffPath"] = paths["latest"]
        store.save(session_id, state)
        log(f"handoff persisted session={session_id} path={paths['latest']} incomplete={incomplete}", home, config)
        return hook_output(event, f"Context Guardian handoff saved: {paths['latest']}")

    return {}


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    event = argv[0] if argv else ""
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        if not event:
            event = data.get("hook_event_name", "")
        result = handle(str(event), data)
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:
        log(f"hook error event={event} error={exc}")
        sys.stdout.write("{}")
        return 0
