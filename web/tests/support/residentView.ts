import type { Component } from 'vue'

import { beforeAll } from 'vitest'

import type { LazyView } from '@/shared/ui/lazyView.ts'

/**
 * How long the first import of a view's code may take. The import compiles the view's whole
 * chunk, which took 9 s on its own and passed the hook's default 10 s while other checks loaded
 * the machine; the budget is for that compile, and nothing the view does waits on it.
 */
const COMPILE_BUDGET_MS = 60_000

/**
 * Makes views the app downloads when they are first drawn resident before a file's tests mount
 * them, as a test mounts a view that is already there.
 */
export function residentView(...views: LazyView<Component>[]) {
  beforeAll(async () => {
    await Promise.all(views.map((view) => view.load()))
  }, COMPILE_BUDGET_MS)
}
