/**
 * Where a finger presses — a phone-sized touch screen, or touch at a laptop's width — every icon
 * that draws its sign alone answers a press across 44px, whichever way its host takes the target
 * from `reach.css`: a reach past the drawing (a review point's fold, the board's «+»), or an
 * inline icon that grows its own box (an entry's actions, the editor's tools, a review point's
 * own variant and comment). Under a mouse at 1280 each keeps the box it draws and answers no
 * further. A review point's own variant stayed 28×28 under a finger, beside a comment press of
 * 44, because an inline icon does not reach and nothing grew it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { REVIEW_PROMPT, reviewFields } from '../support/reviewQuestion.ts'
import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { answersTap } from './commentListBackend.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

/** The places measured, each with the box a mouse leaves it: a token's name. */
const PLACES = [
  ['an entry’s action', '.entry-actions button', '--size-control-inline'],
  ['an editor’s tool', '.discussion-form .markdown-tools button', '--size-control-inline'],
  ['a review point’s comment', '.request-point .request-note-toggle', '--size-control-inline'],
  ['a review point’s fold', '.request-point-toggle', '--size-control-height-compact'],
] as const

/** A card whose thread holds the 18-point review and a discussion, with the composer under it. */
async function openThread(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 })
  const opened = await openQuestion(page, [
    asked({ prompt: REVIEW_PROMPT, fields: reviewFields, title: 'Review of the checks' }),
  ])
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  const { drawer } = opened
  await expect(drawer.locator('.request-point')).toHaveCount(18)
  await expect(drawer.locator('.thread-entry').first()).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  await page.evaluate(async () => document.fonts.ready)
  await page.mouse.move(0, 0)
  return drawer
}

/** Every control a selector finds, each with its drawn box and whether a 44px tap reaches it. */
async function measured(scope: Locator, selector: string) {
  const controls = await scope.locator(selector).all()
  expect(controls.length, selector).toBeGreaterThan(0)
  const found = []
  for (const control of controls) {
    const tap = await answersTap(control)
    const size = await control.evaluate((node) => {
      const { width, height } = node.getBoundingClientRect()
      return { width, height }
    })
    found.push({ tap, ...size })
  }
  return found
}

const tokenOf = (page: Page, name: string) =>
  page.evaluate(
    (token) =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)),
    name,
  )

test.describe('where a finger presses', () => {
  test.use({ hasTouch: true })

  for (const width of [390, 1280]) {
    test(`at ${width} every icon answers a tap across 44px`, async ({ page }) => {
      const drawer = await openThread(page, width)
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      for (const [place, selector] of PLACES) {
        const controls = await measured(drawer, selector)
        expect(
          controls.filter(({ tap }) => !tap),
          `${place} at ${width}`,
        ).toEqual([])
      }
    })
  }

  test('at 390 the board’s «+» reaches past what it draws', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installBackend(page)
    await serve(page)
    await openBoard(page)
    const add = page.locator('.workspace-head').getByRole('button', { name: 'New work item' })
    expect(await answersTap(add)).toBe(true)
  })
})

test('under a mouse at 1280 each icon keeps the box it draws and answers no further', async ({
  page,
}) => {
  const drawer = await openThread(page, 1280)
  for (const [place, selector, token] of PLACES) {
    const side = await tokenOf(page, token)
    for (const control of await measured(drawer, selector))
      expect(control, `${place} under a mouse`).toEqual({ tap: false, width: side, height: side })
  }
})
