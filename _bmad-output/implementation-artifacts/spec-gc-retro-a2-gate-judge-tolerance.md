---
title: 'GC round 3 retro A2: sim gate judge tolerance applies to scenarios that assert the judge'
type: 'bugfix'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nine live scenarios configured with `judgePasses: 4` (identity-purpose, capability-link-request, offer-delivered, format-request-outline, answer-then-bundle, reasked-question, changed-advice, sentiment-amplification, topic-steering) end with `expect(result.success).toBe(true)`. A single judge miss fails the Vitest test, `appendTestFailure` marks the report deterministic-failed, and `run-gate.ts` counts the sample as a hard failure, so the configured 4/5 judge tolerance acts as 5/5.

**Approach:** Add one harness helper that asserts the judge verdict only outside a gate run (no `SIM_GATE_RUN_ID`) and, inside a gate run, records the miss as advisory so the gate's judge pass-rate decides; switch the nine scenarios to it. `resolved-detail-question-planning` keeps its direct assertion because its gate threshold is deliberately 5/5. Update the README paragraph that describes judge handling.

</frozen-after-approval>

## Implementation Notes

- Added `packages/conversation-sim/src/harness/judge-verdict.ts` (`expectJudgeVerdict`) with RED-first `judge-verdict.test.ts` (3 tests: standalone fails, gate sample stays green and warns, pass is silent).
- Replaced the direct `expect(result.success, ...)` in the nine `judgePasses: 4` scenarios; `resolved-detail-question-planning` untouched (gate requires 5/5).
- README "Judge verdict" paragraph updated.
- Gate side unchanged: `run-gate.ts` already counts `report.judge.passed` against `judgePasses`; the report still records the miss because `reportRun` runs before the verdict check.
- Not run: live `pnpm sim:gate` re-baseline (needs model credentials and spends live calls). Offline `pnpm --filter @entalent/conversation-sim test` 36/36.
- Review patch: `expectJudgeVerdict` tolerates a gate-sample miss only when the judge returned criteria; a failed result with none (no verdict, max turns) still fails. Tests now 5 (adds empty `SIM_GATE_RUN_ID` and no-verdict cases); offline suite 38/38.
- Not committed: AGENTS.md forbids commits without an explicit user request.

## Review Triage Log

- Blind Hunter 1 (resolved-detail README reason wrong, direct assert misattributes a judge miss as hard): low, real; README now states the strict group and its consequence. Switching the scenario is outside the frozen intent.
- Blind Hunter 2 (advisory scenarios keep own warn blocks): low, pre-existing; rejected, README now lists the groups.
- Blind Hunter 3 (`success=false` can be a non-judge failure absorbed by tolerance): medium, real; patched (criteria check) with a test.
- Blind Hunter 4 (`SIM_GATE_RUN_ID` set by other tests): false for this change; `coach-harness.test.ts:104` and `simulation-repositories.sim.test.ts:55` never call `expectJudgeVerdict`.
- Blind Hunter 5 (no end-to-end gate test): medium, deferred.
- Blind Hunter 6 (unit edge cases): low, patched (empty run id, no verdict); split `it` left as is.
- Blind Hunter 7 (hand-typed labels): low cosmetic; rejected, labels only prefix a log line.
- Blind Hunter 8 (README contradiction, behaviour change unstated): low, patched.
- Blind Hunter 9 (tolerated miss not machine-tagged): low; rejected, `judge.passed=false` with `hardPassed=true` in summary.json already identifies it.
