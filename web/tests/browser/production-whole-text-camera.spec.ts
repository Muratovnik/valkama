/**
 * The whole words of a cut text on the graph stay on it while the camera moves, in the built app.
 * A transform moves and scales the field's texts with no resize and no scroll, and the wheel's
 * zoom makes no scroll event: laid once, the whole words stayed where they opened and at the
 * scale they opened at. After the wheel brought the field from a scale of 0.625 to 0.947 they
 * stood 2.8px and 2.9px off the cut text's first letter, their letters 10.6px tall over letters
 * 16.1px tall. Now each zoom in and out under the resting pointer lays them on the text again,
 * and a move of the camera the keys bring either lays them where the text went or takes them down.
 */
import { expect } from '@playwright/test'

import { markCut, openCutField, standing } from './cutFieldPage.ts'
import { camera, settledCamera } from './graphFieldCamera.ts'
import { test } from './test.ts'

test('the whole words of a cut text on the graph stay on it as the camera zooms and moves', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  await openCutField(page, 1440)
  const point = await markCut(page)
  expect(point, 'a cut text of the field in sight').not.toBeNull()
  // The field's stop takes focus now, so the key at the end walks from it.
  await page.locator('.graph-flow [tabindex="0"]').first().focus()
  await page.mouse.move(point?.x ?? 0, point?.y ?? 0)
  await expect(page.locator('.whole-text')).toBeVisible()
  expect(await standing(page)).toBe('on its text')
  const opened = await camera(page)

  // Nearer in under the resting pointer, which the zoom keeps on the same letter.
  await page.mouse.wheel(0, -300)
  const nearer = await settledCamera(page)
  expect(nearer.zoom).toBeGreaterThan(opened.zoom)
  await expect.poll(() => standing(page)).toBe('on its text')

  // And farther out again.
  await page.mouse.wheel(0, 200)
  const farther = await settledCamera(page)
  expect(farther.zoom).toBeLessThan(nearer.zoom)
  await expect.poll(() => standing(page)).toBe('on its text')

  // The camera follows the key to the field's last node, moving the text out from under the
  // pointer: the whole words go with it or go.
  await page.keyboard.press('End')
  const moved = await settledCamera(page)
  expect(Math.hypot(moved.x - farther.x, moved.y - farther.y)).toBeGreaterThan(20)
  await expect.poll(() => standing(page)).toMatch(/^(?:on its text|gone)$/u)
})
