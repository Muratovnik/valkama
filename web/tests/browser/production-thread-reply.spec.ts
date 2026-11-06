/**
 * The forms under a thread, read off the built page in both languages at a laptop's width and a
 * phone's: the asking before written words are dropped stands on the column's edge with its
 * buttons at its end, in a reply and in the mark's form.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectStripOnColumn } from './confirmStrip.ts'
import { openCard } from './editorPage.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const WORDS = {
  en: { reply: 'Reply', resolve: 'Resolve' },
  ru: { reply: 'Ответить', resolve: 'Разобрано' },
} as const
type Locale = keyof typeof WORDS

async function openThread(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openCard(page)
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  const thread = opened.drawer
    .locator('.thread-entry')
    .filter({ hasText: 'Should the second report' })
  await expect(thread).toBeVisible()
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  return { ...opened, thread }
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    test(`${at}: the asking before a reply is dropped stands on the column, its buttons at its end`, async ({
      page,
    }) => {
      const { thread } = await openThread(page, locale, width)
      await thread.getByRole('button', { name: WORDS[locale].reply, exact: true }).first().click()
      await page.keyboard.insertText('Words to keep')
      await page.keyboard.press('Escape')
      const form = thread.locator('form.reply-composer')
      await expect(form.locator('.confirm-strip')).toBeVisible()
      await expectStripOnColumn(form.locator('.confirm-strip'), form, `${at} reply`)
    })

    test(`${at}: the asking before a decision is dropped stands on the column, its buttons at its end`, async ({
      page,
    }) => {
      const { thread } = await openThread(page, locale, width)
      await thread.getByRole('button', { name: WORDS[locale].resolve, exact: true }).click()
      await page.keyboard.insertText('A decision')
      await page.keyboard.press('Escape')
      const form = thread.locator('form.resolve-form')
      await expect(form.locator('.confirm-strip')).toBeVisible()
      await expectStripOnColumn(form.locator('.confirm-strip'), form, `${at} decision`)
    })
  }
