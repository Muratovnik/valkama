/**
 * The work production-analytics-bar-states.spec.ts serves as usage. Task 1's work is of one
 * project and one session, each named only by a read, as a chip of a filter set on either is.
 */
import { task } from '../../fixtures/analytics.ts'
import type { TimedStretch } from '../../fixtures/analytics.ts'
import { at } from '../liveClock.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** The project of task 1's work, named «Billing» by a read. */
export const PROJECT = { id: 'project-billing', unknown: false, name: 'Billing' }

/** The session that did task 1's work, named by its title. */
export const SESSION = {
  id: '11111111-0000-4000-8000-000000000001',
  unknown: false,
  family: 'claude',
  opened_in: '',
  opened_host: '',
  title: 'Review',
}

/** Task 1's work, of one project and one session. */
const ONE = { work_item: task(1, 'One'), project: PROJECT, executor: SESSION }

/** Two days of work this week, and some in the live hour. */
export const DAYS: TimedStretch[] = [
  { at: at(13, 50), group: ONE, spend: { seconds: 600 } },
  { at: new Date(2026, 10, 9, 10), group: ONE, spend: { seconds: 3600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two') },
    spend: { seconds: 3600 },
  },
]

export const served: Served[] = [...usageServed('served/analyticsBarStates.ts DAYS', DAYS)]
