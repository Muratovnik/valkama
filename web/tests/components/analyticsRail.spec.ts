/**
 * The tiles of the Analytics page's rail, against a stand-in for the usage read. The oracle is
 * the requirement: the overview's tile says the period's total in the chosen measure, how it
 * moved from the period before and its days; a dimension's tile its count of values, its first
 * real value with that value's share and the shares of its first few. A dimension is one read of
 * its own; a change of period or filter reads every one again, a change of measure or section
 * none. A tile whose read holds nothing says there is no data, never a zero, and one whose read
 * failed says so while the others show their figures. The figures below are worked out by hand
 * from the stretches.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { noTask, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { saidBy } from '../support/liveRegion.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3600

/**
 * This week: three hours on one task and one on another, under one model; the Monday of the week
 * before: two hours, so the week rose by half as much again.
 */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 9, 10),
    group: { work_item: task(1, 'One'), model: value('model-a') },
    spend: { seconds: 3 * HOUR, tokens: 3000, cost: 3 },
  },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two'), model: value('model-a') },
    spend: { seconds: HOUR, tokens: 1000, cost: 1 },
  },
  {
    at: new Date(2026, 10, 2, 10),
    group: { work_item: task(1, 'One'), model: value('model-a') },
    spend: { seconds: 2 * HOUR, tokens: 8000, cost: 2 },
  },
]

const tile = (page: VueWrapper, section: string) => page.get(`[data-section="${section}"]`)
const lead = (page: VueWrapper, section: string) =>
  tile(page, section).get('.rail-tile-lead').text()
const aside = (page: VueWrapper, section: string) =>
  tile(page, section).find('.rail-tile-aside').text()
const count = (page: VueWrapper, section: string) =>
  tile(page, section).find('.analytics-rail-count')

/** The reads the rail asks: one by each dimension, none comparing, none of the week before. */
/** The element an id reference names, or null. */
const byId = (id = '') => document.querySelector(`[id="${id}"]`)

const railReads = (asked: readonly URLSearchParams[]) =>
  asked.filter((query) => !query.get('compare') && !query.get('from')?.includes('T'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the tiles', () => {
  it('say the overview’s total, its change and its days', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    expect(lead(page, 'overview')).toBe('4\u{A0}h')
    expect(aside(page, 'overview')).toBe('↑ 100%')
    const trend = tile(page, 'overview').get('.mini-trend')
    expect(trend.attributes('role')).toBe('img')
    // The days are named as the days chart names them; the figures are what this test holds.
    const said = trend.attributes('aria-label') ?? ''
    expect(said).toMatch(/^Agent time per day from .+ to .+: highest 3\u{A0}h \(.+\), last /u)
    // Wednesday, still running, has nothing yet: a zero in the measure's unit, so far.
    expect(said).toMatch(/last 0\u{A0}min so far$/u)
    expect(trend.findAll('.mini-trend-period')).toHaveLength(3)
  })

  it('say a dimension’s count of values, its first value with its share and its first shares', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    expect(count(page, 'work_item').text()).toBe('2 values')
    expect(lead(page, 'work_item')).toBe('MAIN-1 One')
    expect(aside(page, 'work_item')).toBe('75%')
    expect(tile(page, 'work_item').get('.mini-share-bar').attributes('aria-label')).toBe(
      'Shares of Agent time: MAIN-1 One 75%, MAIN-2 Two 25%',
    )
    expect(count(page, 'model').text()).toBe('1 value')
    expect(lead(page, 'model')).toBe('model-a')
    expect(aside(page, 'model')).toBe('100%')
  })

  it('go by the section’s name alone, and are described by their figures', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    const entry = tile(page, 'model')
    const name = byId(entry.attributes('aria-labelledby'))
    const figures = byId(entry.attributes('aria-describedby'))
    expect(name?.textContent).toBe('Model')
    expect(figures?.textContent).toContain('model-a')
  })

  it('say the figures of the measure the page shows, asking nothing for it', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    const asked = reads.asked.length
    await page.setProps({ routeState: { measure: 'tokens' } })
    await flushPromises()
    expect(reads.asked).toHaveLength(asked)
    // Four thousand tokens against eight thousand: half as many.
    expect(lead(page, 'overview')).toBe('4K')
    expect(aside(page, 'overview')).toBe('↓ 50%')
    expect(aside(page, 'work_item')).toBe('75%')
  })
})

describe('the reads', () => {
  it('ask one read a dimension, and again for a new period or filter, never for a section', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    const byDimension = Object.fromEntries(
      USAGE_DIMENSIONS.map((dimension) => [
        dimension,
        railReads(reads.asked).filter((query) => query.get('group_by') === dimension).length,
      ]),
    )
    // The page's own read of the week by task, and its read by account, ask what two tiles do,
    // and each is asked once for both.
    expect(byDimension).toEqual(Object.fromEntries(USAGE_DIMENSIONS.map((one) => [one, 1])))

    // Another section: the page reads it, by model, beside the week before; its read of the week
    // by model is the rail's tile of models, and its read by account the one the view has.
    const opened = reads.asked.length
    await page.setProps({ routeState: { by: 'model' } })
    await flushPromises()
    const groups = (from: number) =>
      reads.asked.slice(from).map((query) => query.get('group_by') ?? '')
    expect(groups(opened)).toEqual(['model'])

    const before = reads.asked.length
    await page.setProps({ routeState: { by: 'model', period: 'weeks4' } })
    await flushPromises()
    // A new period: a read a dimension, the page's own by account among them.
    const fresh = reads.asked.slice(before).filter((query) => !query.get('compare'))
    expect(fresh.map((query) => query.get('group_by') ?? '').toSorted()).toEqual(
      [...USAGE_DIMENSIONS].toSorted(),
    )

    const filtered = reads.asked.length
    const filters = JSON.stringify({ model: ['model-a'] })
    await page.setProps({ routeState: { by: 'model', period: 'weeks4', filters } })
    await flushPromises()
    const narrowed = reads.asked.slice(filtered).filter((query) => !query.get('compare'))
    expect(narrowed.filter((query) => query.get('model') === 'model-a')).toHaveLength(
      USAGE_DIMENSIONS.length,
    )
  })

  it('say there is no data, never a zero, when a period spent nothing', async () => {
    stubAnalyticsReads((query) => serveUsage([], query))
    const page = await mountAnalytics()
    for (const section of ['overview', ...USAGE_DIMENSIONS]) {
      expect(lead(page, section), section).toBe('No data')
      expect(tile(page, section).text(), section).not.toMatch(/\b0\b/u)
    }
    expect(count(page, 'model').exists()).toBe(false)
  })

  it('say a read failed in its own tile, and the others still show their figures', async () => {
    stubAnalyticsReads((query) =>
      query.get('group_by') === 'model' ? { status: 500 } : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    expect(lead(page, 'model')).toBe('Could not be read')
    expect(tile(page, 'model').get('.rail-tile').attributes('data-state')).toBe('failed')
    expect(lead(page, 'work_item')).toBe('MAIN-1 One')
    expect(lead(page, 'overview')).toBe('4\u{A0}h')
  })

  it('show their wait once it has lasted, hold it for the minimum, and keep the figures on show while they are read again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    let holding = true
    const reads = stubAnalyticsReads((query) => (holding ? 'hold' : serveUsage(WORLD, query)))
    const page = await mountAnalytics()
    const said = saidBy(page.get('.analytics-read-wait').element)
    // Nothing is said or shown before the delay; the tile keeps its place until then.
    expect(said).toEqual([''])
    expect(lead(page, 'model')).toBe('')
    expect(tile(page, 'model').get('.rail-tile').attributes('aria-busy')).toBe('true')
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    await page.vm.$nextTick()
    expect(lead(page, 'model')).toBe('Loading')
    expect(said).toEqual(['', 'Loading'])

    for (const held of reads.held) held.release(serveUsage(WORLD, held.query))
    await flushPromises()
    // The figures wait for the minimum the wait was shown for, then take its place.
    expect(lead(page, 'model')).toBe('Loading')
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await page.vm.$nextTick()
    expect(lead(page, 'model')).toBe('Loading')
    vi.advanceTimersByTime(1)
    await page.vm.$nextTick()
    expect(lead(page, 'model')).toBe('model-a')
    expect(tile(page, 'model').get('.rail-tile').attributes('aria-busy')).toBeUndefined()
    expect(said).toEqual(['', 'Loading', ''])

    holding = true
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    // The figures on show stay while they are read again, said busy.
    expect(lead(page, 'model')).toBe('model-a')
    expect(tile(page, 'model').get('.rail-tile').attributes('aria-busy')).toBe('true')
    holding = false
  })

  it('show and say nothing for a read that answers inside the delay', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    const reads = stubAnalyticsReads((query) =>
      query.get('group_by') === 'model' ? 'hold' : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    const said = saidBy(page.get('.analytics-read-wait').element)
    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await page.vm.$nextTick()
    expect(lead(page, 'model')).toBe('')
    for (const held of reads.held) held.release(serveUsage(WORLD, held.query))
    await flushPromises()
    // Nothing was shown, so nothing is held: the figures are there at once.
    expect(lead(page, 'model')).toBe('model-a')
    expect(said).toEqual([''])
  })

  it('say a cold entry once for all its waits, and clear after the last one has held its minimum', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    let holding = true
    const reads = stubAnalyticsReads((query) => (holding ? 'hold' : serveUsage(WORLD, query)))
    const page = await mountAnalytics()
    const said = saidBy(page.get('.analytics-read-wait').element)
    // Several reads, a tile each and the overview's cards, wait together on a cold entry.
    expect(reads.held.length).toBeGreaterThan(1)
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    await page.vm.$nextTick()
    expect(said).toEqual(['', 'Loading'])

    holding = false
    for (const held of reads.held) held.release(serveUsage(WORLD, held.query))
    await flushPromises()
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await page.vm.$nextTick()
    expect(said).toEqual(['', 'Loading'])
    vi.advanceTimersByTime(1)
    await page.vm.$nextTick()
    expect(said).toEqual(['', 'Loading', ''])
  })

  it('keep their figures when a read of them again fails, and the bar says the read failed', async () => {
    /** Which reads fail: none, every one, or those by one dimension. */
    let failing: 'all' | 'none' | 'model' = 'none'
    stubAnalyticsReads((query) =>
      failing === 'all' || query.get('group_by') === failing
        ? { status: 500 }
        : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    expect(lead(page, 'model')).toBe('model-a')

    // Every read fails: no tile with figures says it could not be read, the overview's neither.
    failing = 'all'
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    for (const section of ['overview', ...USAGE_DIMENSIONS]) {
      expect(lead(page, section), section).not.toBe('Could not be read')
      expect(tile(page, section).get('.rail-tile').attributes('data-state'), section).toBe('ready')
      expect(tile(page, section).get('.rail-tile').attributes('aria-busy'), section).toBeUndefined()
    }
    expect(lead(page, 'model')).toBe('model-a')
    expect(lead(page, 'overview')).toBe('4\u{A0}h')
    expect(page.find('.refresh-failed').exists()).toBe(true)

    // Only one tile's read fails, the page's own answers: the bar still says a read failed, and
    // the next round that lands whole takes the words away.
    failing = 'model'
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(lead(page, 'model')).toBe('model-a')
    expect(page.find('.refresh-failed').exists()).toBe(true)
    failing = 'none'
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(page.find('.refresh-failed').exists()).toBe(false)
  })

  it('say a new period whose read failed failed, never the last period’s figures', async () => {
    let failing = false
    stubAnalyticsReads((query) =>
      failing && query.get('group_by') === 'model' ? { status: 500 } : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    expect(lead(page, 'model')).toBe('model-a')
    failing = true
    await page.setProps({ routeState: { period: 'weeks4' } })
    await flushPromises()
    expect(lead(page, 'model')).toBe('Could not be read')
    expect(page.find('.refresh-failed').exists()).toBe(false)
  })

  it('are dimmed while a new period is read, each until its own answer lands, and not on a refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    let holding = false
    const reads = stubAnalyticsReads((query) => (holding ? 'hold' : serveUsage(WORLD, query)))
    const page = await mountAnalytics()
    const dimmed = (section: string) =>
      tile(page, section).get('.rail-tile').classes('read-pending')
    const wait = async (ms: number) => {
      vi.advanceTimersByTime(ms)
      await flushPromises()
    }
    const release = async (which: (query: URLSearchParams) => boolean) => {
      for (const held of reads.held.filter(({ query }) => which(query)))
        held.release(serveUsage(WORLD, held.query))
      reads.held.splice(0, reads.held.length, ...reads.held.filter(({ query }) => !which(query)))
      await flushPromises()
    }

    // The same period read again, for longer than a wait takes to be shown: nothing dims.
    holding = true
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    await wait(1000)
    for (const section of ['overview', 'model']) expect(dimmed(section), section).toBe(false)
    await release(() => true)

    // A new period: every tile with figures is dimmed once the wait is long enough to be seen.
    await page.setProps({ routeState: { period: 'weeks4' } })
    await flushPromises()
    await wait(LOADING_DELAY_MS)
    for (const section of ['overview', ...USAGE_DIMENSIONS])
      expect(dimmed(section), section).toBe(true)
    // The page's own answer lands first, the overview's tile with it; a dimension's tile still
    // shows the last period's figures and stays dimmed until its own answer lands.
    const pageOwn = new Set(['work_item', 'account'])
    await release((query) => pageOwn.has(query.get('group_by') ?? ''))
    await wait(400)
    expect(page.get('.overview-panel').classes('read-pending')).toBe(false)
    expect(dimmed('overview')).toBe(false)
    expect(dimmed('model')).toBe(true)
    expect(dimmed('role')).toBe(true)
    await release((query) => query.get('group_by') === 'model')
    await wait(400)
    expect(dimmed('model')).toBe(false)
    expect(dimmed('role')).toBe(true)
    holding = false
    await release(() => true)
    await wait(400)
    for (const section of ['overview', ...USAGE_DIMENSIONS])
      expect(dimmed(section), section).toBe(false)
  })
})

/** The hue of every mark the page draws for a value: tile part, bar, small chart, legend key. */
const huesOf = (page: VueWrapper, key: string) =>
  page
    .findAll(
      `.series-fill[data-key="${key}"], [data-key="${key}"] .series-fill, [data-series="${key}"] .series-fill`,
    )
    .map((mark) => mark.attributes('data-slot'))

describe('a value', () => {
  /**
   * Four tasks whose ranking (3, 1, 2, 4) is not the order of their ids, and more work on no task
   * than on any of them: a colour taken from a position in whatever set a chart is handed gives
   * the tile's and the panel's charts different hues for one task.
   */
  const RANKED: TimedStretch[] = [
    [3, 5],
    [1, 3],
    [2, 2],
    [4, 1],
  ].map(([number = 0, hours = 0]) => ({
    at: new Date(2026, 10, 9, 10),
    group: { work_item: task(number, `Task ${number}`) },
    spend: { seconds: hours * HOUR },
  }))
  RANKED.push({
    at: new Date(2026, 10, 10, 10),
    group: { work_item: noTask },
    spend: { seconds: 6 * HOUR },
  })

  it('has one hue on the whole page, its place in the ranking by the measure', async () => {
    stubAnalyticsReads((query) => serveUsage(RANKED, query))
    const page = await mountAnalytics({ routeState: { by: 'work_item' } })
    for (const [rank, number] of [3, 1, 2, 4].entries()) {
      const hues = huesOf(page, `v:${task(number, '').id}`)
      // The tile's part, the section's bar and the day chart's key at least.
      expect(hues.length, `task ${number}`).toBeGreaterThanOrEqual(3)
      expect(new Set(hues), `task ${number}`).toEqual(new Set([String(rank + 1)]))
    }
    // Work on no task is the neutral of what is not a value wherever it is drawn, never a hue
    // and never the lighter neutral of the folded rest.
    expect(new Set(huesOf(page, 'none'))).toEqual(new Set(['apart']))
  })

  it('is named in its tile when it is work on no task holding a twentieth or more', async () => {
    stubAnalyticsReads((query) => serveUsage(RANKED, query))
    const page = await mountAnalytics()
    // Eleven hours on tasks, six on no task: 6 / 17 of the whole.
    const bar = tile(page, 'work_item').get('.mini-share-bar')
    expect(bar.attributes('aria-label')).toBe(
      'Shares of Agent time: MAIN-3 Task 3 29%, MAIN-1 Task 1 18%, MAIN-2 Task 2 12%, MAIN-4 Task 4 6%, No task 35%',
    )
    const none = bar.get('[data-key="none"]')
    expect(none.classes()).toContain('mini-share-apart')
    expect(none.attributes('data-slot')).toBe('apart')
    // The lead stays the first real value.
    expect(lead(page, 'work_item')).toBe('MAIN-3 Task 3')
  })
})

describe('a share', () => {
  it('is said in whole percents, never as all or none of what it is not', async () => {
    // A second on a task beside 999 on no task: a thousandth, and the rest a hair under all.
    stubAnalyticsReads((query) =>
      serveUsage(
        [
          {
            at: new Date(2026, 10, 9, 10),
            group: { work_item: task(1, 'One') },
            spend: { seconds: 1 },
          },
          { at: new Date(2026, 10, 9, 11), group: { work_item: noTask }, spend: { seconds: 999 } },
        ],
        query,
      ),
    )
    const page = await mountAnalytics()
    expect(lead(page, 'work_item')).toBe('MAIN-1 One')
    expect(aside(page, 'work_item')).toBe('<1%')
    expect(tile(page, 'work_item').get('.mini-share-bar').attributes('aria-label')).toBe(
      'Shares of Agent time: No task >99%',
    )
  })
})

describe('a tile of «Now»', () => {
  it('says no count beside work with no value when no value worked', async () => {
    // Ten minutes of the live hour, on no task and launched by the session itself.
    stubAnalyticsReads((query) =>
      serveUsage(
        [
          {
            at: new Date(2026, 10, 11, 14, 10),
            group: { work_item: noTask, launch_class: noTask },
            spend: { seconds: 600 },
          },
        ],
        query,
      ),
    )
    const page = await mountAnalytics({ routeState: { period: 'now' } })
    expect(lead(page, 'launch_class')).toBe('The session itself')
    expect(count(page, 'launch_class').exists()).toBe(false)
    expect(lead(page, 'work_item')).toBe('No task')
    expect(count(page, 'work_item').exists()).toBe(false)
    // Work nobody can place is no work with no value: its tile keeps its count of none.
    expect(lead(page, 'model')).toBe('Unknown')
    expect(count(page, 'model').text()).toBe('0 values')
  })
})
