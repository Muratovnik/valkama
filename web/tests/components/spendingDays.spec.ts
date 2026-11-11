/**
 * The period day by day. The oracle is the requirement: a column per day of the chosen measure,
 * stacked by the largest values of the dimension plus «other»; the last day, while it is not
 * over, marked as such and not drawn as a fall; a mark where the set of accounts that worked
 * changes from one day to the next, read from the period by account; and a table on a narrow page.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { accountChanges, dayColumns, stackLines } from '@/pages/analytics/utils/dayFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'

import { momentAt, noTask, task, unknownTask, usageAnswer, value } from '../fixtures/analytics.ts'
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

/** What a screen reader says of each day: the name of what pressing it does, then what it holds. */
function spokenDays(days: ReturnType<typeof mount>) {
  return days.findAll('.period-column').map((day) => ({
    name: day.attributes('aria-label') ?? '',
    holds: days.find(`[id="${day.attributes('aria-describedby') ?? ''}"]`).text(),
  }))
}

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
  options: { accounts?: AccountsRead; measure?: Measure; narrow?: boolean; readAt?: Date } = {},
  locale: 'en' | 'ru' = 'en',
) {
  return mount(SpendingDays, {
    props: {
      usage,
      by: 'work_item',
      measure: options.measure ?? 'time',
      narrow: options.narrow ?? false,
      readAt: options.readAt ?? WEDNESDAY,
      accounts: options.accounts ?? 'loading',
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

  it('stack work on no task and unknown work apart, never inside other, however small', () => {
    // Six tasks of 10 h down to 5 h on Monday; a minute on no task and two unknown on Tuesday.
    const usage = week([
      ...Array.from({ length: 6 }, (_, index) => ({
        day: 0,
        group: { work_item: task(index + 1, `Task ${index + 1}`) },
        spend: { seconds: (10 - index) * 3600 },
      })),
      { day: 1, group: { work_item: noTask }, spend: { seconds: 60 } },
      { day: 1, group: { work_item: unknownTask }, spend: { seconds: 120 } },
    ])
    const source = { usage, by: 'work_item' as const, measure: 'time' as const }
    const series = stackLines(source)
    // Six hues: the two that are not tasks, and the four largest tasks; the rest is «other».
    expect(series.map((one) => one.key).toSorted()).toEqual(
      [
        'none',
        'unknown',
        ...[1, 2, 3, 4].map((number) => `v:${task(number, '').id}`),
        'other',
      ].toSorted(),
    )
    expect(series.filter((one) => one.slot !== 'other')).toHaveLength(6)
    const columns = dayColumns(source, series, WEDNESDAY)
    expect(columns[0]?.values.other).toBe(5 + 6)
    expect(columns[1]?.values).toEqual({ none: 60 / 3600, unknown: 120 / 3600 })
    const legend = mountDays(usage).get('.chart-legend').text()
    expect(legend).toContain('No task')
    expect(legend).toContain('Unknown')
  })

  it('show a day whose work has no price as absent, never as a zero', () => {
    // Monday is priced, Tuesday spent with no price, Wednesday spent nothing.
    const usage = week([
      { day: 0, group: { work_item: task(1, 'One') }, spend: { seconds: 3600, cost: 2 } },
      {
        day: 1,
        group: { work_item: task(2, 'Two') },
        spend: { seconds: 3600, cost: null, unpriced: 500 },
      },
    ])
    const options = { measure: 'cost' as const, readAt: AFTER }
    const chart = mountDays(usage, options)
    expect(
      chart.findAll('.period-slot').map((slot) => slot.findAll('.period-segment').length),
    ).toEqual([1, 0, 0])
    expect(spokenDays(chart)[1]?.holds).toContain('No price: MAIN-2 Two')
    const rows = mountDays(usage, { ...options, narrow: true })
      .getComponent(PeriodColumnsTable)
      .findAll('tbody tr')
      .map((row) => row.findAll('td').map((cell) => cell.text()))
    // The columns: MAIN-1, MAIN-2, the total and the note.
    expect(rows[0]?.slice(0, 3)).toEqual(['$2.00', '0', '$2.00'])
    expect(rows[1]).toEqual(['0', '—No price', '—No price', 'No price: MAIN-2 Two'])
    expect(rows[2]?.slice(0, 3)).toEqual(['0', '0', '0'])
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
      momentAt(new Date(2026, 10, 12)),
      momentAt(new Date(2026, 10, 13)),
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

/** Work whose organization nobody recorded: no account, only work. */
const UNRECORDED = 'unrecorded'

/** An answer by account over a day per entry, each day worked by the accounts it names. */
function daysOf(...days: readonly (readonly string[])[]): Usage {
  return usageAnswer({
    first: MONDAY,
    days: days.length,
    groupBy: ['account'],
    stretches: days.flatMap((accounts, day) =>
      accounts.map((account) =>
        account === UNRECORDED
          ? { day, group: {}, spend: { seconds: 3600 } }
          : worked(day, account, 1),
      ),
    ),
  }).usage
}

/** The days a change stands on, by their index, with the known accounts before and after. */
const changesOf = (byAccount: Usage) =>
  accountChanges(byAccount).map((change) => ({
    day: byAccount.series.findIndex((point) => point.start === change.at),
    before: change.before.map((account) => account.id),
    after: change.after.map((account) => account.id),
  }))

/** One task worked every one of `count` days, for a chart the account marks stand on. */
const everyDay = (count: number) =>
  usageAnswer({
    first: MONDAY,
    days: count,
    groupBy: ['work_item'],
    stretches: Array.from({ length: count }, (_, day) => ({
      day,
      group: { work_item: task(1, 'One') },
      spend: { seconds: 3600 },
    })),
  }).usage

// Work whose organization nobody recorded is not an account: it is neither a change nor hides one.
describe('the account marks', () => {
  it('mark no change where unrecorded work joins the same accounts', () => {
    expect(changesOf(daysOf(['acc-a'], ['acc-a', UNRECORDED]))).toEqual([])
  })

  it('mark no change across a day of unrecorded work alone between the same account', () => {
    expect(changesOf(daysOf(['acc-a'], [UNRECORDED], ['acc-a']))).toEqual([])
  })

  it('mark the change hidden behind a day of unrecorded work on the day the new account works', () => {
    expect(changesOf(daysOf(['acc-a'], [UNRECORDED], ['acc-b']))).toEqual([
      { day: 2, before: ['acc-a'], after: ['acc-b'] },
    ])
  })

  it('mark a change where a known account joins', () => {
    expect(changesOf(daysOf(['acc-a'], ['acc-a', 'acc-b']))).toEqual([
      { day: 1, before: ['acc-a'], after: ['acc-a', 'acc-b'] },
    ])
  })

  it('say the change under the chart and to a screen reader by the known accounts alone', () => {
    const accounts = daysOf(['acc-a'], [UNRECORDED], ['acc-b', UNRECORDED], ['acc-b'])
    const days = mountDays(everyDay(4), { accounts, readAt: AFTER })
    expect(days.findAll('.period-mark')).toHaveLength(1)
    expect(
      days.findAll('.period-note').map((note) => note.text().replaceAll(/\s+/gu, ' ')),
    ).toEqual([expect.stringContaining('Accounts: acc-a → acc-b')])
    const named = spokenDays(days).map((day) => day.holds)
    expect(named.map((name) => name.includes('Accounts:'))).toEqual([false, false, true, false])
    expect(named[2]).toContain('Accounts: acc-a → acc-b')
    expect(named.join(' ')).not.toContain('Unknown')

    const table = mountDays(everyDay(4), { narrow: true, accounts, readAt: AFTER })
    const notes = table
      .getComponent(PeriodColumnsTable)
      .findAll('tbody tr')
      .map((row) => row.findAll('td').at(-1)?.text() ?? '')
    expect(notes).toEqual(['', '', 'Accounts: acc-a → acc-b', ''])
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

    // By account, the page's own answer is the accounts: its read and the same days of the week
    // before, and no third read.
    const asked = reads.asked.length
    const byAccountPage = await mountAnalytics({ routeState: { by: 'account' } })
    await flushPromises()
    expect(byAccountPage.findComponent(PeriodColumns).exists()).toBe(true)
    expect(reads.asked.slice(asked).map((query) => query.get('group_by'))).toEqual([
      'account',
      'account',
    ])
    expect(byAccountPage.findAll('.period-mark').length).toBeGreaterThan(0)
  })
})

/**
 * Berlin moves from +01:00 to +02:00 on 29 March 2026. A read asked after that cuts every day of
 * the period at +02:00, so the days before the change start at 23:00 of the evening before in the
 * browser's own time: a day is still the date its start names, as the read gave it.
 */
/** Friday 27 to Monday 30 March, an hour each day, as a read asked at +02:00 cuts them. */
const acrossTheChange = (): Usage =>
  usageAnswer({
    first: new Date('2026-03-27T00:00:00+02:00'),
    days: 4,
    offset: 120,
    groupBy: ['work_item'],
    stretches: [0, 1, 2, 3].map((day) => ({
      day,
      group: { work_item: task(1, 'One') },
      spend: { seconds: 3600 },
    })),
  }).usage

describe('the days across the spring change of time', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Europe/Berlin')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('label each day by the date the read gave it, not the browser’s date that night', () => {
    // The zone is fixed: the first two days are still at +01:00 in the browser's own time.
    expect(new Date(2026, 2, 27).getTimezoneOffset()).toBe(-60)
    const readAt = new Date(2026, 3, 1)
    const table = mountDays(acrossTheChange(), { narrow: true, readAt })
    expect(table.findAll('tbody th').map((name) => name.text())).toEqual([
      'Friday, March 27',
      'Saturday, March 28',
      'Sunday, March 29',
      'Monday, March 30',
    ])
    const axis = mountDays(acrossTheChange(), { readAt }).get('.period-axis').text()
    expect(axis).toContain('27 Fri')
    expect(axis).toContain('30 Mon')
  })
})
