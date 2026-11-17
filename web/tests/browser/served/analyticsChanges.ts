/**
 * The work production-analytics-changes.spec.ts serves as usage.
 */
import { task, value } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

export const FIRST = value('f0f0f0f0-5d6e-4f70-8a9b-0c1d2e3f4a5b')
export const SECOND = value('2a2a2a2a-1111-4222-8333-444455556666')
export const HOUR = 3600

/** An hour of `hours` at ten on a day of November 2026, on a task, under an account. */
export const worked = (
  day: number,
  account: typeof FIRST,
  hours: number,
  number: number,
): TimedStretch => ({
  at: new Date(2026, 10, day, 10),
  group: {
    work_item: task(number, `Rework the import of very long planning documents, part ${number}`),
    account,
  },
  spend: { seconds: hours * HOUR, tokens: hours * 100_000, cost: hours * 2 },
})

/**
 * The week to Wednesday afternoon and the Monday a week before, the second account joining on
 * Tuesday and alone on Wednesday: two changes. Tuesday holds five tasks and the change, so its
 * hint runs to many lines.
 */
export const TWO: TimedStretch[] = [
  worked(9, FIRST, 5, 1),
  worked(10, FIRST, 4, 2),
  ...[3, 4, 5, 6].map((number) => worked(10, SECOND, 1, number)),
  worked(11, SECOND, 2, 3),
  worked(2, FIRST, 6, 1),
]

/** The same work under the first account alone: no change, and every other part the same. */
export const NONE: TimedStretch[] = TWO.map((stretch) => ({
  ...stretch,
  group: { ...stretch.group, account: FIRST },
}))

/** An hour on each of the thirteen days that end on Wednesday 11 November, the account switching daily. */
export const SWITCHING: TimedStretch[] = Array.from({ length: 13 }, (_, back) => ({
  at: new Date(2026, 10, 11 - back, 10),
  group: {
    work_item: task(1, 'Import the planning documents'),
    account: back % 2 ? FIRST : SECOND,
  },
  spend: { seconds: 3600 },
}))

export const served: Served[] = [
  ...usageServed('served/analyticsChanges.ts TWO', TWO),
  ...usageServed('served/analyticsChanges.ts NONE', NONE),
  ...usageServed('served/analyticsChanges.ts SWITCHING', SWITCHING),
]
