/**
 * The period day by day. The oracle is the requirement: a column per day of the chosen measure,
 * stacked by the largest values of the dimension plus «other»; the last day, while it is not
 * over, marked as such and not drawn as a fall; a mark where the set of accounts that worked
 * changes from one day to the next, read from the period by account; and a table on a narrow page.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import { accountChanges, dayColumns, stackLines } from '@/pages/analytics/utils/dayFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'

import { task, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

const MONDAY = new Date(2026, 10, 9)
/** Wednesday afternoon: Monday and Tuesday are over, Wednesday is not. */
const WEDNESDAY = new Date(2026, 10, 11, 14, 30)

/** Seven tasks over three days, the largest first, so five are named and two fold. */
const STRETCHES: Stretch[] = Array.from({ length: 7 }, (_, index) => ({
  day: index % 3,
  group: { work_item: task(index + 1, `Task ${index + 1}`) },
  spend: { seconds: (7 - index) * 3600, tokens: 100, cost: 0.1 },
}))

const week = (stretches: readonly Stretch[] = STRETCHES) =>
  usageAnswer({ first: MONDAY, days: 3, end: WEDNESDAY, groupBy: ['work_item'], stretches }).usage

const worked = (day: number, account: string, hours: number): Stretch => ({
  day,
  group: { account: value(account) },
  spend: { seconds: hours * 3600 },
})

/** Who worked each day: a; a; nobody; b; a and b. */
function byAccount(): Usage {
  return usageAnswer({
    first: MONDAY,
    days: 5,
    groupBy: ['account'],
    stretches: [
      worked(0, 'acc-a', 1),
      worked(1, 'acc-a', 2),
      worked(3, 'acc-b', 1),
      worked(4, 'acc-a', 2),
      worked(4, 'acc-b', 1),
    ],
  }).usage
}

/** A week after the five days below, so none of them is still running. */
const AFTER = new Date(2026, 10, 20)

/** One task worked on the days the accounts did: Wednesday is quiet. */
const fiveDays = () =>
  usageAnswer({
    first: MONDAY,
    days: 5,
    groupBy: ['work_item'],
    stretches: [0, 1, 3, 4].map((day) => ({
      day,
      group: { work_item: task(1, 'One') },
      spend: { seconds: 3600 },
    })),
  }).usage

function mountDays(
  usage: Usage,
  options: { accounts?: Usage | null; measure?: Measure; narrow?: boolean; readAt?: Date } = {},
  locale: 'en' | 'ru' = 'en',
) {
  return mount(SpendingDays, {
    props: {
      usage,
      by: 'work_item',
      measure: options.measure ?? 'time',
      narrow: options.narrow ?? false,
      readAt: options.readAt ?? WEDNESDAY,
      accounts: options.accounts ?? null,
    },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

describe('the days', () => {
  it('stack each day by the five largest tasks and other, adding up to the day', () => {
    const usage = week()
    const series = stackLines({ usage, by: 'work_item', measure: 'time' })
    expect(series.map((one) => one.key)).toEqual([
      ...Array.from({ length: 5 }, (_, index) => `v:${task(index + 1, '').id}`),
      'other',
    ])
    expect(series.map((one) => one.slot)).toEqual([1, 2, 3, 4, 5, 'other'])
    const columns = dayColumns({ usage, by: 'work_item', measure: 'time' }, series, WEDNESDAY)
    for (const [index, column] of columns.entries()) {
      let drawn = 0
      for (const hours of Object.values(column.values)) drawn += hours ?? 0
      expect(drawn).toBeCloseTo((usage.series[index]?.agent_seconds ?? 0) / 3600, 9)
    }
    // Task 6 (2 h, on day 2) and task 7 (1 h, on day 0) are what «other» holds.
    expect(columns[0]?.values.other).toBe(1)
    expect(columns[2]?.values.other).toBe(2)
  })

  it('mark the day not over yet as so far, and only that day', () => {
    const days = mountDays(week())
    const stacks = days.findAll('.period-stack')
    expect(stacks.map((stack) => stack.classes().includes('period-incomplete'))).toEqual([
      false,
      false,
      true,
    ])
    expect(days.get('.period-axis').text()).toContain('so far')
    expect(days.get('.period-readout').text()).toContain('so far')
  })

  it('mark no day once the period is over', () => {
    const days = mountDays(week(), { readAt: new Date(2026, 10, 12, 9) })
    expect(days.find('.period-incomplete').exists()).toBe(false)
    expect(days.text()).not.toContain('so far')
  })

  it('mark where the accounts that worked change, past a day nobody worked', () => {
    expect(accountChanges(byAccount()).map((change) => change.at)).toEqual([
      new Date(2026, 10, 12).toISOString(),
      new Date(2026, 10, 13).toISOString(),
    ])
    const days = mountDays(fiveDays(), { accounts: byAccount(), readAt: AFTER })
    expect(days.findAll('.period-mark')).toHaveLength(2)
    expect(
      days.findAll('.period-note').map((note) => note.text().replaceAll(/\s+/gu, ' ')),
    ).toEqual([
      expect.stringContaining('Accounts: acc-a → acc-b'),
      expect.stringContaining('Accounts: acc-b → acc-a, acc-b'),
    ])
  })

  it('read as a table on a narrow page, with the same days, so far and the marks', () => {
    const table = mountDays(week(), { narrow: true })
    expect(table.findComponent(PeriodColumns).exists()).toBe(false)
    const rows = table.getComponent(PeriodColumnsTable).findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows.at(-1)?.text()).toContain('so far')

    const marked = mountDays(fiveDays(), { narrow: true, accounts: byAccount(), readAt: AFTER })
    const notes = marked
      .getComponent(PeriodColumnsTable)
      .findAll('tbody tr')
      .map((row) => row.findAll('td').at(-1)?.text() ?? '')
    expect(notes).toEqual(['', '', '', 'Accounts: acc-a → acc-b', 'Accounts: acc-b → acc-a, acc-b'])
  })

  it('say the same in Russian', () => {
    const days = mountDays(week(), {}, 'ru')
    expect(days.get('h2').text()).toBe('Время агентов по дням, по задачам')
    expect(days.get('.period-axis').text()).toContain('пока')
  })
})

describe('the days on the page', () => {
  it('ask for the period by account beside the page read, and not again when it is by account', async () => {
    const reads = stubAnalyticsReads((query) =>
      query.get('group_by') === 'account'
        ? { interface_version: 'valkama-analytics-api', usage: byAccount() }
        : { interface_version: 'valkama-analytics-api', usage: week() },
    )
    const page = await mountAnalytics()
    await flushPromises()
    const accounts = reads.grouped('account')
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.get('compare')).toBeNull()
    expect(accounts[0]?.get('from')).toBe(reads.grouped('work_item')[0]?.get('from'))
    expect(page.findComponent(PeriodColumns).exists()).toBe(true)

    const byAccountPage = await mountAnalytics({ routeState: { by: 'account' } })
    await flushPromises()
    expect(byAccountPage.findComponent(PeriodColumns).exists()).toBe(true)
    expect(reads.grouped('account')).toHaveLength(2)
  })
})
