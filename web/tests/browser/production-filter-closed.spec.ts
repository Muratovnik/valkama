/**
 * The filter's condition «Closed in a period», at a desktop's width and at a phone's in both
 * languages. An address with the condition and the state's category, as the Volumes page's Done
 * opens the board, shows the cards that came to be completed within the period's days and no
 * other, the first and the last day taken in whole; its chip says the condition, and the days of
 * the reader's own stand in two fields beside it, inside the window, where a day set anew narrows
 * the board at once. From the menu, the condition's row steps into its periods.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { addressState, boxOf, chips, closedSpace, openSpace, shownTiles } from './filterPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const DAYS = { cat: 'completed', period: 'custom', from: '2026-10-21', to: '2026-10-25' }
const WORDS = {
  en: {
    own: 'Closed on my days',
    today: 'Closed today',
    from: 'Closed from',
    row: 'Closed in a period',
    field: 'Filter work',
    menu: 'Facets to filter by',
    period: 'Today',
  },
  ru: {
    own: 'Закрыто за свои дни',
    today: 'Закрыто сегодня',
    from: 'Закрыто с',
    row: 'Закрыто за период',
    field: 'Фильтр работы',
    menu: 'Признаки для фильтра',
    period: 'Сегодня',
  },
} as const
const CASES = [
  { width: 1280, locale: 'en' },
  { width: 390, locale: 'en' },
  { width: 390, locale: 'ru' },
] as const

async function open(page: Page, width: number, locale: string, state: Record<string, string>) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await openSpace(page, { width, items: closedSpace(), state })
}

for (const { width, locale } of CASES) {
  test(`at ${width}px in ${locale} an address closed in a period shows only the cards closed in it`, async ({
    page,
  }, testInfo) => {
    await open(page, width, locale, DAYS)
    // Done within the days, the first and the last taken in whole, and nothing that is not done.
    await expect.poll(() => shownTiles(page)).toEqual(['MAIN-406', 'MAIN-422'])
    // The condition's chip first, as the conditions stand before the facets, then the state's.
    await expect(chips(page)).toHaveCount(2)
    await expect(chips(page).first()).toHaveText(WORDS[locale].own)
    // The days of the reader's own beside the chips, whole inside the window.
    const days = page.locator('.workspace-chips input[type="date"]')
    await expect(days).toHaveCount(2)
    await expect(days.first()).toHaveValue('2026-10-21')
    await expect(days.last()).toHaveValue('2026-10-25')
    for (const day of await days.all()) {
      const { x, width: wide } = await boxOf(day)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x + wide).toBeLessThanOrEqual(width)
    }
    await expectNoSilentClipping(page, `«Closed in a period» at ${width}px in ${locale}`)
    await page.locator('.workspace-head').screenshot({
      path: testInfo.outputPath(`closed-days-${width}-${locale}.png`),
    })

    // A first day set anew narrows the board at once and is the address's.
    await page.getByLabel(WORDS[locale].from, { exact: true }).fill('2026-10-22')
    await expect.poll(() => shownTiles(page)).toEqual(['MAIN-422'])
    await expect
      .poll(() => addressState(page))
      .toEqual({ ...DAYS, view: 'kanban', from: '2026-10-22' })
  })

  test(`at ${width}px in ${locale} the condition's row steps into its periods`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 25, 12))
    await open(page, width, locale, {})
    await page.getByRole('combobox', { name: WORDS[locale].field }).click()
    const menu = page.getByRole('listbox', { name: WORDS[locale].menu })
    await menu.getByRole('option', { name: WORDS[locale].row, exact: true }).click()
    await menu.getByRole('option', { name: WORDS[locale].period, exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(chips(page)).toHaveText([WORDS[locale].today])
    await expect.poll(() => addressState(page)).toEqual({ view: 'kanban', period: 'today' })
    // Today's closed work alone; the days' fields are for days of the reader's own only.
    await expect.poll(() => shownTiles(page)).toEqual(['MAIN-422'])
    await expect(page.locator('.workspace-chips input[type="date"]')).toHaveCount(0)
  })
}
