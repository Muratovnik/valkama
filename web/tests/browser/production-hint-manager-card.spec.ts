/**
 * A reference's card as a surface of the window's one hint manager, on the item drawer of the
 * built app: it takes over from a hint, and a hint from it, at once and with one surface in every
 * frame; it can be entered and goes a moment after the pointer leaves it; Escape over it closes it
 * and nothing under it, as over a hint (`production-hint-manager.spec.ts`).
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { record } from './analyticsPage.ts'
import { middleOf, pastTheDelay } from './dayHintPage.ts'
import type { Arrival, Frame } from './hintFramesPage.ts'
import { boxOf, hint, pass, quietPoint, watched, watchHints } from './hintFramesPage.ts'
import { card, middle, openReported, reference, rest } from './previewPage.ts'
import { test } from './test.ts'

/**
 * An item drawer whose discussion names `MAIN-12`, brought into view, and a point on the drawer's
 * head where an element with a hint stands: the head stays while its body scrolls.
 */
async function cardAt(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const opened = await openReported(page)
  const link = reference(opened.entry, 'MAIN-12')
  await link.scrollIntoViewIfNeeded()
  const onHead = middleOf(await boxOf(opened.drawer.locator('.head-reference')))
  // The head pins the item's title over itself as its body scrolls, and settles a moment later.
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-tooltip]') !== null,
          onHead,
        ),
      'an element with a hint on the head',
    )
    .toBe(true)
  await watchHints(page)
  return { ...opened, link, onHead }
}

/** When the pointer arrived where it stopped, in what was noted, in ms. */
const arrived = (noted: { arrivals: Arrival[] }) => noted.arrivals.at(-1)?.at ?? Number.NaN

/** When the first frame showed `surface` alone, in ms. */
const shownAlone = (frames: Frame[], surface: 'card' | 'hint') =>
  frames.find((frame) => frame.surfaces.join(',') === surface)?.at ?? Number.NaN

test('a hint, a card and a hint again take over from each other at once, one surface a frame', async ({
  page,
}, info) => {
  const { link, onHead } = await cardAt(page)
  const onLink = await middle(link)
  await page.mouse.move(onHead.x, onHead.y)
  await expect(hint(page)).toHaveCount(1)
  await watched(page)

  // Straight from the head onto the reference, while the head's hint is up.
  await page.mouse.move(onLink.x, onLink.y, { steps: 3 })
  await expect(card(page)).toContainText('Keep the reader in place')
  await pass(page, 200)
  const toCard = await watched(page)
  // And back onto the head, while the card is up.
  await page.mouse.move(onHead.x, onHead.y, { steps: 3 })
  await expect(hint(page)).toHaveCount(1)
  await pass(page, 200)
  const toHint = await watched(page)
  // A frame is stamped as it starts, so one drawn after an arrival may read a little before it.
  const delays = {
    card: shownAlone(toCard.frames, 'card') - arrived(toCard),
    hint: shownAlone(toHint.frames, 'hint') - arrived(toHint),
  }
  await record(info, 'hint-card-hint-frames', { delays, toCard, toHint })

  for (const [name, noted] of [
    ['hint to card', toCard],
    ['card to hint', toHint],
  ] as const) {
    expect(noted.frames.length, `frames noted, ${name}`).toBeGreaterThan(5)
    expect(
      noted.frames.filter((frame) => frame.surfaces.length !== 1),
      `every frame, ${name}: one surface`,
    ).toEqual([])
  }
  expect(toCard.frames.at(-1)?.surfaces).toEqual(['card'])
  expect(toHint.frames.at(-1)?.surfaces).toEqual(['hint'])
  expect(delays.card, 'from the reference to its card, in ms').toBeLessThanOrEqual(100)
  expect(delays.hint, 'from the head to its hint, in ms').toBeLessThanOrEqual(100)
})

test('the pointer can move onto a card, which stays there, and off it the card goes', async ({
  page,
}, info) => {
  const { drawer, link } = await cardAt(page)
  const quiet = await quietPoint(drawer)
  await rest(page, link)
  await expect(card(page)).toBeVisible()
  const onCard = middleOf(await boxOf(card(page)))
  await watched(page)

  await page.mouse.move(onCard.x, onCard.y, { steps: 6 })
  await pass(page, 700)
  const stayed = await watched(page)

  await page.mouse.move(quiet.x, quiet.y)
  await expect(card(page)).toHaveCount(0)
  const left = await watched(page)
  const leftAt = left.arrivals.at(-1)?.at ?? Number.NaN
  const goneAt = left.frames.find((frame) => frame.surfaces.length === 0)?.at ?? Number.NaN
  await record(info, 'card-entered', { onCard, stayed, left: goneAt - leftAt })

  expect(stayed.frames.length, 'frames noted on the card').toBeGreaterThan(10)
  expect(
    stayed.frames.filter((frame) => frame.surfaces.join(',') !== 'card'),
    'every frame on the card: the card',
  ).toEqual([])
  expect(goneAt - leftAt, 'from leaving the card to its going, in ms').toBeGreaterThanOrEqual(80)
  expect(goneAt - leftAt, 'from leaving the card to its going, in ms').toBeLessThanOrEqual(220)
})

test('Escape over a card in an open item drawer closes the card and leaves the drawer open', async ({
  page,
}) => {
  const { drawer, entry, link } = await cardAt(page)
  await rest(page, link)
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await pass(page, 400)
  await expect(drawer).toBeVisible()
  // Resting where it was closed brings no card back.
  await pastTheDelay(page)
  await expect(card(page)).toHaveCount(0)

  // The same for a card focus holds up, and the next Escape closes the drawer.
  await link.evaluate((element) => {
    const before = document.createElement('button')
    before.dataset.before = ''
    element.before(before)
  })
  await entry.locator('[data-before]').focus()
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await pass(page, 400)
  await expect(drawer).toBeVisible()
  await expect(link).toBeFocused()
  await expect(card(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})
