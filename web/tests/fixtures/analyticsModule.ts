/**
 * The week the Analytics module's specs read (`analyticsModule.spec.ts`): a task in the project
 * «sample», its work this week and the weeks before, and another project's beside it.
 */
import { seatValue, task, value } from './analytics.ts'
import type { TimedStretch } from './analytics.ts'

export const ITEM = task(12, 'Answer a review in one form')

/** Wednesday afternoon, the moment the page's reads are asked at. */
export const NOW = new Date(2026, 10, 11, 14, 30)
export const on = (month: number, day: number) => new Date(2026, month, day, 10)
export const sample = { project: value('sample'), role: value('main') }

/**
 * The work the stand-in answers from, so that a read asked for the wrong period, filter or scope
 * gets other figures: an hour on the task in the project «sample» this Monday under one account,
 * two hours in another project on Tuesday under another; half an hour on Monday a week before,
 * an hour and a half on that Friday, and an hour three weeks back.
 */
export const WORLD: TimedStretch[] = [
  {
    at: on(10, 9),
    group: {
      ...sample,
      work_item: ITEM,
      model: value('model-a'),
      account: value('org-a'),
      seat: seatValue('org-a/acc-a'),
    },
    spend: { seconds: 3600, tokens: 1200, cost: 0.4 },
  },
  {
    at: on(10, 10),
    group: {
      project: value('other'),
      role: value('main'),
      work_item: task(13, 'Elsewhere'),
      model: value('model-b'),
      account: value('org-a'),
      seat: seatValue('org-a/acc-b'),
    },
    spend: { seconds: 7200, tokens: 100, cost: 1 },
  },
  { at: on(10, 2), group: { ...sample, work_item: ITEM }, spend: { seconds: 1800 } },
  { at: on(10, 6), group: { ...sample, work_item: ITEM }, spend: { seconds: 5400 } },
  { at: on(9, 20), group: { ...sample, work_item: ITEM }, spend: { seconds: 3600 } },
]
