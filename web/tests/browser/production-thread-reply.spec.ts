/**
 * The forms under a thread, read off the built page in both languages at a laptop's width and a
 * phone's: the mark that goes with a reply answers a press across its whole line, at least the
 * 24px DESIGN.md sets as every target's floor, and the asking before written words are dropped
 * stands on the column's edge with its buttons at its end, in a reply and in the mark's form.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { expectStripOnColumn } from './confirmStrip.ts'
import { openCard } from './editorPage.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const WORDS = {
  en: { mark: 'Mark the thread resolved', reply: 'Reply', resolve: 'Resolve' },
  ru: { mark: 'Отметить ветку разобранной', reply: 'Ответить', resolve: 'Разобрано' },
} as const
type Locale = keyof typeof WORDS
const FLOOR = 24

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

/** The box itself and the line that takes its press, as drawn, and what a press lands on at
 *  each inside edge of that line. */
const markTarget = (box: Locator) =>
  box.evaluate((input) => {
    const line = input.closest('label')
    if (!line) throw new Error('The box has no label around it')
    const own = input.getBoundingClientRect()
    const target = line.getBoundingClientRect()
    const inside = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)
      return hit !== null && line.contains(hit)
    }
    const middle = { x: target.left + target.width / 2, y: target.top + target.height / 2 }
    return {
      box: { height: own.height, width: own.width },
      edges: [
        inside(target.left + 1, middle.y),
        inside(target.right - 1, middle.y),
        inside(middle.x, target.top + 1),
        inside(middle.x, target.bottom - 1),
      ],
      target: { height: target.height, width: target.width },
    }
  })

/** The middle of the label's words, by a Range over them, where a person presses. */
const wordsMiddle = (box: Locator) =>
  box.evaluate((input) => {
    const line = input.closest('label')
    const walker = line && document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let text = walker?.nextNode()
    while (text && !text.textContent?.trim()) text = walker?.nextNode()
    if (!text) throw new Error('The label has no words')
    const range = document.createRange()
    range.selectNodeContents(text)
    const { left, top, width, height } = range.getBoundingClientRect()
    return { x: left + width / 2, y: top + height / 2 }
  })

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    test(`${at}: the mark with a reply answers a press across a line of at least ${FLOOR}px`, async ({
      page,
    }) => {
      const { thread } = await openThread(page, locale, width)
      await thread.getByRole('button', { name: WORDS[locale].reply, exact: true }).first().click()
      const box = thread.getByRole('checkbox', { name: WORDS[locale].mark })
      await expect(box).toBeVisible()
      // In the middle of the view, where a person brings it before pressing.
      await box.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }))
      const drawn = await markTarget(box)
      // The box alone is drawn smaller than the floor, so the line around it is the target.
      expect(drawn.box.height).toBeLessThan(FLOOR)
      expect(drawn.target.height, `${at}: the line's height`).toBeGreaterThanOrEqual(FLOOR)
      expect(drawn.target.width, `${at}: the line's width`).toBeGreaterThanOrEqual(FLOOR)
      expect(drawn.edges, `${at}: each edge of the line takes the press`).toEqual([
        true,
        true,
        true,
        true,
      ])
      // And a press on the words ticks the box, which is what makes the line its target.
      const middle = await wordsMiddle(box)
      await page.mouse.click(middle.x, middle.y)
      await expect(box).toBeChecked()
    })

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
