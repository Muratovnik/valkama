/**
 * A value whose figure is less than the least its unit shows, «under a minute», says nothing of how
 * much, so no view of a section names it: the ring's sectors and legend, the ranked bars, the small
 * charts, the day chart's legend and the table twin of each (DESIGN.md, Charts; `drawnLines`). The
 * oracle is that rule and the fixture's own seconds: a value of 30 seconds is left out of every
 * view, one of exactly a minute stays in every view, and every share a view says is still of all
 * three values, 330 seconds. A list made only of such values still draws them.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingMultiples from '@/pages/analytics/components/SpendingMultiples.vue'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

import { usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'
import { showView } from '../support/chartViews.ts'
import { seriesEntries, seriesNames } from '../support/legend.ts'

const MONDAY = new Date(2026, 10, 9)
const AFTER = new Date(2026, 10, 20)

/** Four minutes, half a minute and one minute: 330 seconds in all. */
const STRETCHES: Stretch[] = [
  { day: 0, group: { model: value('model-big') }, spend: { seconds: 240 } },
  { day: 1, group: { model: value('model-tiny') }, spend: { seconds: 30 } },
  { day: 2, group: { model: value('model-minute') }, spend: { seconds: 60 } },
]

const usageOf = (stretches: readonly Stretch[] = STRETCHES) =>
  usageAnswer({ first: MONDAY, days: 7, groupBy: ['model'], stretches }).usage

/** Each value in a hue of its own, as the page ranks them, so the ring names each it draws. */
const SLOTS = new Map<string, SeriesSlot>([
  ['v:model-big', 1],
  ['v:model-minute', 2],
  ['v:model-tiny', 3],
  ['v:model-a', 1],
  ['v:model-b', 2],
])

const props = (stretches?: readonly Stretch[]) => ({
  by: 'model' as const,
  measure: 'time' as const,
  slots: SLOTS,
  usage: usageOf(stretches),
})

const global = { plugins: [analyticsI18n('en')] }

const bars = (stretches?: readonly Stretch[]) => {
  const given = props(stretches)
  return mount(SpendingBars, { props: { ...given, rows: given.usage.rows }, global })
}

/** The keys of the ring's sectors, in its order (`data-sector` with its `data-key`). */
const sectorKeys = (host: ReturnType<typeof bars>) =>
  host.findAll('[data-sector]').map((sector) => sector.attributes('data-key'))

/** The names of a table's rows, by their row headers. */
const rowNames = (host: Pick<ReturnType<typeof bars>, 'findAll'>) =>
  host.findAll('tbody th[scope="row"]').map((cell) => cell.text())

describe('a value under a minute', () => {
  it('is no sector of the ring and no line of its legend, which keeps the minute', () => {
    const ring = bars()
    expect(ring.get('.spending-bars').attributes('data-shown')).toBe('ring')
    expect(sectorKeys(ring)).toEqual(['v:model-big', 'v:model-minute'])
    expect(seriesNames(ring)).toEqual(['model-big', 'model-minute'])
  })

  it('leaves every share in the legend of all the values, the half minute counted', () => {
    const entries = seriesEntries(bars())
    expect(entries).toHaveLength(2)
    // 240 of 330 seconds and 60 of 330; without the half minute they would read 80 % and 20 %.
    expect(entries[0]?.text()).toContain('73%')
    expect(entries[1]?.text()).toContain('18%')
  })

  it('is no bar and no row of the bars’ table', async () => {
    const shown = bars()
    await showView(shown, '.spending-bars', 'Bars')
    expect(shown.findAll('.ranked-line').map((line) => line.attributes('data-key'))).toEqual([
      'v:model-big',
      'v:model-minute',
    ])
    await showView(shown, '.spending-bars', 'Table')
    expect(rowNames(shown)).toEqual(['model-big', 'model-minute'])
  })

  it('has no small chart and no row of their table', async () => {
    const multiples = mount(SpendingMultiples, { props: props(), global })
    expect(multiples.findAll('[data-key]').map((one) => one.attributes('data-key'))).toEqual([
      'v:model-big',
      'v:model-minute',
    ])
    await showView(multiples, '.spending-multiples', 'Table')
    expect(rowNames(multiples)).toEqual(['model-big', 'model-minute'])
  })

  it('is no series of the day chart or of its table', async () => {
    const days = mount(SpendingDays, {
      props: { ...props(), readAt: AFTER, accounts: 'loading' as const },
      global,
    })
    expect(seriesNames(days)).toEqual(['model-big', 'model-minute'])
    await showView(days, '.spending-days', 'Table')
    const columns = days.findAll('thead th[scope="col"]').map((cell) => cell.text())
    expect(columns).toEqual(expect.arrayContaining(['model-big', 'model-minute']))
    expect(columns).not.toContain('model-tiny')
  })

  it('is drawn where every value is one, as a chart of nothing else would read as empty', () => {
    const ring = bars([
      { day: 0, group: { model: value('model-a') }, spend: { seconds: 20 } },
      { day: 1, group: { model: value('model-b') }, spend: { seconds: 10 } },
    ])
    expect(seriesNames(ring)).toEqual(['model-a', 'model-b'])
  })
})
