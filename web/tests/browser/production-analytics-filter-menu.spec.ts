/**
 * The Analytics filter's menu holds every value on one line, in the built app: the longest, an
 * organization's account that no reading places, «<id> · аккаунт не определён», would end in an
 * ellipsis where the menu is too narrow for it and say itself whole in its hint, as every row of
 * the shared menu does (`OptionGroups`). Before, that row wrapped to two lines at 1440 and 390px,
 * 52px tall beside rows of 40px, in a list laid out apart from the Work views'. The menu stands
 * inside the window at every width, as wide as it lets it up to 24rem.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { seatValue, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAt } from '../fixtures/quota.ts'
import { openDimension } from './analyticsFilter.ts'
import { NOW, pageAt, record, serveQuota } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { test } from './test.ts'

test.use({ locale: 'ru-RU' })

const on = (day: number) => new Date(2026, 10, day, 10)

/** Made-up organizations: one with an account, two whose work no reading places. */
const ORG_A = 'c0ffee00-1111-4222-8333-444455556666'
const ORG_B = 'deadbeef-2222-4333-8444-555566667777'
const ORG_C = 'feedface-3333-4444-8555-666677778888'
const WORLD: TimedStretch[] = [
  { seat: seatValue(`${ORG_A}/a1a1a1a1-2222-4333-8444-555566667777`), account: value(ORG_A) },
  { seat: seatValue(`${ORG_B}/`), account: value(ORG_B) },
  { seat: seatValue(`${ORG_C}/`), account: value(ORG_C) },
].flatMap((group, index) =>
  [0, 1, 2].map((day) => ({
    at: on(9 + day),
    group: { ...group, work_item: task(index + 1, `Rework the filter of the bar ${index + 1}`) },
    spend: { seconds: 3600 * (3 - index), tokens: 1000, cost: 1 },
  })),
)

async function serve(page: Page) {
  await page.clock.setSystemTime(NOW)
  await installBackend(page)
  await serveQuota(page, quotaAt(NOW))
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(serveUsage(WORLD, query)),
    })
  })
}

/** Each value row of the menu: its height, its words, how far they run past their box, its hint. */
const valueRows = (page: Page) =>
  page.locator('.analytics-filter-add [role="option"]:has(.option-check)').evaluateAll((rows) =>
    rows.map((row) => {
      const words = row.querySelector<HTMLElement>('.option-text')
      return {
        text: words?.textContent?.trim() ?? '',
        height: Math.round(row.getBoundingClientRect().height),
        cut: (words?.scrollWidth ?? 0) - (words?.clientWidth ?? 0),
        ends: words ? getComputedStyle(words).textOverflow : null,
        wraps: words ? getComputedStyle(words).whiteSpace !== 'nowrap' : null,
        kind: words?.dataset.tooltipKind ?? null,
        hint: words?.dataset.tooltip ?? null,
      }
    }),
  )

for (const width of [1440, 1024, 390])
  test(`the account filter's values stand on one line, cut ones said whole, at ${width}px`, async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(pageAt())
    await expect(page.locator('.analytics-bar-fresh')).toBeVisible()
    const menu = await openDimension(page, 'Аккаунт')
    const rows = await valueRows(page)
    const box = await menu.boundingBox()
    await record(info, `analytics filter menu ${width}`, { box, rows })

    // «Unknown» and the three accounts, two of them unplaced, the longest words the menu holds.
    expect(rows.map((row) => row.text)).toEqual([
      'Неизвестно',
      'a1a1a1a1',
      'deadbeef · аккаунт не определён',
      'feedface · аккаунт не определён',
    ])
    // One height for every row: none wraps to a second line.
    expect(new Set(rows.map((row) => row.height)).size, JSON.stringify(rows)).toBe(1)
    for (const row of rows) {
      // Every row keeps to one line, ends in an ellipsis where it is cut, and says its words
      // whole in its hint then.
      expect(row.wraps, row.text).toBe(false)
      expect(row.ends, row.text).toBe('ellipsis')
      expect(row.kind, row.text).toBe('clipped')
      expect(row.hint, row.text).toBe(row.text)
    }
    // The menu stands inside the window.
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(width)
  })
