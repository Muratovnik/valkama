/**
 * The panel of a dimension on the Analytics page. The oracle is the requirement: a value has one
 * hue in its small chart, its bar and the key of the day chart, each beside its name, and work
 * nobody can place stands apart in the neutral; the small charts say their one scale once; a
 * second dimension in the address splits the section: it is read with the first over the page's
 * own period and filters, and the period before too, and the ranked bars and the table read its
 * pairs, each pair in the hue of its rank among every pair of the read; choosing one, or none, in
 * the section's heading writes it into the address as a step of its own.
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
    // small chart and a bar of its own on the values' scale, in the neutral of what is not a
    // value, never the lighter one of the folded rest.
    expect(text(page, '.spending-multiples .multiples-apart .multiple-name')).toEqual([])
    expect(multiples.get('Unknown')).toBe('apart')
    expect(bars.get('Unknown')).toBe('apart')
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

describe('the split of a section', () => {
  it('is read with the first over the page’s period and filters, and the period before', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    await mountAnalytics({ projectId: 'sample', routeState: { by: 'model', across: 'role' } })
    const own = reads.grouped('model').at(0)
    const crossed = reads.grouped('model,role')
    expect(crossed).toHaveLength(2)
    const [now, before] = crossed
    // The period as the answer on show wrote it: from Monday's midnight to the moment it was read.
    expect(Date.parse(now?.get('from') ?? '')).toBe(new Date(2026, 10, 9).getTime())
    expect(Date.parse(now?.get('to') ?? '')).toBe(Date.parse(own?.get('to') ?? ''))
    // The period before ends where the week before reached by the same moment of its Wednesday.
    expect(Date.parse(before?.get('from') ?? '')).toBe(new Date(2026, 10, 2).getTime())
    expect(Date.parse(before?.get('to') ?? '')).toBeLessThan(Date.parse(now?.get('from') ?? ''))
    for (const read of crossed) {
      for (const key of ['utc_offset', 'project']) expect(read?.get(key)).toBe(own?.get(key))
      expect(read?.get('compare')).not.toBe('true')
    }
  })

  it('makes each bar and each row of the table a pair, in the hue of its rank', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model', across: 'role' } })
    const bars = huesIn(page, '.spending-bars .ranked-row', '.ranked-label', '[data-slot]')
    // Largest first: model-a by the main agent, model-b and model-c by the adviser take the first
    // three hues in order; the work of no known model is no pair of two values, in the neutral.
    expect([...bars]).toEqual([
      ['model-a · Main agent', '1'],
      ['model-b · Adviser', '2'],
      ['Unknown · Main agent', 'apart'],
      ['model-c · Adviser', '3'],
    ])
    expect(text(page, '.spending-table tbody th')).toEqual([...bars.keys()])
    // The small charts still read the section's own values: the read gives no pair a period.
    expect(text(page, '.spending-multiples .multiple-name')).toContain('model-a')
  })

  it('is chosen in the section’s heading, written into the address as a step, and taken out with none', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model' } })
    expect(page.find('.spending-table').findComponent(ChoiceSelect).exists()).toBe(false)
    const choice = page.get('.dimension-section .level-head').getComponent({ name: 'ChoiceSelect' })
    const labels = (choice.props('options') as { label: string }[]).map((option) => option.label)
    // «None», then every dimension of the page but the section's own.
    expect(labels[0]).toBe('None')
    expect(labels).toContain('Effort')
    expect(labels).not.toContain('Model')
    choice.vm.$emit('update:modelValue', 'role')
    await page.setProps({ routeState: { by: 'model', across: 'role' } })
    choice.vm.$emit('update:modelValue', 'none')
    const written = page.emitted<[Record<string, string>, string]>('state') ?? []
    expect(written.at(-2)?.[0].across).toBe('role')
    expect(written.at(-2)?.[1]).toBe('push')
    expect(written.at(-1)?.[0].across).toBeUndefined()
    expect(written.at(-1)?.[0].by).toBe('model')
    expect(written.at(-1)?.[1]).toBe('push')
  })
})
