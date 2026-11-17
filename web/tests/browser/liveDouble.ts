/**
 * The browser double of the live period «Now»: a clock that stands still five seconds into a
 * minute, usage answered from work a test may change, the quota of four made-up accounts, the
 * page's visibility as the test sets it, and the usage reads the page asked, kept in the page as
 * it asks them.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serveUsage } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAt } from '../fixtures/quota.ts'
import { serveQuota } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { NOW } from './liveClock.ts'
export { at, NOW } from './liveClock.ts'

/** The browser double: the work it holds, which a test may change, and every query it was asked. */
export interface Double {
  asked: URLSearchParams[]
  world: readonly TimedStretch[]
  /** The newest record the answers name; each period's end when unset. */
  lastEventAt?: Date
}

/** Answers every usage read from the double's work as it stands when the read is asked. */
export async function serveLive(page: Page, world: readonly TimedStretch[]): Promise<Double> {
  const double: Double = { asked: [], world }
  await page.clock.setSystemTime(NOW)
  await installBackend(page)
  await serveQuota(page, quotaAt(NOW))
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    double.asked.push(query)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(serveUsage(double.world, query, double.lastEventAt)),
    })
  })
  return double
}

/**
 * Makes the document's visibility the test's to set, a switch of tabs as the page hears of it, and
 * keeps every usage read the page asks, in the page, at the moment it asks it. Playwright keeps its
 * page visible, so the state and its event are stood in for. A read the clock's timers ask is
 * asked inside them, so the count after a move of the paused clock is exact without a wait.
 */
export async function watchPage(page: Page) {
  await page.addInitScript(() => {
    let state: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => state === 'hidden',
    })
    const reads: string[] = []
    const fetchFirst = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/api/analytics/usage')) reads.push(url)
      return fetchFirst(input, init)
    }
    Object.assign(globalThis, {
      usageReads: reads,
      showPage: (next: DocumentVisibilityState) => {
        state = next
        document.dispatchEvent(new Event('visibilitychange'))
      },
    })
  })
  return {
    show: (state: DocumentVisibilityState) =>
      page.evaluate((next) => {
        ;(globalThis as unknown as { showPage: (to: string) => void }).showPage(next)
      }, state),
    reads: async () => {
      const urls = await page.evaluate(() =>
        (globalThis as unknown as { usageReads: string[] }).usageReads.slice(),
      )
      return urls.map((url) => new URL(url, 'http://127.0.0.1').searchParams)
    },
    count: () =>
      page.evaluate(() => (globalThis as unknown as { usageReads: string[] }).usageReads.length),
  }
}

/**
 * Waits until every read the page asked was answered and the answers asked nothing more: the
 * page's count and the double's agree, twice in a row.
 */
export async function settled(count: () => Promise<number>, double: Double) {
  let last = -1
  await expect
    .poll(
      async () => {
        const asked = await count()
        const still = asked === last && asked === double.asked.length
        last = asked
        return still
      },
      { intervals: [250] },
    )
    .toBe(true)
}
