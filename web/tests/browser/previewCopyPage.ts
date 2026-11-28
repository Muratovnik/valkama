import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { card, openReported, reference, rest } from './previewPage.ts'

/**
 * A reference's card shown with its copy controls, in either language, and the words those
 * controls say (`production-reference-preview-copy.spec.ts`,
 * `production-reference-preview-copy-clipboard.spec.ts`).
 */

export const WORDS = {
  en: {
    copy: 'Copy MAIN-12',
    copied: 'MAIN-12 copied',
    link: 'Copy link to MAIN-12',
    linked: 'Link copied',
    refused: 'Link not copied',
  },
  ru: {
    copy: 'Скопировать MAIN-12',
    copied: 'MAIN-12 скопирован',
    link: 'Копировать ссылку на MAIN-12',
    linked: 'Ссылка скопирована',
    refused: 'Ссылка не скопирована',
  },
} as const

/** The card of MAIN-12, shown over the reported item's entry. */
export async function shown(page: Page, locale: 'en' | 'ru' = 'en', width = 1440) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  const opened = await openReported(page)
  const link = reference(opened.entry, 'MAIN-12')
  await rest(page, link)
  await expect(card(page)).toBeVisible()
  return { ...opened, link }
}

export const selected = (page: Page) =>
  page.evaluate(() => document.getSelection()?.toString() ?? '')
