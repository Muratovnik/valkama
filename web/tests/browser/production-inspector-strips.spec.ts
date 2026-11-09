/**
 * The questions the inspector asks in place, read off the built page in both languages at a
 * laptop's width and a phone's: carrying a refused move through, taking a claim over, and leaving
 * with a draft. Each strip stands on the column its host gives it: on a sheet of its own tone it
 * draws no ground and starts its words on that sheet's edge, on the drawer it is a block a step
 * above, and wherever the two buttons fit side by side they share a line at the strip's end.
 * No host says which of the two it is; the strip reads the ground it stands on.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { expectStripOnColumn } from './confirmStrip.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { openCard } from './editorPage.ts'
import { projectScope } from './planningFixtures.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

const WORDS = {
  en: { close: 'Close', done: 'Done', state: 'State', takeOver: 'Take over' },
  ru: { close: 'Закрыть', done: 'Выполнено', state: 'Состояние', takeOver: 'Забрать себе' },
} as const
type Locale = keyof typeof WORDS

async function inLocale(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`
    const words = WORDS[locale]

    test(`${at}: carrying a refused move through asks on the refusal's own edge`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      await installDiscussionBackend(page)
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
      await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
      const drawer = page.locator('.drawer')
      await expect(drawer).toHaveCSS('transform', 'none')
      await drawer.getByRole('combobox', { name: new RegExp(`^${words.state}`, 'u') }).click()
      // The fixture's workflow is the standard one, whose names read in the page's language.
      await page.getByRole('option', { name: words.done, exact: true }).click()
      const refusal = drawer.locator('.refusal')
      await refusal.locator('.refusal-force').click()
      await expectStripOnColumn(refusal.locator('.confirm-strip'), refusal, `${at} refusal`)
    })

    test(`${at}: taking a claim over asks in a block on the drawer`, async ({ page }) => {
      await inLocale(page, locale, width)
      const { drawer } = await openCard(page)
      await drawer.getByRole('button', { name: words.takeOver, exact: true }).first().click()
      const strip = drawer.locator('.drawer-frame-notices .confirm-strip')
      await expectStripOnColumn(strip, strip, `${at} takeover`, true)
      // The way back holds focus, so a reflexive Enter keeps what was there.
      await expect(strip.locator('.confirm-cancel')).toBeFocused()
    })

    test(`${at}: leaving with a draft asks in a block on the drawer`, async ({ page }) => {
      await inLocale(page, locale, width)
      const { drawer, card } = await openQuestion(page, [asked()])
      await card.getByRole('radio').first().check()
      await drawer.getByRole('button', { name: words.close, exact: true }).click()
      const strip = drawer.locator('.drawer-frame-notices .confirm-strip')
      await expectStripOnColumn(strip, strip, `${at} leaving`, true)
      // The way back holds focus, so a reflexive Enter keeps what was there.
      await expect(strip.locator('.confirm-cancel')).toBeFocused()
    })
  }
