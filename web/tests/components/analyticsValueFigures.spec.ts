/**
 * What a value's side panel says its figures are of. The oracle is the requirement: the heading of
 * the figures names the period they cover, in the words the page names a period by — its first
 * and last day, «Nov 9 – 11» — and follows the page's period when it changes; a task's figures end
 * with its cost of all time, read as its card reads it (the item's own work, by its reference) and
 * said as the card's line says a cost. A value that is no task has no such row, and a read that
 * failed says so in the row's place.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { serveUsage, task } from '../fixtures/analytics.ts'
import { richUsage, usageAnswer } from '../fixtures/usage.ts'
import { stubAnalyticsReads } from '../support/analyticsReads.ts'
import { detailOf, mountPage, panelOf, pressEachTest, WORLD } from '../support/valuePresses.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

pressEachTest()

const TASK = detailOf('work_item', task(1, '').id)

/**
 * The page's reads as `stubAnalyticsReads` answers them, and the card's read of an item's usage
 * answered with `item`, or refused; every query of that read is kept.
 */
function serveWith(item: ReturnType<typeof richUsage> | 'refused') {
  stubAnalyticsReads((query) => serveUsage(WORLD, query))
  const page = globalThis.fetch
  const asked: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input as string, 'http://127.0.0.1')
      if (url.pathname !== '/api/planning/work-item/usage') return page(input, init)
      asked.push(url.searchParams)
      return item === 'refused'
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify(usageAnswer(item)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
    }),
  )
  return asked
}

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** The heading of the panel's figures, as it reads. */
const heading = (host: VueWrapper) =>
  words(panelOf(host).get('[data-part="figures"]').findAll('h2, h3, h4, h5')[0]?.text() ?? '')

/** Each figure of the panel by its `data-figure`: its name and its words. */
const figures = (host: VueWrapper) =>
  Object.fromEntries(
    panelOf(host)
      .findAll('[data-figure]')
      .map((one) => [
        one.attributes('data-figure'),
        [words(one.get('dt').text()), words(one.get('dd').text())],
      ]),
  )

describe('the period a value’s figures are of', () => {
  it('names this week’s days, then the days of the period chosen instead', async () => {
    serveWith('refused')
    const host = await mountPage({ by: 'work_item', detail: TASK })
    // The week from Monday the 9th to Wednesday afternoon.
    expect(heading(host)).toBe('Figures · Nov 9 – 11')
    // The reader's own days, Monday and Tuesday: the same panel names them once they are read.
    await host.setProps({
      routeState: {
        by: 'work_item',
        detail: TASK,
        period: 'custom',
        from: '2026-11-09',
        to: '2026-11-10',
      },
    })
    await flushPromises()
    expect(heading(host)).toBe('Figures · Nov 9 – 10')
  })

  it('names the period in Russian as the page does', async () => {
    serveWith('refused')
    const host = await mountPage({ by: 'work_item', detail: TASK }, 'ru')
    expect(heading(host)).toBe('Показатели · 9–11 нояб.')
  })
})

describe('a task’s cost of all time', () => {
  it('reads the task as its card does and says its cost as the card’s line does', async () => {
    const asked = serveWith(richUsage({ reference: 'MAIN-1', estimated_api_cost_usd: 1234.5 }))
    const host = await mountPage({ by: 'work_item', detail: TASK })
    expect(asked.map((query) => Object.fromEntries(query))).toEqual([
      { id: 'MAIN-1', scope: 'item' },
    ])
    expect(figures(host)['all-time']).toEqual(['All time', '≈ $1,234.50'])
  })

  it('marks a cost that leaves models out, in Russian', async () => {
    serveWith(richUsage({ estimated_api_cost_usd: 9.5, unpriced_models: ['model-x'] }))
    const host = await mountPage({ by: 'work_item', detail: TASK }, 'ru')
    expect(figures(host)['all-time']).toEqual(['За всё время', '≈ 9,50 $+'])
  })

  it('says a read that failed in the row’s place', async () => {
    serveWith('refused')
    const host = await mountPage({ by: 'work_item', detail: TASK })
    expect(figures(host)['all-time']).toEqual(['All time', 'Could not be read'])
  })

  it('has no row, and asks nothing, for a value that is no task', async () => {
    const asked = serveWith(richUsage())
    const host = await mountPage({ by: 'model', detail: detailOf('model', 'model-01') })
    expect(Object.keys(figures(host))).toEqual(['time', 'tokens', 'cost', 'share'])
    expect(asked).toEqual([])
  })
})
