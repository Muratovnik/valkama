/**
 * The line «time to triage» in «Needs my answer», at the widths its window changes at and at a
 * phone's in both languages: one per space the read says is due, over the questions of «All»,
 * each whole inside the window, with how many of the stack's cards wait unmarked and how
 * long the oldest has waited.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { requestList } from '../support/inputRequests.ts'
import { spaceRef } from './planningFixtures.ts'
import { ofPurpose, openKinds } from './questionKindsPage.ts'
import { test } from './test.ts'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const NBSP = '\u{A0}'
const DUE = [
  { space: { key: 'MAIN', name: 'Main' }, count: 120, oldest_at: '2026-11-16T08:00:00Z' },
  { space: { key: 'ALPHA', name: 'Alpha' }, count: 1, oldest_at: '2026-11-19T09:55:00Z' },
]
const WORDS = {
  en: [
    `Time to triage · Main: 120 awaiting triage, the oldest for 3${NBSP}d${NBSP}4${NBSP}h`,
    `Time to triage · Alpha: 1 awaiting triage, the oldest for 2${NBSP}h${NBSP}5${NBSP}min`,
  ],
  ru: [
    `Пора разобрать · Main: ждут разбора 120, старшая${NBSP}— 3${NBSP}дн.${NBSP}4${NBSP}ч`,
    `Пора разобрать · Alpha: ждут разбора 1, старшая${NBSP}— 2${NBSP}ч${NBSP}5${NBSP}мин`,
  ],
} as const
const CASES = [
  { width: 1280, locale: 'en' },
  { width: 620, locale: 'en' },
  { width: 390, locale: 'en' },
  { width: 390, locale: 'ru' },
] as const

/** Where an element stands on the screen; it must be there. */
async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('Not on screen')
  return found
}

for (const { width, locale } of CASES) {
  test(`at ${width}px in ${locale} a due space's line stands over the questions, whole in the window`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    const entries = [ofPurpose(null), ofPurpose('triage')]
    const { dialog } = await openKinds(page, entries, width, async () => {
      await page.clock.setSystemTime(NOW)
      // The read of everything waiting carries the lines; every other read is the backend's.
      await page.route('**/api/modules/planning/requests?**', (route) => {
        const url = new URL(route.request().url())
        if (url.searchParams.get('scope_kind') !== 'global' || url.searchParams.get('offset'))
          return route.fallback()
        return route.fulfill({
          json: {
            ...requestList(entries),
            coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
            triage_due: DUE,
          },
        })
      })
    })
    const lines = dialog.locator('[data-triage-due]')
    await expect(lines).toHaveText([...WORDS[locale]])
    const records = dialog.locator('[data-request-waiting]')
    await expect(records).toHaveCount(2)

    // Each line is whole inside the window, and both stand over the first question.
    const column = await box(dialog)
    const first = await box(records.first())
    for (const line of await lines.all()) {
      const { x, y, width: wide, height } = await box(line)
      expect(x).toBeGreaterThanOrEqual(column.x - 0.5)
      expect(x + wide).toBeLessThanOrEqual(column.x + column.width + 0.5)
      expect(y + height).toBeLessThanOrEqual(first.y)
      expect(await line.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      )
    }
    await dialog.screenshot({ path: testInfo.outputPath(`triage-due-${width}-${locale}.png`) })
  })
}
