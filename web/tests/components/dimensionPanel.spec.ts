/**
 * The panel of a dimension on the Analytics page. The oracle is the requirement: a value has one
 * hue in its small chart, its bar and the key of the day chart, each beside its name, and work
 * nobody can place stands apart in the neutral; the small charts say their one scale once; a
 * second dimension in the address is read with the first over the page's own period and filters
 * and crosses the table, and choosing one, or none, in the table writes it into the address.
 */
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon; the week read by default runs from Monday the 9th to now. */
const NOW = new Date(2026, 10, 11, 14, 30)
const MONDAY = new Date(2026, 10, 9, 10)
const TUESDAY = new Date(2026, 10, 10, 10)

const ROLE = { main: value('main'), advisor: value('advisor') }
const PROJECT = { project: value('sample') }

/**
 * Three models over two days and an hour of work under no known model: model-a leads with 2 h
 * 36 min on Monday, model-b on Tuesday alone, model-c least. Every stretch is in the project
 * «sample».
 */
const WORLD: TimedStretch[] = [
  {
    at: MONDAY,
    group: { work_item: task(1, 'Task 1'), model: value('model-a'), role: ROLE.main, ...PROJECT },
    spend: { seconds: 9360 },
  },
  {
    at: TUESDAY,
    group: {
      work_item: task(2, 'Task 2'),
      model: value('model-b'),
      role: ROLE.advisor,
      ...PROJECT,
    },
    spend: { seconds: 2 * 3600 },
  },
  {
    at: MONDAY,
    group: {
      work_item: task(1, 'Task 1'),
      model: value('model-c'),
      role: ROLE.advisor,
      ...PROJECT,
    },
    spend: { seconds: 1800 },
  },
  {
    at: TUESDAY,
    group: { work_item: task(2, 'Task 2'), role: ROLE.main, ...PROJECT },
    spend: { seconds: 3600 },
  },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const text = (page: VueWrapper, selector: string) =>
  page.findAll(selector).map((one) => one.text().replaceAll(/\s+/gu, ' ').trim())

/**
 * The hue each name is drawn in by a part of the panel: its row, the name in it, the hue in it;
 * undefined for a row that draws nothing.
 */
function huesIn(page: VueWrapper, row: string, name: string, hue: string) {
  return new Map(
    page.findAll(row).map((one) => {
      const [drawn] = one.findAll(hue)
      return [one.get(name).text(), drawn?.attributes('data-slot')]
    }),
  )
}

describe('the panel of a dimension', () => {
  it('draws a value in one hue in its small chart, its bar and the day chart’s key', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model' } })

    const multiples = huesIn(
      page,
      '.spending-multiples li.multiple',
      '.multiple-name',
      '.multiple-column',
    )
    const bars = huesIn(page, '.spending-bars .ranked-row', '.ranked-label', '[data-slot]')
    const days = huesIn(page, '.spending-days .chart-key', '.chart-key-name', '.chart-swatch')
    const names = ['model-a', 'model-b', 'model-c']
    const hues = names.map((name) => multiples.get(name))
    expect(names.map((name) => bars.get(name))).toEqual(hues)
    expect(names.map((name) => days.get(name))).toEqual(hues)
    // Three hues, none of them the neutral the unplaced work is drawn in.
    expect(new Set(hues).size).toBe(3)
    expect(hues).not.toContain('other')
    expect(hues).not.toContain(undefined)

    // Work under no known model is no value of the dimension: it is ranked by its figure, with a
    // small chart and a bar of its own on the values' scale, in the neutral hue.
    expect(text(page, '.spending-multiples .multiples-apart .multiple-name')).toEqual([])
    expect(multiples.get('Unknown')).toBe('other')
    expect(bars.get('Unknown')).toBe('other')
  })

  it('writes the top of the small charts’ one scale once', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model' } })
    const figure = page.get('.spending-multiples').text()
    expect(figure.match(/Every chart from 0 to/gu)).toHaveLength(1)
    // The largest day is model-a's 2 h 36 min on Monday: the scale's top is the round step past it.
    expect(text(page, '.spending-multiples .multiples-scale')).toEqual([
      'Every chart from 0 to 3 h',
    ])
  })
})

describe('a second dimension', () => {
  it('is read with the first over the page’s period and filters, and crosses the table', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({
      projectId: 'sample',
      routeState: { by: 'model', across: 'role' },
    })
    const own = reads.grouped('model').at(0)
    const crossed = reads.grouped('model,role')
    expect(crossed).toHaveLength(1)
    // The period as the answer on show wrote it: from Monday's midnight to the moment it was read.
    expect(Date.parse(crossed[0]?.get('from') ?? '')).toBe(new Date(2026, 10, 9).getTime())
    expect(Date.parse(crossed[0]?.get('to') ?? '')).toBe(Date.parse(own?.get('to') ?? ''))
    for (const key of ['utc_offset', 'project']) expect(crossed[0]?.get(key)).toBe(own?.get(key))
    expect(crossed[0]?.get('compare')).not.toBe('true')

    expect(text(page, '.spending-table thead th')).toEqual([
      'Model',
      'Main agent',
      'Adviser',
      'Total',
    ])
  })

  it('is written into the address when chosen in the table, and taken out with none', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model' } })
    const choice = page.get('.spending-table-across').findComponent(ChoiceSelect)
    choice.vm.$emit('update:modelValue', 'role')
    await page.setProps({ routeState: { by: 'model', across: 'role' } })
    choice.vm.$emit('update:modelValue', 'none')
    const written = (page.emitted<[Record<string, string>]>('state') ?? []).map(([state]) => state)
    expect(written.at(-2)?.across).toBe('role')
    expect(written.at(-1)?.across).toBeUndefined()
    expect(written.at(-1)?.by).toBe('model')
  })
})
