/**
 * What the overview's chart stacks the period by, held to DESIGN.md § Analytics: by project, each
 * project a series named in the legend, and at a project's scope that project's one series of
 * plain columns that no legend names; the tasks keep their own section, whose chart still stacks
 * the period by task. The rows are made up: three projects, a task each, over two days.
 */
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'

import PeriodColumns from '@/shared/ui/PeriodColumns.vue'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)

/** An hour on alpha, two on beta and three on gamma, a task of its own each. */
const WORLD: TimedStretch[] = (
  [
    ['alpha', 1, 'One', 3600],
    ['beta', 2, 'Two', 7200],
    ['gamma', 3, 'Three', 10_800],
  ] as const
).map(([project, number, title, seconds], at) => ({
  at: new Date(2026, 10, 9 + (at % 2), 10),
  group: { project: value(project), work_item: task(number, title), role: value('main') },
  spend: { seconds },
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  stubAnalyticsReads((query) => serveUsage(WORLD, query))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()
/** Names in their alphabetical order, whatever order the stack ranks them in. */
const sorted = (names: readonly string[]) =>
  [...names].sort((one, other) => one.localeCompare(other))

/** The days chart the page shows, its dimension, its series' names and what its legend names. */
function chartOf(page: VueWrapper) {
  const charts = page.findAllComponents(SpendingDays)
  expect(charts).toHaveLength(1)
  const chart = charts[0]
  if (!chart) throw new Error('no days chart')
  return {
    by: chart.props('by'),
    title: words(chart.get('.level-heading').text()),
    series: chart
      .getComponent(PeriodColumns)
      .props('series')
      .map((one) => one.label),
    legend: chart
      .findAll('[data-hint-list="legend"] [data-series] [data-part="name"]')
      .map((one) => words(one.text())),
  }
}

describe('the overview’s chart', () => {
  for (const [locale, title, byTask] of [
    ['en', 'by project', 'by task'],
    ['ru', 'по проектам', 'по задачам'],
  ] as const)
    it(`stacks every project's period as its own series, named in the legend, in ${locale}`, async () => {
      const page = await mountAnalytics({}, locale)
      const chart = chartOf(page)
      expect(chart.by).toBe('project')
      expect(sorted(chart.series)).toEqual(['alpha', 'beta', 'gamma'])
      expect(sorted(chart.legend)).toEqual(['alpha', 'beta', 'gamma'])
      expect(chart.title).toContain(title)
      // Nothing on the overview says it is split by task.
      expect(words(page.get('.analytics-panel').text())).not.toContain(byTask)
    })

  it('draws the one project of a project’s scope as plain columns that no legend names', async () => {
    const page = await mountAnalytics({ projectId: 'alpha' })
    const chart = chartOf(page)
    expect(chart.by).toBe('project')
    expect(chart.series).toEqual(['alpha'])
    expect(chart.legend).toEqual([])
    expect(page.findAll('[data-series="other"]')).toHaveLength(0)
  })
})

describe('the task section’s chart', () => {
  it('still stacks the period by task, each task its own series', async () => {
    const page = await mountAnalytics({ routeState: { by: 'work_item' } })
    const chart = chartOf(page)
    expect(chart.by).toBe('work_item')
    expect(chart.title).toContain('by task')
    expect(chart.legend).toHaveLength(3)
    for (const name of ['One', 'Two', 'Three'])
      expect(
        chart.legend.some((one) => one.includes(name)),
        name,
      ).toBe(true)
  })
})
