/**
 * A reference in text shows its card under the pointer: when it opens and does not,
 * how the pointer reaches it, what it does to the reference it hangs from.
 *
 * The card is a surface of the window's hint manager, drawn on the library's hover
 * card held open and placed against whichever reference the manager shows it for.
 * These specs are what would notice a change of either changing any of that.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { stroke } from './hintFramesPage.ts'
import { resumeClock, standClock } from './pageClock.ts'
import {
  card,
  CARD,
  cardsAfterTheDelay,
  coolDown,
  middle,
  ontoCard,
  openReported,
  reference,
  rest,
  SPACE,
  spaceModel,
  watchOpening,
  wheelToItsEnd,
} from './previewPage.ts'
import { test } from './test.ts'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // A card's delays run on this clock (`cardsAfterTheDelay`, `coolDown`), so a loaded machine
  // moves no verdict; until a test moves it, it keeps the wall clock's pace.
  await page.clock.install()
})

test('a reference at rest shows its card after half a second, on the tooltip surface', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  // No hover text of the browser's beside it: its old words are its description.
  await expect(link).not.toHaveAttribute('data-tooltip')
  await expect(link).toHaveAttribute('aria-description', 'Open task MAIN-12')

  const opening = watchOpening(page)
  await rest(page, link)
  expect(await opening).toBeGreaterThanOrEqual(450)
  const shown = card(page)
  await expect(shown).toContainText('MAIN-12')
  await expect(shown).toContainText('Keep the reader in place when a card closes')
  await expect(shown).toContainText('1/3')
  await expect(page.locator(CARD)).toHaveCount(1)

  // The surface the card was measured on.
  const surface = await shown.evaluate((element) => {
    const style = getComputedStyle(element)
    const token = (name: string) => {
      const probe = document.createElement('i')
      probe.style.color = `var(${name})`
      document.body.append(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    const box = element.getBoundingClientRect()
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return {
      background: [style.backgroundColor, token('--color-tooltip-surface')],
      border: [style.borderTopColor, token('--color-tooltip-border')],
      paddings: [style.paddingBlockStart, style.paddingInlineStart],
      // At most 22rem, the card's width where the window has the room (`ReferencePreview`).
      width: { drawn: box.width, most: 22 * rem },
      // The card's own layer, and what the window shows at its middle: the card, over the drawer.
      zIndex: style.zIndex,
      onTop: element.contains(
        document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
      ),
    }
  })
  expect(surface.background[0]).toBe(surface.background[1])
  expect(surface.border[0]).toBe(surface.border[1])
  expect(surface.paddings).toEqual(['8px', '12px'])
  expect(surface.width.drawn).toBeGreaterThan(0)
  expect(surface.width.drawn).toBeLessThanOrEqual(surface.width.most)
  expect(surface.zIndex).toBe('120')
  expect(surface.onTop).toBe(true)
})

test("only text shows a card: a tile, a list row and the card's own number already say it all", async ({
  page,
}) => {
  const { drawer, entry } = await openReported(page)
  // The mark a reference that shows a card carries, present where text holds a reference.
  await expect(entry.locator('[data-reference-preview]').first()).toBeVisible()
  const PREVIEW = '[data-reference-preview]'

  // A tile, which reads its own number.
  const tile = page.locator('.work-item-tile').filter({ hasText: 'MAIN-12' }).first()
  await expect(tile).toBeVisible()
  await expect(page.locator(`.work-item-tile${PREVIEW}, .work-item-tile ${PREVIEW}`)).toHaveCount(0)

  // The card's own number, in its head.
  const own = drawer.getByRole('button', { name: 'Copy MAIN-264', exact: true })
  await expect(own).toBeVisible()
  await expect(own).not.toHaveAttribute('data-reference-preview')
  await expect(own.locator(PREVIEW)).toHaveCount(0)

  // A row of its relations, which names the item it links to.
  await drawer.getByRole('tab', { name: 'Relations', exact: true }).click()
  const rows = drawer.locator('.relations .link-row')
  await expect(rows.first()).toBeVisible()
  await expect(drawer.locator('.relations').locator(PREVIEW)).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await rest(page, page.locator('.work-item-tile').filter({ hasText: 'MAIN-12' }).first())
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('the pointer passing over a reference shows nothing', async ({ page }) => {
  const { entry } = await openReported(page)
  await rest(page, reference(entry, 'MAIN-12'))
  await page.mouse.move(5, 5)
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('the pointer can reach the card, stays on it, and closes it by leaving', async ({ page }) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  await rest(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()
  await ontoCard(page, link, { ...(await middle(shown)), steps: 8 })
  expect(await cardsAfterTheDelay(page)).toBe(1)
  await page.mouse.move(5, 5, { steps: 8 })
  await expect(shown).toHaveCount(0)
})

test('a neighbour takes the card over at once; after a pause it waits again', async ({ page }) => {
  const { entry } = await openReported(page)
  await rest(page, reference(entry, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toContainText('MAIN-12')

  // Within 450 ms of the page's clock, which stands from before the move: a card that waited its
  // delay again would not come in that time, and a busy machine does not stretch it.
  const neighbour = reference(entry, 'MAIN-13')
  const { x, y } = await middle(neighbour)
  await standClock(page)
  await page.mouse.move(x, y, { steps: 4 })
  await page.clock.runFor(449)
  await expect(shown).toContainText('MAIN-13')
  await resumeClock(page)
  await expect(page.locator(CARD)).toHaveCount(1)
  // No fading in again: it is the same card, moved.
  await expect(shown).toHaveAttribute('data-opened', 'at-once')
  await expect(reference(entry, 'MAIN-12')).not.toHaveAttribute('aria-describedby')

  await page.mouse.move(5, 5, { steps: 4 })
  await expect(shown).toHaveCount(0)
  await coolDown(page)
  const opening = watchOpening(page)
  await rest(page, reference(entry, 'MAIN-12'))
  expect(await opening).toBeGreaterThanOrEqual(450)
})

test('down a list, the card keeps the pointer over the reference it covers', async ({ page }) => {
  const { entry } = await openReported(page)
  const held = reference(entry, 'MAIN-15')
  await rest(page, held)
  const shown = card(page)
  await expect(shown).toContainText('MAIN-15')
  // Whichever side it hangs on, it covers the list's next line on that side.
  const side = (await shown.getAttribute('data-side')) as 'top' | 'bottom'
  expect(['top', 'bottom']).toContain(side)
  const neighbour = { top: 'MAIN-14', bottom: 'MAIN-16' }[side]
  const covered = reference(entry, neighbour)
  const under = await middle(covered)
  const covering = await shown.boundingBox()
  const from = await held.boundingBox()
  expect(covering).not.toBeNull()
  expect(from).not.toBeNull()
  const box = covering ?? { x: 0, y: 0, width: 0, height: 0 }
  const start = from ?? { x: 0, y: 0, width: 0, height: 0 }
  expect(under.x).toBeGreaterThan(box.x)
  expect(under.x).toBeLessThan(box.x + box.width)
  expect(under.y).toBeGreaterThan(box.y)
  expect(under.y).toBeLessThan(box.y + box.height)

  // Onto the card past the end of the references, then along it to the covered one's
  // place: the card stays, or nothing next to a reference could ever be reached on it.
  const edge = { top: box.y + box.height - 8, bottom: box.y + 8 }[side]
  const onHeld = await middle(held)
  const via = [
    { x: start.x + start.width - 2, y: start.y + start.height / 2, steps: 2 },
    { x: start.x + start.width + 40, y: edge, steps: 6 },
  ]
  await stroke(page, onHeld, [...via, { ...under, steps: 6 }])
  expect(await cardsAfterTheDelay(page)).toBe(1)
  await expect(shown).toContainText('MAIN-15')

  // Once the card is gone the covered reference is a reference like any other.
  await page.mouse.move(5, 5, { steps: 6 })
  await expect(shown).toHaveCount(0)
  await coolDown(page)
  await rest(page, covered)
  await expect(card(page)).toContainText(neighbour)
  await expect(page.locator(CARD)).toHaveCount(1)
})

test('a press opens the task, as it did, and leaves no card before or after', async ({ page }) => {
  const { drawer, entry } = await openReported(page)
  const link = reference(entry, 'MAIN-265')
  await rest(page, link)
  // Pressed while the card is still waiting.
  await page.mouse.down()
  await page.mouse.up()
  await expect(drawer.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
  await expect(drawer).toContainText('Wire contract freeze')
  expect(await cardsAfterTheDelay(page)).toBe(0)

  // And a press with the card up closes it on the way.
  await drawer.getByRole('button', { name: 'Back', exact: true }).click()
  const back = reference(drawer.locator('.thread-entry').first(), 'MAIN-265')
  await rest(page, back)
  await expect(card(page)).toBeVisible()
  await page.mouse.down()
  await expect(card(page)).toHaveCount(0)
  await page.mouse.up()
  await expect(drawer.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('a press outside closes the card, and a wheel over it does nothing', async ({ page }) => {
  const { drawer, entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  await rest(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()
  await ontoCard(page, link, { ...(await middle(shown)), steps: 8 })
  await page.mouse.wheel(0, 200)
  expect(await cardsAfterTheDelay(page)).toBe(1)

  await drawer.getByRole('heading', { name: 'Discussion' }).click()
  await expect(shown).toHaveCount(0)
  await expect(drawer).toBeVisible()
})

test('a press in the card takes no focus, so the draft holds it and Tab stays in the drawer', async ({
  page,
}) => {
  const { drawer, entry } = await openReported(page)
  const draft = drawer.locator('.discussion-form').getByRole('textbox')
  await draft.fill('A draft in progress')
  await draft.focus()
  const link = reference(entry, 'MAIN-12')
  await rest(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()
  await ontoCard(page, link, { ...(await middle(shown)), steps: 8 })
  await page.mouse.down()
  await page.mouse.up()
  await expect(draft).toBeFocused()
  await expect(draft).toHaveValue('A draft in progress')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('.overlay-host') !== null)).toBe(
    true,
  )
})

/** Resolves once no card is on the page: start it before what should close the card. */
const closing = (page: Page) =>
  page.evaluate(
    (selector) =>
      new Promise<boolean>((resolve) => {
        const seen = new MutationObserver(() => {
          if (document.querySelector(selector)) return
          seen.disconnect()
          resolve(true)
        })
        seen.observe(document.body, { childList: true, subtree: true })
      }),
    CARD,
  )

/**
 * Once a scroll under a pointer at `at` that has not moved has ended and the delay a card would
 * take has passed: the reference under the pointer now, if any, and whether the card on the page
 * hangs from it, as the reference's description says.
 */
async function afterTheScroll(page: Page, at: { x: number; y: number }) {
  await cardsAfterTheDelay(page)
  return page.evaluate(
    ({ x, y, selector }) => {
      const under = document.elementFromPoint(x, y)?.closest('[data-reference-preview]')
      const cards = document.querySelectorAll(selector)
      const id = under?.getAttribute('aria-describedby')
      return {
        cards: cards.length,
        // The card's words, kept apart from it, describe the reference whose card shows.
        describedByTheCard: Boolean(
          id &&
          cards.length === 1 &&
          document.querySelector(`[data-reference-description][id="${id}"]`)?.textContent?.trim(),
        ),
        under: under
          ? [...document.querySelectorAll('[data-reference-preview]')].indexOf(under)
          : -1,
      }
    },
    { ...at, selector: CARD },
  )
}

/** What a scroll's end shows: the card of the reference under the pointer, or none over text. */
function expectTheCardOfWhatIsUnder(after: Awaited<ReturnType<typeof afterTheScroll>>) {
  if (after.under < 0) expect(after.cards, 'no reference under the pointer: no card').toBe(0)
  else
    expect(after, 'the card of the reference under the pointer').toMatchObject({
      cards: 1,
      describedByTheCard: true,
    })
}

test('a scroll closes the card, and its end asks again for what the still pointer is on', async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, index) =>
    index % 2 === 0 ? `Line ${index} with MAIN-12 in it.` : `Line ${index}, plain.`,
  )
  const { drawer, entry } = await openReported(page, lines.join('\n\n'))
  await entry.getByRole('button', { name: 'Show all', exact: true }).click()
  const links = reference(entry, 'MAIN-12')
  await rest(page, links.nth(3))
  const at = await middle(links.nth(3))
  await expect(card(page)).toBeVisible()
  const closed = closing(page)
  await wheelToItsEnd(page, 120)
  expect(await closed, 'closed by the scroll').toBe(true)
  // A resting pointer points at whatever the scroll brought under it, as for a hint.
  expectTheCardOfWhatIsUnder(await afterTheScroll(page, at))

  // Wheeling on: the reference the card came from has moved from under the pointer.
  const standing = await links.nth(3).boundingBox()
  await wheelToItsEnd(page, 60)
  expectTheCardOfWhatIsUnder(await afterTheScroll(page, at))
  expect(await links.nth(3).boundingBox()).not.toEqual(standing)
  await expect(drawer).toBeVisible()

  // A wheel while the card still waits calls that card off: whatever shows is what is under.
  await page.mouse.move(5, 5)
  await expect(card(page)).toHaveCount(0)
  await coolDown(page)
  await rest(page, links.nth(8))
  const resting = await middle(links.nth(8))
  const waited = await links
    .nth(8)
    .evaluate((link) => [...document.querySelectorAll('[data-reference-preview]')].indexOf(link))
  await wheelToItsEnd(page, 240)
  const after = await afterTheScroll(page, resting)
  expectTheCardOfWhatIsUnder(after)
  expect(after.under, 'the waited reference has left the pointer').not.toBe(waited)
})

test('the card follows the stream while open, and goes with its reference', async ({ page }) => {
  const { entry, stream } = await openReported(page)
  await rest(page, reference(entry, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toContainText('Keep the reader in place')

  const renamed = SPACE.map((item) =>
    item.reference === 'MAIN-12' ? { ...item, title: 'Renamed while it was open' } : item,
  )
  await stream.deliver(JSON.stringify(spaceModel(renamed)))
  await expect(shown).toContainText('Renamed while it was open')

  // Deleted while it was open: the reference is text now, and the card has no place to hang.
  await stream.deliver(
    JSON.stringify(spaceModel(SPACE.filter((item) => item.reference !== 'MAIN-12'))),
  )
  await expect(reference(entry, 'MAIN-12')).toHaveCount(0)
  await expect(entry).toContainText('See MAIN-12 for the read')
  await expect(shown).toHaveCount(0)
})

test.describe('where the window is narrow or a person asks for less', () => {
  test('at 390px the card fits the window and turns over above a reference low on it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { entry } = await openReported(page)
    const link = reference(entry, 'MAIN-13')
    await link.scrollIntoViewIfNeeded()
    await rest(page, link)
    const shown = card(page)
    await expect(shown).toBeVisible()
    const box = (await shown.boundingBox()) ?? { x: -1, y: 0, width: 999, height: 0 }
    expect(box.x).toBeGreaterThanOrEqual(8)
    expect(box.x + box.width).toBeLessThanOrEqual(382)
    expect(box.width).toBeLessThanOrEqual(352)
    await page.mouse.move(5, 5, { steps: 4 })
    await expect(shown).toHaveCount(0)

    // With the reference at the foot of the window there is room only above it.
    await coolDown(page)
    await link.evaluate((element) => element.scrollIntoView({ block: 'end' }))
    await rest(page, link)
    await expect(shown).toHaveAttribute('data-side', 'top')
    const above = (await shown.boundingBox()) ?? { y: -1 }
    expect(above.y).toBeGreaterThanOrEqual(8)
  })

  test('with less motion asked for it just appears', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { entry } = await openReported(page)
    await rest(page, reference(entry, 'MAIN-12'))
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toHaveCSS('animation-name', 'none')
  })

  test('it fades in otherwise, and in forced colours keeps its edge and loses its shadow', async ({
    page,
  }) => {
    const { entry } = await openReported(page)
    await rest(page, reference(entry, 'MAIN-12'))
    await expect(card(page)).toHaveCSS('animation-name', 'reference-preview-appear')
    await page.mouse.move(5, 5)
    await expect(card(page)).toHaveCount(0)

    await page.emulateMedia({ forcedColors: 'active' })
    await rest(page, reference(entry, 'MAIN-12'))
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toHaveCSS('box-shadow', 'none')
    await expect(card(page)).toHaveCSS('border-top-style', 'solid')
    await expect(card(page).locator('.state-dot')).toBeVisible()
  })
})

test.describe('by touch', () => {
  test.use({ hasTouch: true })

  test('a tap opens the task and shows no card', async ({ page }) => {
    const { drawer, entry } = await openReported(page)
    await reference(entry, 'MAIN-265').tap()
    await expect(drawer).toContainText('Wire contract freeze')
    expect(await cardsAfterTheDelay(page)).toBe(0)
  })
})
