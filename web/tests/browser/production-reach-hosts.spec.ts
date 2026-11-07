/**
 * The finger's target of a question's own presses, asked where every other control asks it
 * (`reach.css`): a field label's comment press grows its box, a list's comment press and a dense
 * row's fold reach past what they draw. Under a finger, and on a window a phone's width with a
 * mouse, each answers a tap across 44px; under a mouse at 1280 none answers past its box. Each of
 * them used to ask only for a coarse pointer, so at 560 with a mouse they stood 28px beside an
 * entry's icons of 44.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { answersTap, listEntry, openList } from './commentListBackend.ts'
import { frames } from './frames.ts'
import { asked, routeField } from './questionBackend.ts'
import { test } from './test.ts'

/** Each press, with its drawn side under a mouse at 1280. */
const LIST = [
  ['a list’s comment press', '.comment-list .request-note-toggle', 28],
  ['a dense row’s fold', '.comment-list .is-dense .request-option-toggle', 28],
] as const
const LEGEND = ['a field label’s comment press', '.request-legend-note', 28] as const

async function settle(page: Page, scope: Locator) {
  await page.evaluate(async () => document.fonts.ready)
  await page.mouse.move(0, 0)
  await frames(scope)
}

/** Every control a selector finds, each with its drawn box and whether a 44px tap reaches it. */
async function measured(scope: Locator, selector: string) {
  const controls = await scope.locator(selector).all()
  expect(controls.length, selector).toBeGreaterThan(0)
  const found = []
  for (const control of controls) {
    const tap = await answersTap(control)
    const box = await control.evaluate((node) => {
      const { width, height } = node.getBoundingClientRect()
      return { width: Math.round(width), height: Math.round(height) }
    })
    found.push({ tap, ...box })
  }
  return found
}

/** The list under a comment and a question of two fields, on one card, each press measured. */
async function everyPress(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const fields = [routeField, { ...routeField, id: 'second', label: 'Second' }]
  const { drawer } = await openList(page, [listEntry(), asked({ fields })])
  await expect(drawer.locator(LEGEND[1])).toHaveCount(2)
  await settle(page, drawer)
  const found: [string, number, Awaited<ReturnType<typeof measured>>][] = []
  for (const [what, selector, side] of [...LIST, LEGEND])
    found.push([what, side, await measured(drawer, selector)])
  return found
}

const short = (found: Awaited<ReturnType<typeof everyPress>>) =>
  found.flatMap(([what, , controls]) =>
    controls.filter(({ tap }) => !tap).map((control) => ({ what, ...control })),
  )

test.describe('under a finger', () => {
  test.use({ hasTouch: true })

  for (const width of [390, 1280])
    test(`at ${width} each answers a tap across 44px`, async ({ page }) => {
      const found = await everyPress(page, width)
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      expect(short(found)).toEqual([])
    })
})

test('under a mouse on a window a phone’s width each answers a tap across 44px', async ({
  page,
}) => {
  const found = await everyPress(page, 560)
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false)
  expect(short(found)).toEqual([])
})

test('under a mouse at 1280 each keeps the box it draws and answers no further', async ({
  page,
}) => {
  for (const [what, side, controls] of await everyPress(page, 1280))
    for (const control of controls)
      expect(control, what).toEqual({ tap: false, width: side, height: side })
})
