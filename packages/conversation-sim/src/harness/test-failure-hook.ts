/**
 * A vitest-free seam for "run this when the current test fails". `vitest-setup.ts`
 * (a Vitest `setupFiles` entry) installs Vitest's `onTestFailed`; plain Node/tsx
 * processes (the suite CLI) install nothing, so harness modules load without Vitest.
 * This module never imports `vitest`.
 */

export interface FailedTaskLike {
  name: string;
  suite?: FailedTaskLike;
  result?: { errors?: ReadonlyArray<{ message: string }> };
}

export type TestFailedHandler = (context: { task: FailedTaskLike }) => void | Promise<void>;
export type TestFailedHook = (handler: TestFailedHandler) => void;

let installed: TestFailedHook | null = null;

/** Installs `hook` and returns the previously installed one, so callers can restore it. */
export function installTestFailedHook(hook: TestFailedHook | null): TestFailedHook | null {
  const previous = installed;
  installed = hook;
  return previous;
}

type VitestOnTestFailed = (handler: (context: { task: FailedTaskLike }) => void | Promise<void>) => void;

/**
 * The installed hook; otherwise, inside a Vitest worker whose config lacks the setup file
 * (test fixtures that spawn Vitest with their own config), the `onTestFailed` of the
 * module namespace Vitest publishes as `globalThis.__vitest_index__`; `null` outside Vitest.
 */
export function testFailedHook(): TestFailedHook | null {
  if (installed) return installed;
  const index = (globalThis as { __vitest_index__?: { onTestFailed?: unknown } }).__vitest_index__;
  const onTestFailed = index?.onTestFailed;
  if (typeof onTestFailed !== 'function') return null;
  return (handler) => (onTestFailed as VitestOnTestFailed)((context) => handler({ task: context.task }));
}
