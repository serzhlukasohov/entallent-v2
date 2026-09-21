# codex-context-guardian

Dependency-free Codex lifecycle hooks that stop a near-full session before automatic compaction, require an English handoff, save it outside the repository, and block accidental continuation in the old session.

## What was inspected

- Installed CLI: `codex-cli 0.151.0`.
- Installed examples confirm Codex reads Claude-style hook JSON from `hooks.json` and plugin hook files.
- The 0.151.0 binary contains hook events for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `Stop`, `SessionEnd`, `SubagentStart`, and `SubagentStop`.
- The binary and live rollout files expose token events with `payload.type = "token_count"`, `payload.info.last_token_usage.total_tokens`, `payload.info.total_token_usage.total_tokens`, and `payload.info.model_context_window`.
- Blocking format confirmed from installed hook examples: `PreToolUse` denies with `hookSpecificOutput.permissionDecision = "deny"`; Stop-style blocking uses `decision = "block"` plus `reason`.

## Install

From this directory:

```bash
python3 install.py
```

The installer:

- copies this package to `~/.codex/context-guardian/package`;
- creates `~/.codex/context-guardian/config.toml` if missing;
- creates `~/.codex/context-guardian/bin/codex-context-guardian`;
- merges Context Guardian hooks into `~/.codex/hooks.json`;
- backs up existing hooks to `~/.codex/hooks.json.context-guardian.bak`.

It preserves existing hooks and does not write handoffs into the project repository.

Codex may ask you to review and trust the new hook commands on the next session start.

## Configuration

Edit `~/.codex/context-guardian/config.toml`:

```toml
[context_guardian]
enabled = true
warning_threshold = 70
handoff_threshold = 80
monitor_subagents = false
block_closed_sessions = true
show_session_start_handoff_notice = true
```

## Behavior

At `warning_threshold`, the hook injects one small warning into the session and records that it has warned.

At `handoff_threshold`, the hook records `HANDOFF_REQUIRED`, captures a deterministic git snapshot, injects a hard handoff instruction, and `PreToolUse` denies further ordinary tools.

The final assistant response must contain:

```text
<!-- CODEX_HANDOFF_START -->
...
<!-- CODEX_HANDOFF_END -->
```

The `Stop` hook extracts the marked handoff and saves:

```text
~/.codex/context-guardian/handoffs/<project-id>/latest.md
~/.codex/context-guardian/handoffs/<project-id>/<timestamp>_<session-id>.md
~/.codex/context-guardian/handoffs/<project-id>/latest.json
```

If markers are missing, it saves the final assistant response as an incomplete fallback.

## CLI

```bash
~/.codex/context-guardian/bin/codex-context-guardian latest
~/.codex/context-guardian/bin/codex-context-guardian show
~/.codex/context-guardian/bin/codex-context-guardian status --session <session-id>
~/.codex/context-guardian/bin/codex-context-guardian reset --session <session-id>
```

Add `~/.codex/context-guardian/bin` to `PATH` if you want `codex-context-guardian` directly.

## Architecture

- `ContextUsageProvider`: reads current context pressure.
- `RolloutParser`: tails rollout JSONL and uses only `last_token_usage`, never cumulative `total_token_usage`.
- `SessionStateStore`: per-session JSON state under `~/.codex/context-guardian/state`.
- `GitSnapshotProvider`: short-timeout branch/status/stat/name-only snapshot.
- `HandoffStore`: project-root hashed storage outside git.
- `HookDispatcher`: lifecycle state machine and Codex hook JSON output.

## Limitations

Codex 0.151.0 exposes hook-level blocking and context injection. I did not find a documented hook primitive that forcibly closes the TUI process. This package freezes the old session by denying tools and blocking later prompts after the handoff is saved; the user still starts the new clean session manually.

`PreCompact` attempts to block compaction and writes an emergency handoff. Whether Codex fully cancels compaction depends on the installed hook runner honoring `decision = "block"` for `PreCompact`.

## Test

```bash
python3 -m unittest discover -s tests
```

The tests simulate the hook lifecycle with low thresholds so no live model call or network access is needed.

## Uninstall

```bash
python3 uninstall.py
```

To remove saved state, logs, config, package copy, and handoffs too:

```bash
python3 uninstall.py --remove-files
```
