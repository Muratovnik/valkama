/**
 * The work production-analytics-names.spec.ts serves as usage.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const on = (day: number) => new Date(2026, 10, day, 10)

export const MAIN_ID = 'f0f0f0f0-1111-4222-8333-444455556666'
export const SIDE_ID = '9c0de5b1-2222-4333-8444-555566667777'
export const MAIN = value(MAIN_ID)
export const SIDE = value(SIDE_ID)

export const session = (id: string, family: string, title: string | null) => ({
  id,
  unknown: false,
  family,
  opened_in: '',
  opened_host: '',
  title,
})
export const RAIL = session('1a2b3c4d-0000-4000-8000-000000000001', 'claude', 'Fix the rail')
export const REVIEW = session(
  '5e6f7a8b-0000-4000-8000-000000000002',
  'claude',
  'Review the overview',
)
export const CODEX = session('9f8e7d6c-0000-4000-8000-000000000003', 'codex', null)

/** Three sessions over three days, on the main account but for the codex one. */
export const WORLD: TimedStretch[] = [
  { executor: RAIL, account: MAIN, seconds: 5 * 3600 },
  { executor: REVIEW, account: MAIN, seconds: 3 * 3600 },
  { executor: CODEX, account: SIDE, seconds: 3600 },
].flatMap(({ executor, account, seconds }, index) =>
  [0, 1, 2].map((day) => ({
    at: on(9 + day),
    group: { executor, account, work_item: task(index + 1, `Task ${index + 1}`) },
    spend: { seconds, tokens: 1000, cost: 1 },
  })),
)

export const served: Served[] = [...usageServed('served/analyticsNames.ts WORLD', WORLD)]
