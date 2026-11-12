import type { OperationRuntime } from '@tutorialx/core';

/** Clock/timer effects stay at the adapter boundary; core accepts an explicit runtime. */
export function createNativeOperationRuntime(): OperationRuntime {
  return {
    now: () => new Date().toISOString(),
    schedule: (callback, delay) => setTimeout(callback, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
