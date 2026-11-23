/**
 * Done on the Volumes page leads to the Work list, at 1280px in English and at 390px in English
 * and in Russian. The oracle is DESIGN.md («Volumes»): Done counts what came to a close in the
 * page's period, so it opens the Work list of the same scope, ungrouped, with the category and the
 * filter's condition «Closed in a period» for the page's period, whose chip names the period. The
 * page stands at today, on 25 October at noon; of the space's finished cards only MAIN-422 came
 * to a close that day (`closedSpace`), and the page's read counts it alone.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { volumesAnswer } from '../support/volumesDouble.ts'
import { installBackend } from './backend.ts'
import { chips, closedSpace, serveSpace } from './filterPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const CASES = [
  { width: 1280, height: 800, locale: 'en', done: 'Done', today: 'Closed today' },
  { width: 390, height: 844, locale: 'en', done: 'Done', today: 'Closed today' },
  { width: 390, height: 844, locale: 'ru', done: 'Выполнено', today: 'Закрыто сегодня' },
] as const

/** The cards the list draws, by the reference each row's opener carries, in the order they stand. */
const listRows = (page: Page) =>
  page
    .locator('.work-item-list tbody [data-reference]')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.reference ?? ''))

for (const { width, height, locale, done, today } of CASES) {
  test(`at ${width}px in ${locale} Done opens the Work list of the cards closed in the period`, async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(new Date(2026, 9, 25, 12))
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await page.setViewportSize({ width, height })
    await installBackend(page)
    await serveSpace(page, closedSpace())
    await page.route('**/api/planning/volumes?*', (route) =>
      route.fulfill({ json: volumesAnswer({ categories: { completed: 1, active: 2 } }) }),
    )
    await page.goto(
      serializePlatformRoute({
        module_id: 'volumes',
        scope: spaceScope,
        state: { period: 'today' },
      }),
    )
    const number = page.locator('[data-number="completed"]')
    await expect(number.locator('[data-part="label"]')).toHaveText(done)
    const counted = Number(await number.locator('[data-part="figure"]').textContent())
    await page.screenshot({ path: testInfo.outputPath(`volumes-done-${width}-${locale}.png`) })
    await number.click()

    await expect.poll(() => parsePlatformRoute(new URL(page.url())).module_id).toBe('planning')
    const opened = parsePlatformRoute(new URL(page.url()))
    expect(opened.scope).toEqual(spaceScope)
    expect(opened.state).toEqual({ cat: 'completed', period: 'today', view: 'list' })
    // The list's cards are the one the number counts, and no other.
    await expect.poll(() => listRows(page)).toEqual(['MAIN-422'])
    expect(await listRows(page)).toHaveLength(counted)
    // The condition's chip names the period, before the state's.
    await expect(chips(page)).toHaveCount(2)
    await expect(chips(page).first()).toHaveText(today)
    await expectNoSilentClipping(page, `Done's list at ${width}px in ${locale}`)
    await page.screenshot({ path: testInfo.outputPath(`done-list-${width}-${locale}.png`) })
  })
}
