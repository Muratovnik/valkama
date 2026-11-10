import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { serverStore } from './serverStore.ts'
import { test } from './test.ts'

/**
 * Opening the Analytics page counts one opening, through the real server rather than
 * mocked routes, and the count is read back through `GET /api/analytics/uses`
 * (connection contract, "How often each analytics surface is opened").
 *
 * Runs only with VALKAMA_BROWSER_STORE naming a store for the server. Several runs may
 * share one store, so the test compares the count with the one it read before.
 */

// The configuration runs this file only with a store named, and nothing else may.
if (!serverStore())
  throw new Error('VALKAMA_BROWSER_STORE names no store: this runs on the real server')

const DAY_MS = 24 * 60 * 60 * 1000

/** A date as the counts name days. */
function date(moment: Date) {
  return moment.toISOString().slice(0, 10)
}

/**
 * The openings of the page counted from yesterday to tomorrow in UTC: wide enough to
 * hold the day the page counts on at any offset from UTC.
 */
async function pageOpenings(request: APIRequestContext) {
  const now = Date.now()
  const query = new URLSearchParams({
    from: date(new Date(now - DAY_MS)),
    to: date(new Date(now + 2 * DAY_MS)),
  })
  const response = await request.get(`/api/analytics/uses?${query}`)
  expect(response.status()).toBe(200)
  const answer = (await response.json()) as { uses: { total: { page_open: number } } }
  return answer.uses.total.page_open
}

test('opening the Analytics page counts one opening, read back from the counts', async ({
  page,
  request,
}) => {
  const before = await pageOpenings(request)

  await page.goto('/modules/analytics/global')
  await expect(page.locator('.analytics-page')).toBeVisible()
  await expect.poll(() => pageOpenings(request), { timeout: 10_000 }).toBe(before + 1)
})
