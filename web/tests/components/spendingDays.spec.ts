/**
 * The period day by day. The oracle is the requirement: a column per day of the chosen measure,
 * stacked by the largest values of the dimension plus «other»; the last day, while it is not
 * over, marked as such and not drawn as a fall; a mark where the set of accounts that worked
 * changes from one day to the next, read from the period by account; and their table, a press
 * away at every width.
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

import {
  momentAt,
  noTask,
  seatValue,
  task,
  unknownTask,
  usageAnswer,
} from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { showView } from '../support/chartViews.ts'
import { plotWords } from '../support/plotWords.ts'

// What the panel asks is counted and ordered here; the rail's own reads are held elsewhere.
vi.mock('@/pages/analytics/composables/useRailReads.ts', () => import('../support/quietRail.ts'))

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

/** Two accounts of one organization, and its work no reading places on an account. */
const A = 'org-a/acc-a'
const B = 'org-a/acc-b'
const UNPLACED = 'org-a/'

const worked = (day: number, account: string, hours: number): Stretch => ({
  day,
  group: { seat: seatValue(account) },
  spend: { seconds: hours * 3600 },
})

/** Who worked each day: a; a; nobody; b; a and b. */
function byAccount(): Usage {
  return usageAnswer({
    first: MONDAY,
    days: 5,
    groupBy: ['seat'],
    stretches: [
      worked(0, A, 1),
      worked(1, A, 2),
      worked(3, B, 1),
      worked(4, A, 2),
      worked(4, B, 1),
    ],
  }).usage
}

/** A week after the five days below, so none of them is still running. */
const AFTER = new Date(2026, 10, 20)

/**
 * What each day says: the name of what pressing it does, and what it holds, in its hint, which
 * the hint host also gives a screen reader as the day's description.
 */
function spokenDays(days: ReturnType<typeof mount>) {
  return days.findAll('.period-column').map((day) => ({
    name: day.attributes('aria-label') ?? '',
    holds: day.attributes('data-tooltip') ?? '',
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
  options: { accounts?: AccountsRead; measure?: Measure; readAt?: Date } = {},
  locale: 'en' | 'ru' = 'en',
) {
  return mount(SpendingDays, {
    props: {
      usage,
      by: 'work_item',
      measure: options.measure ?? 'time',
      readAt: options.readAt ?? WEDNESDAY,
      accounts: options.accounts ?? 'loading',
    },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

/** The days' table, as a reader opens it by the chart's switch. */
async function daysTable(days: ReturnType<typeof mountDays>) {
  await showView(days, '.spending-days', 'Table')
  return days.getComponent(PeriodColumnsTable)
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
    // The five largest tasks take the hues by rank; no task and unknown are their own series in
    // one neutral, never a hue; task 6 is «other», in the other neutral on top of them.
    expect(series.map((one) => [one.key, one.slot])).toEqual([
      ...[1, 2, 3, 4, 5].map((number) => [`v:${task(number, '').id}`, number]),
      ['none', 'apart'],
      ['unknown', 'apart'],
      ['other', 'other'],
    ])
    const columns = dayColumns(source, series, WEDNESDAY)
    expect(columns[0]?.values.other).toBe(5)
    expect(columns[1]?.values).toEqual({ none: 60 / 3600, unknown: 120 / 3600 })
    const legend = mountDays(usage).get('.chart-legend').text()
    expect(legend).toContain('No task')
    expect(legend).toContain('Unknown')
  })

  it('show a day whose work has no price as absent, never as a zero', async () => {
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
    const priced = await daysTable(mountDays(usage, options))
    const rows = priced
      .findAll('tbody tr')
      .map((row) => row.findAll('td').map((cell) => cell.text()))
    // The columns: MAIN-1, MAIN-2, the total and the note.
    expect(rows[0]?.slice(0, 3)).toEqual(['$2.00', '0', '$2.00'])
    expect(rows[1]).toEqual(['0', '—No price', '—No price', 'No price: MAIN-2 Two'])
    expect(rows[2]?.slice(0, 3)).toEqual(['0', '0', '0'])
  })

  // A press on a part of a day once acted for the day: it now does what the part's row does.
  it('let a value open its side panel from its segment and legend entry, and the folded tail lead nowhere', async () => {
    const days = mountDays(
      week([...STRETCHES, { day: 1, group: { work_item: noTask }, spend: { seconds: 9 * 3600 } }]),
    )
    // Every value the read can filter by is a control, each task and work with no task alike; a
    // task the app has no card link for here is one too, and the folded tail is not.
    const series = (at: string) => days.findAll(at).map((one) => one.attributes('data-series'))
    expect(series('.period-segment')).toEqual(expect.arrayContaining(['none', 'other']))
    const values = series('.period-segment').filter((key) => key !== 'other')
    expect(new Set(series('button.period-segment'))).toEqual(new Set(values))
    const none = days.findAll('button.period-segment[data-series="none"]')
    const folded = days.findAll('.period-segment[data-series="other"]')
    expect(folded.length).toBeGreaterThan(0)
    for (const one of folded) {
      expect(one.element.tagName).toBe('SPAN')
    }
    // The folded tail only shows: a segment has no hint of its own, and its day's hint names it.
    expect(spokenDays(days).some((day) => day.holds.includes('Other'))).toBe(true)

    await none[0]?.trigger('click')
    await days.get('button.chart-key[data-series="none"]').trigger('click')
    await days.findAll('.period-segment[data-series="other"]')[0]?.trigger('click')
    expect(days.emitted('inspect')).toEqual([
      [null, 'No task'],
      [null, 'No task'],
    ])
    expect(days.emitted('step')).toBeUndefined()
    await days.get('button.period-column').trigger('click')
    expect(days.emitted('step')).toHaveLength(1)
  })

  it('mark the day not over yet as running, and only that day', () => {
    const days = mountDays(week())
    const stacks = days.findAll('.period-stack').map((stack) => stack.classes('period-incomplete'))
    expect(stacks).toEqual([false, false, true])
    // Its hatching and its hint say it is under way: no word stands under its name, and no line
    // of words over the plot, whose words are its edges' labels alone (`plotWords`, which
    // periodColumns.spec.ts shows reading a legend and both edges present).
    expect(spokenDays(days).at(-1)?.holds).toContain('running')
    const { edges, stray } = plotWords(days.get('figure').element)
    expect(edges.flatMap((edge) => edge.labels).join(' ')).not.toContain('running')
    expect(stray).toEqual([])
  })

  it('mark no day once the period is over', () => {
    const days = mountDays(week(), { readAt: new Date(2026, 10, 12, 9) })
    expect(days.find('.period-incomplete').exists()).toBe(false)
    expect(days.text()).not.toContain('running')
  })

  it('mark where the accounts that worked change, past a day nobody worked', () => {
    expect(accountChanges(byAccount(), 'time').map((change) => change.at)).toEqual([
      momentAt(new Date(2026, 10, 12)),
      momentAt(new Date(2026, 10, 13)),
    ])
    const days = mountDays(fiveDays(), { accounts: byAccount(), readAt: AFTER })
    expect(days.findAll('.period-mark')).toHaveLength(2)
    // Said where the day is read, in its hint below, and nowhere in the section's words: not in a
    // note under the chart, nor in a row over the plot.
    expect(days.text()).not.toContain('Account change')
    // A span of time keeps its figure and unit together with a space no line breaks at.
    const hint = (index: number) =>
      (spokenDays(days)[index]?.holds ?? '').replaceAll(/[^\S\n]/gu, ' ')
    expect(hint(4)).toBe(
      'Friday, November 13: total 1 h\nAccount change: +acc-a\nMAIN-1 One 1 h, 100% of the total',
    )
    expect(hint(3)).toBe(
      'Thursday, November 12: total 1 h\nAccount change: +acc-b, −acc-a\nMAIN-1 One 1 h, 100% of the total',
    )
  })

  it('read as their table, pressed, with the same days, the running one and the marks', async () => {
    const days = mountDays(week())
    const rows = await daysTable(days).then((table) => table.findAll('tbody tr'))
    expect(days.findComponent(PeriodColumns).exists()).toBe(false)
    expect(rows).toHaveLength(3)
    expect(rows.at(-1)?.text()).toContain('running')

    const marked = await daysTable(mountDays(fiveDays(), { accounts: byAccount(), readAt: AFTER }))
    const notes = marked.findAll('tbody tr').map((row) => row.findAll('td').at(-1)?.text() ?? '')
    expect(notes).toEqual(['', '', '', 'Account change: +acc-b, −acc-a', 'Account change: +acc-a'])
  })

  it('name the month on the axis at its first day and where a new month starts', async () => {
    // 27 October to 2 November; unmeasured, the axis names the first day and the last.
    const usage = usageAnswer({
      first: new Date(2026, 9, 27),
      days: 7,
      groupBy: ['work_item'],
      stretches: [{ day: 0, group: { work_item: task(1, 'One') }, spend: { seconds: 3600 } }],
    }).usage
    const names = (locale: 'en' | 'ru') =>
      mountDays(usage, { readAt: AFTER }, locale)
        .findAll('.period-axis .chart-tick')
        .map((tick) => tick.text())
    expect(names('en')).toEqual(['Oct 27', 'Nov 2'])
    expect(names('ru')).toEqual(['27 окт.', '2 нояб.'])
    // The table names every day in full, its month included.
    const named = await daysTable(mountDays(usage, { readAt: AFTER }))
    const rows = named.findAll('tbody th').map((name) => name.text())
    expect(rows[0]).toBe('Tuesday, October 27')
    expect(rows[5]).toBe('Sunday, November 1')
  })

  it('say the same in Russian', () => {
    const days = mountDays(week(), {}, 'ru')
    expect(days.get('h2').text()).toBe('Время агентов по дням, по задачам')
    expect(days.get('.period-axis').text()).not.toContain('идёт')
  })
})

/** Work no reading places on any account, of no organization known: no account, only work. */
const UNRECORDED = 'unrecorded'

/** An answer by account over a day per entry, each day worked by the accounts it names. */
function daysOf(...days: readonly (readonly string[])[]): Usage {
  return usageAnswer({
    first: MONDAY,
    days: days.length,
    groupBy: ['seat'],
    stretches: days.flatMap((accounts, day) =>
      accounts.map((account) =>
        account === UNRECORDED
          ? { day, group: {}, spend: { seconds: 3600 } }
          : worked(day, account, 1),
      ),
    ),
  }).usage
}

/** The days a change stands on, by index, with the known accounts before, after, come and gone. */
const changesOf = (byAccount: Usage) =>
  accountChanges(byAccount, 'time').map((change) => ({
    day: byAccount.series.findIndex((point) => point.start === change.at),
    before: change.before.map((account) => account.id),
    after: change.after.map((account) => account.id),
    came: change.came.map((account) => account.id),
    left: change.left.map((account) => account.id),
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

// Work no reading places on an account, of an organization or of none, is not an account: it is
// neither a change nor hides one.
describe('the account marks', () => {
  it('mark no change where unrecorded work joins the same accounts', () => {
    expect(changesOf(daysOf([A], [A, UNRECORDED]))).toEqual([])
    expect(changesOf(daysOf([A], [A, UNPLACED]))).toEqual([])
  })

  it('mark no change across a day of unrecorded work alone between the same account', () => {
    expect(changesOf(daysOf([A], [UNRECORDED], [A]))).toEqual([])
    expect(changesOf(daysOf([A], [UNPLACED], [A]))).toEqual([])
  })

  it('mark the change hidden behind a day of unrecorded work on the day the new account works', () => {
    const change = { day: 2, before: [A], after: [B], came: [B], left: [A] }
    expect(changesOf(daysOf([A], [UNRECORDED], [B]))).toEqual([change])
    expect(changesOf(daysOf([A], [UNPLACED], [B]))).toEqual([change])
  })

  it('mark the accounts with a figure above zero in the measure shown, and only those', () => {
    // B joins on the second day with an hour of work, no token counted and no price.
    const usage = usageAnswer({
      first: MONDAY,
      days: 2,
      groupBy: ['seat'],
      stretches: [
        { day: 0, group: { seat: seatValue(A) }, spend: { seconds: 3600, tokens: 9, cost: 1 } },
        { day: 1, group: { seat: seatValue(A) }, spend: { seconds: 3600, tokens: 9, cost: 1 } },
        { day: 1, group: { seat: seatValue(B) }, spend: { seconds: 3600, unpriced: 5 } },
      ],
    }).usage
    const at = (measure: Measure) => accountChanges(usage, measure).map((change) => change.at)
    expect(at('time')).toEqual([usage.series[1]?.start])
    expect(at('tokens')).toEqual([])
    expect(at('cost')).toEqual([])
    // The chart reads the marks in the measure it draws.
    const days = mountDays(everyDay(2), { accounts: usage, measure: 'cost', readAt: AFTER })
    expect(days.findAll('.period-mark')).toHaveLength(0)
  })

  it('mark a change where a known account joins or leaves, by the account that came or left', () => {
    const joined = { day: 1, before: [A], after: [A, B], came: [B], left: [] }
    expect(changesOf(daysOf([A], [A, B]))).toEqual([joined])
    const gone = { day: 1, before: [A, B], after: [A], came: [], left: [B] }
    expect(changesOf(daysOf([A, B], [A]))).toEqual([gone])
  })

  it('say the change in the hint of its day and to a screen reader by the known accounts alone', async () => {
    const accounts = daysOf([A], [UNRECORDED], [B, UNPLACED, UNRECORDED], [B])
    const days = mountDays(everyDay(4), { accounts, readAt: AFTER })
    expect(days.findAll('.period-mark')).toHaveLength(1)
    const named = spokenDays(days).map((day) => day.holds)
    expect(named.map((name) => name.includes('Account change:'))).toEqual([
      false,
      false,
      true,
      false,
    ])
    expect(named[2]).toContain('Account change: +acc-b, −acc-a')
    expect(named.join(' ')).not.toContain('Unknown')
    expect(named.join(' ')).not.toContain('account not known')
    // A day is a button named by what pressing it does, then by the change at its start.
    expect(spokenDays(days)[2]?.name).toMatch(/\. Account change: \+acc-b, −acc-a$/u)

    const table = await daysTable(mountDays(everyDay(4), { accounts, readAt: AFTER }))
    const notes = table.findAll('tbody tr').map((row) => row.findAll('td').at(-1)?.text() ?? '')
    expect(notes).toEqual(['', '', 'Account change: +acc-b, −acc-a', ''])
  })
})

describe('the days on the page', () => {
  it('ask for the period by account beside the page read, and not again when it is by account', async () => {
    const reads = stubAnalyticsReads((query) =>
      query.get('group_by') === 'seat'
        ? { interface_version: 'valkama-analytics-api', usage: byAccount() }
        : { interface_version: 'valkama-analytics-api', usage: week() },
    )
    const page = await mountAnalytics()
    await flushPromises()
    const accounts = reads.grouped('seat')
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.get('compare')).toBeNull()
    expect(accounts[0]?.get('from')).toBe(reads.grouped('work_item')[0]?.get('from'))
    expect(page.findComponent(PeriodColumns).exists()).toBe(true)

    // By account, the page's own answer is the accounts: its read and the same days of the week
    // before, and no third read.
    const asked = reads.asked.length
    const byAccountPage = await mountAnalytics({ routeState: { by: 'seat' } })
    await flushPromises()
    expect(byAccountPage.findComponent(PeriodColumns).exists()).toBe(true)
    expect(reads.asked.slice(asked).map((query) => query.get('group_by'))).toEqual(['seat', 'seat'])
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

  it('label each day by the date the read gave it, not the browser’s date that night', async () => {
    // The zone is fixed: the first two days are still at +01:00 in the browser's own time.
    expect(new Date(2026, 2, 27).getTimezoneOffset()).toBe(-60)
    const readAt = new Date(2026, 3, 1)
    const table = await daysTable(mountDays(acrossTheChange(), { readAt }))
    expect(table.findAll('tbody th').map((name) => name.text())).toEqual([
      'Friday, March 27',
      'Saturday, March 28',
      'Sunday, March 29',
      'Monday, March 30',
    ])
    const axis = mountDays(acrossTheChange(), { readAt }).get('.period-axis').text()
    expect(axis).toContain('Mar 27')
    expect(axis).toContain('30 Mon')
  })
})
