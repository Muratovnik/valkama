/**
 * An entry of a breakdown — one value in one day — whose figure is less than the least its unit
 * shows, «under a minute», says nothing of how much, so no view of that day names it, as none
 * names a value that did not work that day (DESIGN.md, Charts; `unnamedEntries`): the day's hint
 * does not list it, its table cell and a small chart's hint read «0 min», and the section's table
 * reads the same of a value whose whole period is under a minute. Every total still counts it:
 * the day's, the value's own over the period and the section's.
 *
 * The oracle is that rule and the fixture's own seconds, chosen so a total that lost an entry
 * reads a minute less: model-a works 45 s on Monday and 585 s on Tuesday (630 s, «10 min»;
 * without Monday «9 min»), model-b 285 s and 120 s, and model-c 50 s and model-d 40 s on Tuesday
 * alone, each under a minute in the period, so no series stands for them, though together they
 * hold more than one. Monday is 330 s, «5 min» (without model-a «4 min»); Tuesday 795 s, «13 min»
 * (without model-c and model-d «11 min»); the section 1,125 s, «18 min» (without model-c «17 min»).
 */
import { mount } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingMultiples from '@/pages/analytics/components/SpendingMultiples.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import ValueDays from '@/pages/analytics/components/ValueDays.vue'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

import { usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'
import { showView } from '../support/chartViews.ts'

const MONDAY = new Date(2026, 10, 9)
const AFTER = new Date(2026, 10, 20)

const STRETCHES: Stretch[] = [
  { day: 0, group: { model: value('model-a') }, spend: { seconds: 45 } },
  { day: 1, group: { model: value('model-a') }, spend: { seconds: 585 } },
  { day: 0, group: { model: value('model-b') }, spend: { seconds: 285 } },
  { day: 1, group: { model: value('model-b') }, spend: { seconds: 120 } },
  { day: 1, group: { model: value('model-c') }, spend: { seconds: 50, tokens: 5000 } },
  { day: 1, group: { model: value('model-d') }, spend: { seconds: 40 } },
]

const usageOf = (stretches: readonly Stretch[] = STRETCHES) =>
  usageAnswer({ first: MONDAY, days: 2, groupBy: ['model'], stretches }).usage

const SLOTS = new Map<string, SeriesSlot>([
  ['v:model-a', 1],
  ['v:model-b', 2],
  ['v:model-c', 3],
  ['v:model-d', 4],
])

const global = { plugins: [analyticsI18n('en')] }

/** Text with every run of space, a no-break one too, read as one space. */
const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** Each body row of the table shown, as it reads: its heading cell, then every cell. */
const tableRows = (host: Pick<DOMWrapper<Element>, 'findAll'>) =>
  host.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => words(cell.text())))

const UNDER = 'under a minute'

const days = () =>
  mount(SpendingDays, {
    props: {
      usage: usageOf(),
      by: 'model',
      measure: 'time',
      readAt: AFTER,
      accounts: 'loading',
    },
    global,
  })

/** What each day says in its hint, by the day's own mark (`.period-column`, its own spec's part). */
const dayHints = (host: Pick<DOMWrapper<Element>, 'findAll'>) =>
  host.findAll('.period-column').map((day) => words(day.attributes('data-tooltip') ?? ''))

describe('a value under a minute in one day of the day chart', () => {
  it('is not in that day’s hint, which says the day’s whole total, and is on the other day', () => {
    const hints = dayHints(days())
    expect(hints).toHaveLength(2)
    expect(hints[0]).toContain('total 5 min')
    expect(hints[0]).toContain('model-b 4 min')
    expect(hints[0]).not.toContain('model-a')
    // The present control: the same series where its day holds more than a minute.
    expect(hints[1]).toContain('model-a 9 min')
    // Tuesday counts model-c and model-d too, which no series names: each is under a minute in
    // the period.
    expect(hints[1]).toContain('total 13 min')
    expect(hints[1]).not.toContain('model-c')
    expect(hints[1]).not.toContain('model-d')
    for (const hint of hints) expect(hint).not.toContain(UNDER)
  })

  it('keeps its whole figure over the period in its legend entry', () => {
    const key = days().get('[data-hint-list="legend"] [data-series="v:model-a"]')
    expect(words(key.attributes('data-tooltip') ?? '')).toContain('10 min')
  })

  it('reads «0 min» in that day’s cell of the table, which keeps the day’s total', async () => {
    const shown = days()
    await showView(shown, '.spending-days', 'Table')
    const heads = shown.findAll('thead th').map((cell) => words(cell.text()))
    const at = (name: string) => heads.indexOf(name)
    expect(at('model-a')).toBeGreaterThan(0)
    const rows = tableRows(shown)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.[at('model-a')]).toBe('0 min')
    expect(rows[0]?.[at('model-b')]).toBe('4 min')
    expect(rows[0]?.[at('total')]).toBe('5 min')
    expect(rows[1]?.[at('model-a')]).toBe('9 min')
    expect(rows[1]?.[at('total')]).toBe('13 min')
    expect(words(shown.text())).not.toContain(UNDER)
  })
})

const multiples = () =>
  mount(SpendingMultiples, {
    props: { by: 'model', measure: 'time', slots: SLOTS, usage: usageOf() },
    global,
  })

describe('a value under a minute in one day of the small charts', () => {
  it('says what a day of nothing says in that day’s hint, and its figure on the other', () => {
    const chart = multiples().get('[data-key="v:model-a"]')
    // The chart's name and its two days, each with its hint.
    const hints = chart
      .findAll('[data-tooltip]')
      .map((one) => words(one.attributes('data-tooltip') ?? ''))
    expect(hints).toHaveLength(3)
    expect(hints[1]).toMatch(/: 0 min$/u)
    expect(hints[2]).toMatch(/: 9 min$/u)
    // Its figure over the period counts the day it does not name.
    expect(words(chart.text())).toContain('10 min')
    for (const hint of hints) expect(hint).not.toContain(UNDER)
  })

  it('reads «0 min» in that day’s cell of their table', async () => {
    const shown = multiples()
    await showView(shown, '.spending-multiples', 'Table')
    const row = tableRows(shown).find((one) => one[0] === 'model-a')
    // Its name, its two days, then its figure over the period, which counts the day it does not name.
    expect(row).toEqual(['model-a', '0 min', '9 min', '10 min'])
    expect(words(shown.text())).not.toContain(UNDER)
  })
})

describe('a value under a minute in its side panel’s days', () => {
  it('is not named in that day, which keeps its total, and is on the other day', () => {
    const own = STRETCHES.filter((one) => one.group.model?.id === 'model-a')
    const panel = mount(ValueDays, {
      props: {
        before: null,
        hue: 1,
        measure: 'time',
        name: 'model-a',
        readAt: AFTER,
        usage: usageOf(own),
      },
      global,
    })
    const hints = dayHints(panel)
    expect(hints).toHaveLength(2)
    expect(hints[0]).not.toContain('model-a')
    expect(hints[1]).toContain('model-a 9 min')
  })
})

describe('a value whose period is under a minute in the section’s table', () => {
  it('reads «0 min» under time, keeps its other measures, and the total counts it', () => {
    const table = mount(SpendingTable, {
      props: {
        across: null,
        cross: { status: 'off' },
        by: 'model',
        filters: {},
        measure: 'time',
        usage: usageOf(),
      },
      global,
    })
    const rows = tableRows(table)
    const row = rows.find((one) => one[0] === 'model-c')
    expect(row?.slice(0, 3)).toEqual(['model-c', '0 min', '5K'])
    // The present control: a value of a minute or more says its minutes.
    expect(rows.find((one) => one[0] === 'model-a')?.[1]).toBe('10 min')
    // 1,125 seconds in all: without model-c's 50 the total would read «17 min».
    expect(words(table.get('tfoot td[data-measure="time"]').text())).toBe('18 min')
    expect(words(table.text())).not.toContain(UNDER)
  })
})
