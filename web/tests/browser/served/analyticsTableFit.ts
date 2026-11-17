/**
 * The work production-analytics-table-fit.spec.ts serves as usage.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const ACCOUNT = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')

/** Sixteen tasks of long titles, each with work today; how much each did yesterday varies. */
export const TASKS: TimedStretch[] = Array.from({ length: 16 }, (_, index) => {
  const group = {
    work_item: task(index + 1, `Read the planning documents through the board reader ${index + 1}`),
    account: ACCOUNT,
  }
  // Today: from an hour and seventeen minutes down to under a minute; tokens and a price, but
  // for the last four, which a client recorded no tokens for («Нет токенов», «Нет цены»).
  const counted = index < 12
  const today: TimedStretch = {
    at: new Date(2026, 10, 11, 9, index),
    group,
    spend: {
      seconds: counted ? (16 - index) * 290 : 30,
      tokens: counted ? 375_700 - index * 9000 : null,
      cost: counted ? 7.56 + index : null,
    },
  }
  // Yesterday by the same hour: under a minute, one second (a change of thousands of percent),
  // a few minutes, or nothing at all («Nothing before»).
  const seconds = [30, 1, 300, 0][index % 4] ?? 0
  const before: TimedStretch[] = seconds
    ? [{ at: new Date(2026, 10, 10, 9, index), group, spend: { seconds, tokens: 0, cost: 0 } }]
    : []
  return [today, ...before]
}).flat()

export const served: Served[] = [...usageServed('served/analyticsTableFit.ts TASKS', TASKS)]
