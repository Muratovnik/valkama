/**
 * What the Analytics page shows while its read is under way or after it failed, against a stand-in
 * for the read. The oracle is the requirement: a read again of the view on show that fails leaves
 * its figures — or its empty period — as they stood, and the bar says beside their age that the
 * read failed, with the way to ask once more, until an answer replaces them; a new view whose read
 * fails says it failed, since the last view's figures are not its own; while a new view is read the
 * last answer stays drawn, dimmed once the wait is long enough to be seen, and a read again of the
 * same view dims nothing. The rail's tiles are held in `analyticsRail.spec.ts`.
 */
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOADING_DELAY_MS } from '@/shared/ui/loadingPresence.ts'

import { serveUsage, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

vi.mock('@/pages/analytics/composables/useRailReads.ts', () => import('../support/quietRail.ts'))

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3600
const ITEM = task(12, 'Answer a review in one form')

/** Three hours this Monday, and three more three weeks back, which the past four weeks hold. */
const WORLD: TimedStretch[] = [
  { at: new Date(2026, 10, 9, 10), group: { work_item: ITEM }, spend: { seconds: 3 * HOUR } },
  { at: new Date(2026, 9, 20, 10), group: { work_item: ITEM }, spend: { seconds: 3 * HOUR } },
]
/** The same, with an hour more this Tuesday. */
const MORE: TimedStretch[] = [
  ...WORLD,
  { at: new Date(2026, 10, 10, 10), group: { work_item: ITEM }, spend: { seconds: HOUR } },
]

const time = (page: VueWrapper) =>
  page.get('.tile-figure[data-measure="time"]').text().replaceAll(/\s/gu, ' ')
const mark = (page: VueWrapper) => page.find('.refresh-failed')

/** A stand-in that answers from `world` until `failing` is set, then refuses every read. */
function readsThatFail() {
  const control = { failing: false, world: WORLD }
  const reads = stubAnalyticsReads((query) =>
    control.failing ? { status: 500 } : serveUsage(control.world, query),
  )
  return { control, reads }
}

async function refresh(page: VueWrapper) {
  await page.get('.analytics-refresh').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('a read again that fails', () => {
  it('keeps the figures on show, says so beside their age, and goes when a retry lands', async () => {
    const { control, reads } = readsThatFail()
    const page = await mountAnalytics()
    expect(time(page)).toBe('3 h')
    expect(mark(page).exists()).toBe(false)

    control.failing = true
    await refresh(page)
    // The answer stays whole, no failure panel in its place, and the bar says the read failed.
    expect(time(page)).toBe('3 h')
    expect(page.find('.platform-state-panel').exists()).toBe(false)
    expect(page.find('.overview-panel').exists()).toBe(true)
    expect(mark(page).text()).toBe('Could not refresh · Retry')
    expect(mark(page).attributes('role')).toBe('status')

    // Asked again and failed again: the same figures and one mark.
    await refresh(page)
    expect(time(page)).toBe('3 h')
    expect(page.findAll('.refresh-failed')).toHaveLength(1)

    // The mark's own retry reads the page again; its answer replaces the figures and the mark.
    control.failing = false
    control.world = MORE
    const asked = reads.grouped('work_item').length
    await mark(page).get('button').trigger('click')
    await flushPromises()
    expect(reads.grouped('work_item').length).toBeGreaterThan(asked)
    expect(time(page)).toBe('4 h')
    expect(mark(page).exists()).toBe(false)
  })

  it('says so in Russian', async () => {
    const { control } = readsThatFail()
    const page = await mountAnalytics({}, 'ru')
    control.failing = true
    await refresh(page)
    expect(time(page)).toBe('3 ч')
    expect(mark(page).text()).toBe('Не удалось обновить · Повторить')
  })

  it('keeps an empty period on show', async () => {
    const { control } = readsThatFail()
    const page = await mountAnalytics({ projectId: 'empty' })
    expect(page.text()).toContain('Nothing was spent in this period')
    control.failing = true
    await refresh(page)
    expect(page.text()).toContain('Nothing was spent in this period')
    expect(page.find('[role="alert"]').exists()).toBe(false)
    expect(mark(page).exists()).toBe(true)
  })
})

describe('a new view', () => {
  it('whose read fails says it failed: the last view’s figures are not its own', async () => {
    const { control } = readsThatFail()
    const page = await mountAnalytics()
    expect(time(page)).toBe('3 h')
    control.failing = true
    await page.setProps({ routeState: { period: 'weeks4' } })
    await flushPromises()
    expect(page.get('[role="alert"]').text()).toContain('could not be loaded')
    expect(mark(page).exists()).toBe(false)
  })

  it('dims the last answer while it is read; a read again of the same view dims nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    let holding = false
    const reads = stubAnalyticsReads((query) => (holding ? 'hold' : serveUsage(WORLD, query)))
    const page = await mountAnalytics()
    const dimmed = () => page.get('.overview-panel').classes('read-pending')
    const wait = async (ms: number) => {
      vi.advanceTimersByTime(ms)
      await flushPromises()
    }
    const releaseAll = async () => {
      for (const held of reads.held.splice(0)) held.release(serveUsage(WORLD, held.query))
      await flushPromises()
    }
    expect(dimmed()).toBe(false)

    // The same view read again, for longer than a wait takes to be shown: nothing dims.
    holding = true
    await refresh(page)
    await wait(1000)
    expect(dimmed()).toBe(false)
    await releaseAll()

    // A new period: the last answer stays, dimmed once the wait is long enough to be seen, and
    // drawn plainly again once the new one is in.
    await page.setProps({ routeState: { period: 'weeks4' } })
    await flushPromises()
    expect(time(page)).toBe('3 h')
    expect(dimmed()).toBe(false)
    await wait(LOADING_DELAY_MS)
    expect(dimmed()).toBe(true)
    expect(time(page)).toBe('3 h')
    holding = false
    await releaseAll()
    await wait(400)
    expect(time(page)).toBe('6 h')
    expect(dimmed()).toBe(false)
  })
})
