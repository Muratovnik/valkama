/**
 * The press of the comment on the marks under a list, read off the built page at a desktop width
 * and a phone's. It stands at the row's start: whatever it draws — at rest, under the pointer,
 * focused from the keyboard, in a forced palette — stays on the comment's sheet, and a finger
 * still reaches it across 44 px.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { answersTap, boxes, openList } from './commentListBackend.ts'
import { frames } from './frames.ts'
import { test } from './test.ts'

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await frames(page.locator(':root'))
}

type Rect = { bottom: number; left: number; right: number; top: number }

/**
 * What a control draws now: its box, its ground if it has one, and its outline (the keyboard's
 * ring, or the frame a forced palette gives a button), each where it is painted, with the
 * comment's sheet it stands on, read in the same frame so that no scroll comes between them.
 */
const drawnOf = (control: Locator) =>
  control.evaluate((node) => {
    const style = getComputedStyle(node)
    const { bottom, left, right, top } = node.getBoundingClientRect()
    const box = { bottom, left, right, top }
    const fill = style.backgroundColor
    const bare = fill === 'transparent' || /rgba\(.*,\s*0\)$/u.test(fill)
    const out =
      (Number.parseFloat(style.outlineWidth) || 0) + Number.parseFloat(style.outlineOffset)
    const outline =
      style.outlineStyle === 'none'
        ? null
        : { bottom: bottom + out, left: left - out, right: right + out, top: top - out }
    const article = node.closest('article')?.getBoundingClientRect()
    if (!article) throw new Error("The press stands on no comment's sheet")
    return {
      box,
      ground: bare ? null : box,
      outline,
      ring: node.matches(':focus-visible'),
      sheet: { bottom: article.bottom, left: article.left, right: article.right, top: article.top },
    }
  })

function expectOnSheet(sheet: Rect, drawn: Rect | null, what: string) {
  if (!drawn) return
  expect.soft(drawn.left, `${what}: left`).toBeGreaterThanOrEqual(sheet.left - 0.5)
  expect.soft(drawn.right, `${what}: right`).toBeLessThanOrEqual(sheet.right + 0.5)
  expect.soft(drawn.top, `${what}: top`).toBeGreaterThanOrEqual(sheet.top - 0.5)
  expect.soft(drawn.bottom, `${what}: bottom`).toBeLessThanOrEqual(sheet.bottom + 0.5)
}

/**
 * Every state the comment's press shows, each drawn on the sheet, and a finger's reach where a
 * finger presses. A forced palette paints grounds of its own, so there the outline it gives the
 * button is its frame, measured at rest.
 */
async function pressOnSheet(page: Page, { finger = false, forced = false } = {}) {
  const { list } = await openList(page)
  const toggle = list.locator('.request-note-toggle')
  await settle(page)
  const rest = await drawnOf(toggle)
  for (const part of ['box', 'ground', 'outline'] as const)
    expectOnSheet(rest.sheet, rest[part], `at rest, its ${part}`)
  // A finger raises no hint, so its reach is probed before the pointer or the keyboard does.
  expect(!finger || (await answersTap(toggle)), 'a 44 px tap').toBe(true)
  await toggle.hover()
  await settle(page)
  const hovered = await drawnOf(toggle)
  if (!forced) expect(hovered.ground, 'under the pointer it draws a ground').not.toBeNull()
  expectOnSheet(hovered.sheet, hovered.ground, 'its ground under the pointer')
  // From the last box, the next stop is the press, and the keyboard rings it.
  await page.mouse.move(0, 0)
  await boxes(list).last().focus()
  await page.keyboard.press('Tab')
  await expect(toggle).toBeFocused()
  await settle(page)
  const focused = await drawnOf(toggle)
  expect(focused.ring, 'the keyboard rings it').toBe(true)
  expect(focused.outline, 'its ring').not.toBeNull()
  expectOnSheet(focused.sheet, focused.outline, 'its keyboard ring')
  return toggle
}

for (const width of [1280, 390])
  for (const forced of [false, true])
    test(`the comment's press stays on the sheet at ${width}${forced ? ', forced colours' : ''}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: forced ? 'active' : 'none' })
      await expect(await pressOnSheet(page, { finger: width < 620, forced })).toBeFocused()
    })

test.describe('under a coarse pointer', () => {
  test.use({ hasTouch: true })

  test('the comment press stays on the sheet and takes a 44 px tap at 1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(await pressOnSheet(page, { finger: true })).toBeFocused()
  })
})
