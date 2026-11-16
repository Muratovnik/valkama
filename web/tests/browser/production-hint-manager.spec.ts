/**
 * The contract of a hint, as the window's one hint manager keeps it for every element, on the
 * item drawer and the Analytics day chart of the built app.
 *
 * The pointer shows a hint after half a second at rest, and the next one at once while one is up,
 * with no frame between neighbours without a hint. A hint the pointer raised can be entered and
 * stays; off it, it goes a moment later. Escape closes the hint and nothing else: over a hint in
 * the item drawer it once closed the drawer as well. A press closes it, and resting on what was
 * pressed brings none back while another part or another element asks again. A scroll closes it,
 * and the end of the scroll asks again for what the resting pointer is on. Focus a key brings
 * shows the hint at once, focus a press brings shows none, and a finger shows none.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { record } from './analyticsPage.ts'
import { openCard } from './cardHeadPage.ts'
import {
  dayParts,
  dayWithIdleSegment,
  hintFrames,
  middleOf,
  openDays,
  pastTheDelay,
  settledHint,
} from './dayHintPage.ts'
import { boxOf, hint, pass, quietPoint, watched, watchHints } from './hintFramesPage.ts'
import type { Watched } from './hintFramesPage.ts'
import { test } from './test.ts'

/** The copy-number button of an open item drawer, with the pointer resting away from it. */
async function drawerAt(page: Page) {
  const drawer = await openCard(page, 'en', 1440)
  const number = drawer.locator('.head-reference')
  await expect(number).toHaveAttribute('data-tooltip', /\S/u)
  const quiet = await quietPoint(drawer)
  await page.mouse.move(quiet.x, quiet.y)
  await watchHints(page)
  return { drawer, number, quiet }
}

test('a hint shows half a second after the pointer comes to rest, and at once by a key', async ({
  page,
}, info) => {
  const { number, quiet } = await drawerAt(page)
  const at = middleOf(await boxOf(number))
  await page.mouse.move(at.x, at.y)
  await expect(hint(page)).toHaveCount(1)
  const pointed = await watched(page)
  const arrived = pointed.arrivals.at(-1)?.at ?? Number.NaN
  const shown = pointed.frames.find((frame) => frame.count > 0)?.at ?? Number.NaN

  // Away until no hint is warm, then by a key from the control after it.
  await page.mouse.move(quiet.x, quiet.y)
  await expect(hint(page)).toHaveCount(0)
  await pass(page, 600)
  await number.locator('xpath=following::button[1]').focus()
  await expect(hint(page)).toHaveCount(0)
  await watched(page)
  await page.keyboard.press('Shift+Tab')
  await expect(number).toBeFocused()
  await expect(hint(page)).toHaveCount(1)
  const keyed = await watched(page)
  const pressed = keyed.arrivals.find((one) => one.on === 'key Tab')?.at ?? Number.NaN
  const opened = keyed.frames.find((frame) => frame.count > 0)?.at ?? Number.NaN
  await record(info, 'hint-show-times', { rest: shown - arrived, key: opened - pressed })

  expect(shown - arrived, 'from rest to the hint, in ms').toBeGreaterThanOrEqual(450)
  expect(shown - arrived, 'from rest to the hint, in ms').toBeLessThanOrEqual(650)
  expect(opened - pressed, 'from the key to the hint, in ms').toBeLessThanOrEqual(100)
})

test('the pointer can move onto a hint, which stays there, and off it the hint goes', async ({
  page,
}, info) => {
  const { number, quiet } = await drawerAt(page)
  const anchor = await boxOf(number)
  const from = middleOf(anchor)
  await page.mouse.move(from.x, from.y)
  await expect(hint(page)).toHaveCount(1)
  const words = await number.getAttribute('data-tooltip')
  const onHint = middleOf(await boxOf(hint(page)))
  await watched(page)

  // Straight from the element onto its hint, across the room between them.
  await page.mouse.move(onHint.x, onHint.y, { steps: 6 })
  await pass(page, 700)
  const stayed = await watched(page)
  const under = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('.tooltip-hint') !== null,
    onHint,
  )

  await page.mouse.move(quiet.x, quiet.y)
  await expect(hint(page)).toHaveCount(0)
  const left = await watched(page)
  const leftAt = left.arrivals.at(-1)?.at ?? Number.NaN
  const goneAt = left.frames.find((frame) => frame.count === 0)?.at ?? Number.NaN
  await record(info, 'hint-entered', { anchor, onHint, stayed, left: goneAt - leftAt })

  expect(under, 'the pointer is on the hint').toBe(true)
  expect(stayed.frames.length, 'frames noted on the hint').toBeGreaterThan(10)
  expect(
    stayed.frames.filter((frame) => frame.count !== 1),
    'every frame on the hint: the hint',
  ).toEqual([])
  expect(stayed.frames.at(-1)?.text.trim()).toBe(words?.trim())
  expect(goneAt - leftAt, 'from leaving the hint to its going, in ms').toBeLessThanOrEqual(220)
})

test('Escape over a hint in an open item drawer closes the hint and leaves the drawer open', async ({
  page,
}) => {
  const { drawer, number } = await drawerAt(page)
  const at = middleOf(await boxOf(number))
  await page.mouse.move(at.x, at.y)
  await expect(hint(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(hint(page)).toHaveCount(0)
  await pass(page, 400)
  await expect(drawer).toBeVisible()
  // Resting where it was closed brings no hint back.
  await pastTheDelay(page)
  await expect(hint(page)).toHaveCount(0)

  // The same for a hint focus holds up, and the next Escape closes the drawer.
  await number.locator('xpath=following::button[1]').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(hint(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(hint(page)).toHaveCount(0)
  await pass(page, 400)
  await expect(drawer).toBeVisible()
  await expect(number).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('moving between neighbouring legend entries of the day chart leaves no frame without a hint', async ({
  page,
}, info) => {
  const days = await openDays(page, 1440)
  const keys = days.locator('.chart-legend .chart-key[data-tooltip]')
  expect(await keys.count(), 'legend entries with a hint').toBeGreaterThan(2)
  await watchHints(page)
  const boxes = await keys.evaluateAll((all) =>
    all.map((key) => {
      const { left, top, right, bottom } = key.getBoundingClientRect()
      return { left, top, right, bottom, words: (key as HTMLElement).dataset.tooltip ?? '' }
    }),
  )
  const [first = boxes[0], ...rest] = boxes
  const start = middleOf(first ?? { left: 0, top: 0, right: 0, bottom: 0 })
  await page.mouse.move(start.x, start.y)
  await expect(hint(page)).toHaveCount(1)
  await watched(page)
  for (const next of rest) await page.mouse.move(middleOf(next).x, middleOf(next).y, { steps: 8 })
  await expect(hint(page)).toContainText(rest.at(-1)?.words.split('\n')[0] ?? '')
  await pass(page, 200)
  const { frames } = await watched(page)
  await record(info, 'hint-legend-frames', { boxes, frames })

  expect(frames.length, 'frames noted').toBeGreaterThan(5)
  expect(
    frames.filter((frame) => frame.count !== 1),
    'every frame along the legend: one hint',
  ).toEqual([])
})

test('a press closes the hint; another part of the day and another day ask again', async ({
  page,
}) => {
  await openDays(page, 1440)
  const day = await dayWithIdleSegment(page)
  const idle = middleOf(day.idle)
  await page.mouse.move(idle.x, idle.y)
  const before = await settledHint(page)
  await page.mouse.down()
  await page.mouse.up()
  await expect(hint(page)).toHaveCount(0)
  await hintFrames(page)
  await pastTheDelay(page)
  const rested = await hintFrames(page)
  expect(
    rested.filter((frame) => frame.length > 0),
    'none while resting',
  ).toEqual([])

  const other = middleOf(day.other)
  await page.mouse.move(other.x, other.y, { steps: 4 })
  const again = await settledHint(page)
  expect(again.text, 'another part').toBe(before.text)

  await page.mouse.move(idle.x, idle.y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.up()
  await expect(hint(page)).toHaveCount(0)
  const nextDay = await dayParts(page, day.index + 1)
  const next = middleOf(nextDay.column)
  await page.mouse.move(next.x, next.y, { steps: 4 })
  const elsewhere = await settledHint(page)
  expect(elsewhere.text, 'another day').not.toBe(before.text)
})

test('a scroll closes the hint, and its end asks again for what the resting pointer is on', async ({
  page,
}, info) => {
  const days = await openDays(page, 1440)
  const key = days.locator('.chart-legend .chart-key[data-tooltip]').first()
  const at = middleOf(await boxOf(key))
  await page.mouse.move(at.x, at.y)
  await expect(hint(page)).toHaveCount(1)
  await watchHints(page)
  // A few pixels, toward the side the entry's scroller has room on, so that the entry is still
  // under the pointer once it has moved.
  const room = await key.evaluate((node) => {
    let scroller = node.parentElement
    while (scroller && !/auto|scroll/u.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement
    const box = scroller ?? document.scrollingElement
    return box ? box.scrollHeight - box.clientHeight - box.scrollTop : 0
  })
  const before = await settledHint(page)
  await page.mouse.wheel(0, room > 10 ? 6 : -6)
  // Closed, then shown again with the pointer where it was. A scroll this short ends within the
  // frame it starts in, so the closing is seen as a change of the page, not in a drawn frame.
  await expect
    .poll(async () => {
      const counts = await page.evaluate(() =>
        (window as unknown as Watched).changes.map((change) => change.count),
      )
      const closed = counts.indexOf(0)
      return closed >= 0 && counts.slice(closed).includes(1)
    }, 'closed by the scroll, then asked for again')
    .toBe(true)
  const { changes } = await watched(page)
  await record(info, 'hint-scroll-changes', { room, changes })
  const again = await settledHint(page)
  expect(again.text, 'the same entry asks again').toBe(before.text)
  expect(await key.evaluate((node) => node.matches(':hover')), 'still on the entry').toBe(true)
})

test('focus a key brings shows a hint at once, and focus a press brings shows none', async ({
  page,
}) => {
  const days = await openDays(page, 1440)
  const column = days.locator('.period-column').first()
  const at = await column.evaluate((node) => {
    const { left, right, bottom } = node.getBoundingClientRect()
    // Low in the column, under every segment, where the press lands on the column itself.
    for (let x = left + 1; x < right; x += 1)
      if (document.elementFromPoint(x, bottom - 2) === node) return { x, y: bottom - 2 }
    throw new Error('no point on the column itself')
  })
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.up()
  await expect(column).toBeFocused()
  await pastTheDelay(page)
  await expect(hint(page)).toHaveCount(0)

  // A key moves focus on to the next day, which shows its hint at once.
  await page.keyboard.press('ArrowRight')
  await expect(hint(page)).toHaveCount(1)
})

test.describe('under a finger', () => {
  test.use({ hasTouch: true })

  test('a tap shows no hint', async ({ page }) => {
    const days = await openDays(page, 1440)
    const day = await dayWithIdleSegment(page)
    const idle = middleOf(day.idle)
    await page.touchscreen.tap(idle.x, idle.y)
    await pastTheDelay(page)
    await expect(hint(page)).toHaveCount(0)
    await expect(days).toBeVisible()
  })
})
