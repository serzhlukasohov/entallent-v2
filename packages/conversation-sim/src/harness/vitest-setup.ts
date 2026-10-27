import { onTestFailed } from 'vitest';
import { installTestFailedHook } from './test-failure-hook';

// Listed in vitest.config.ts `setupFiles`; the only place the harness binds to Vitest.
installTestFailedHook((handler) => onTestFailed((context) => handler({ task: context.task })));
