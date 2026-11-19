/**
 * The work analyticsPage.ts serves as usage.
 */
import { noTask, task, unknownTask, value } from '../../fixtures/analytics.ts'
import type { Stretch, TimedStretch } from '../../fixtures/analytics.ts'
import { NIGHT_GROUP as NIGHT, WORK_GROUP as WORK } from '../../fixtures/quotaSpent.ts'
import type { Served } from '../servedContracts.ts'
import { usageServed } from '../servedUsage.ts'

/** Wednesday afternoon, so the week holds two whole days and one not over yet. */
export const NOW = new Date(2026, 10, 11, 14, 30)
const on = (day: number) => new Date(2026, 10, day, 10)

/** Twelve tasks with long titles, work on no task and work nobody can place, over three days. */
export const STRETCHES: Stretch[] = [
  ...Array.from({ length: 12 }, (_, index) => ({
    day: index % 3,
    group: {
      work_item: task(
        index + 1,
        `Rework the import of very long planning documents into the board, part ${index + 1}`,
      ),
      model: value(index % 2 ? 'model-b' : 'model-a'),
    },
    spend: {
      seconds: (13 - index) * 5400,
      tokens: (13 - index) * 1_250_000,
      cost: index === 11 ? null : (13 - index) * 12.5,
      unpriced: index === 11 ? 40_000 : 0,
    },
  })),
  { day: 1, group: { work_item: noTask }, spend: { seconds: 7200, tokens: 900_000, cost: 8 } },
  { day: 2, group: { work_item: unknownTask }, spend: { seconds: 1800, tokens: 10_000, cost: 1 } },
]

/** Who worked: one account on Monday, both on Tuesday, the other on Wednesday. */
export function accountOf(stretch: Stretch, index: number) {
  if (stretch.day === 0) return WORK
  if (stretch.day === 2) return NIGHT
  return index % 2 ? WORK : NIGHT
}

/** The week so far, and the same Monday a week before, which this week is compared with. */
export const WORLD: TimedStretch[] = [
  ...STRETCHES.map((stretch, index) => ({
    at: on(9 + stretch.day),
    group: { ...stretch.group, ...accountOf(stretch, index) },
    spend: stretch.spend,
  })),
  {
    at: on(2),
    group: { work_item: task(1, 'One'), ...WORK },
    spend: { seconds: 90_000, tokens: 9e6, cost: 99 },
  },
]

/**
 * Six sessions over the week, largest first, each named by its title. A ranked row prints its
 * name, figure and share, so the one thing its hint has to say is what the title leaves out: the
 * session's client and the start of its id. A row named whole with nothing left out, as a task's,
 * has no hint to place.
 */
export const SESSIONS: TimedStretch[] = Array.from({ length: 6 }, (_, index) => ({
  at: on(9 + (index % 3)),
  group: {
    work_item: task(index + 1, `Task ${index + 1}`),
    executor: {
      id: `${String(index + 1).repeat(8)}-0000-4000-8000-00000000000${index + 1}`,
      unknown: false,
      family: 'claude',
      opened_in: '',
      opened_host: '',
      title: `Session ${index + 1}`,
    },
    ...WORK,
  },
  spend: { seconds: (7 - index) * 3600, tokens: (7 - index) * 100_000, cost: 7 - index },
}))

/** One task the whole week: a chart of one value. */
export const ONE_VALUE: TimedStretch[] = [0, 1, 2].map((day) => ({
  at: on(9 + day),
  group: { work_item: task(1, 'The only task'), ...WORK },
  spend: { seconds: 3600 * (day + 1), tokens: 1000, cost: 1 },
}))

/** Twenty-five tasks of an hour each: those past the named ones fold into a large «other». */
export const LONG_TAIL: TimedStretch[] = Array.from({ length: 25 }, (_, index) => ({
  at: on(9 + (index % 3)),
  group: { work_item: task(index + 1, `Task ${index + 1}`), ...WORK },
  spend: { seconds: 3600, tokens: 1000, cost: 1 },
}))

/** Nothing this week, and a day's work on the Monday of the week before: a fall to zero. */
export const ONLY_WEEK_BEFORE: TimedStretch[] = WORLD.filter(
  ({ at }) => at.getTime() < on(9).getTime(),
)

/**
 * One account on Monday, work whose organization nobody recorded alone on Tuesday, and the other
 * account beside more such work on Wednesday: one change of accounts, on Wednesday.
 */
export const UNRECORDED_BETWEEN: TimedStretch[] = [
  { at: on(9), group: { work_item: task(1, 'One'), ...WORK }, spend: { seconds: 3600 } },
  { at: on(10), group: { work_item: task(1, 'One') }, spend: { seconds: 5400 } },
  { at: on(11), group: { work_item: task(2, 'Two'), ...NIGHT }, spend: { seconds: 1800 } },
  { at: on(11), group: { work_item: task(2, 'Two') }, spend: { seconds: 900 } },
]

/**
 * Figures as long as a month of a busy workstation writes them, «21 days 12 h», «594.9M» and
 * «≈ $9,584.68», in the live hour, so every period up to four weeks holds them; and a table whose
 * count is long: a hundred tasks with tokens, forty-five with agent time alone and no tokens or
 * price, and a hundred and thirty-seven that worked only in the week before.
 */
export const LONG_FIGURES: TimedStretch[] = [
  {
    at: new Date(2026, 10, 11, 14, 20),
    group: {
      work_item: task(1, 'Rework the import of very long planning documents'),
      ...WORK,
    },
    spend: { seconds: 21 * 86_400 + 12 * 3600, tokens: 594_900_000, cost: 9584.68 },
  },
  ...Array.from({ length: 99 }, (_, index) => ({
    at: on(9 + (index % 3)),
    group: { work_item: task(index + 2, `Task with tokens ${index + 2}`), ...WORK },
    spend: { seconds: 3600, tokens: 1_000_000, cost: 1.25 },
  })),
  ...Array.from({ length: 45 }, (_, index) => ({
    at: on(10),
    group: {
      work_item: task(index + 101, `Task with agent time alone ${index + 101}`),
      ...WORK,
    },
    spend: { seconds: 1800 },
  })),
  ...Array.from({ length: 137 }, (_, index) => ({
    at: on(3),
    group: {
      work_item: task(index + 146, `Task of the week before ${index + 146}`),
      ...WORK,
    },
    spend: { seconds: 600, tokens: 10_000, cost: 0.1 },
  })),
]

export const served: Served[] = [
  ...usageServed('served/analyticsWorld.ts WORLD', WORLD),
  ...usageServed('served/analyticsWorld.ts SESSIONS', SESSIONS),
  ...usageServed('served/analyticsWorld.ts ONE_VALUE', ONE_VALUE),
  ...usageServed('served/analyticsWorld.ts LONG_TAIL', LONG_TAIL),
  ...usageServed('served/analyticsWorld.ts ONLY_WEEK_BEFORE', ONLY_WEEK_BEFORE),
  ...usageServed('served/analyticsWorld.ts UNRECORDED_BETWEEN', UNRECORDED_BETWEEN),
  ...usageServed('served/analyticsWorld.ts LONG_FIGURES', LONG_FIGURES),
]
