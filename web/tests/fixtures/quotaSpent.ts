/**
 * The work the quota's accounts recorded on Wednesday 11 November, for what used each window,
 * beside the quota `quotaAt` answers for 14:30 that day. Every id, name and number is made up.
 *
 * - «Work» spent 13 dollars in its five hours, from 11:30: 6 on MAIN-1, 3 on MAIN-2, 1 on no task
 *   and 0.5 on each of six small tasks; and 50 on MAIN-9 at 10:00, before them, inside its week.
 *   Its organization spent 2 more with no account known, and another account of it 20 on MAIN-1.
 * - The account with no name spent 100 on MAIN-1 at 13:00, before its five hours began at 13:30.
 * - The provisional seat's organization spent 4 with no account known, and the seat nothing.
 */
import type { QuotaAccount, UsageGroupValue } from '@/shared/api/analyticsApi.ts'

import { noTask, task, value } from './analytics.ts'
import type { TimedStretch } from './analytics.ts'
import { quotaAt } from './quota.ts'

/** Wednesday afternoon, the moment the quota is answered as of. */
export const SPENT_NOW = new Date(2026, 10, 11, 14, 30)
const at = (hour: number, minute = 0) => new Date(2026, 10, 11, hour, minute)

export const [WORK, NIGHT, , SEATED] = quotaAt(SPENT_NOW).accounts as [
  QuotaAccount,
  QuotaAccount,
  QuotaAccount,
  QuotaAccount,
]

/** A seat as the contract writes it: the organization, a slash, the account's UUID or seat key. */
export const seatOf = (account: QuotaAccount) =>
  value(`${account.organization}/${account.account_uuid ?? account.seat ?? ''}`)

const project = (id: string, name: string): UsageGroupValue => ({ id, unknown: false, name })
const ATLAS = project('p-atlas', 'Atlas')
const BEACON = project('p-beacon', 'Beacon')

const onWork = (when: Date, group: TimedStretch['group'], cost: number): TimedStretch => ({
  at: when,
  group: { account: value(WORK.organization), seat: seatOf(WORK), ...group },
  spend: { seconds: 600, tokens: 1000, cost },
})

export const SPENT_WORLD: TimedStretch[] = [
  onWork(at(13), { work_item: task(1, 'Answer a review'), project: ATLAS, model: value('m-a') }, 6),
  onWork(at(12), { work_item: task(2, 'Fix the import'), project: ATLAS, model: value('m-b') }, 3),
  // Work on no task, of no project anyone knows.
  onWork(at(14), { work_item: noTask, model: value('m-a') }, 1),
  ...[3, 4, 5, 6, 7, 8].map((number) =>
    onWork(
      at(12, 30),
      { work_item: task(number, `Small step ${number}`), project: BEACON, model: value('m-a') },
      0.5,
    ),
  ),
  // Before the five hours began, inside the week.
  onWork(at(10), { work_item: task(9, 'Earlier'), project: ATLAS, model: value('m-a') }, 50),
  // Another account of Work's organization, and one of another, on the same task in the same hours.
  {
    at: at(13),
    group: {
      account: value(WORK.organization),
      seat: value(`${WORK.organization}/3c4d5e6f-0000-4000-8000-000000000001`),
      work_item: task(1, 'Answer a review'),
    },
    spend: { seconds: 600, tokens: 1000, cost: 20 },
  },
  {
    at: at(13),
    group: {
      account: value(NIGHT.organization),
      seat: seatOf(NIGHT),
      work_item: task(1, 'Answer'),
    },
    spend: { seconds: 600, tokens: 1000, cost: 100 },
  },
  // Work's organization and the provisional seat's, with no account known.
  {
    at: at(13, 30),
    group: { account: value(WORK.organization), work_item: noTask },
    spend: { seconds: 60, tokens: 10, cost: 2 },
  },
  {
    at: at(13, 45),
    group: { account: value(SEATED.organization), work_item: noTask },
    spend: { seconds: 60, tokens: 10, cost: 4 },
  },
]

/** A read of what used a window: the one that names a seat. */
export const isSpendRead = (query: URLSearchParams) => query.has('seat')
