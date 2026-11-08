/**
 * A reference in text shows its card under the pointer: when it opens and does not,
 * how the pointer reaches it, what it does to the reference it hangs from.
 *
 * The one popup of the window is the library's Tooltip pointed from outside at
 * whichever reference is under the pointer, a use it does not document. These specs
 * are what would notice an upgrade of it changing any of that.
 */
import { expect } from '@playwright/test'

import {
  card,
  CARD,
  cardsAfterTheDelay,
  coolDown,
  middle,
  openReported,
  reference,
  rest,
  SPACE,
  spaceModel,
  watchOpening,
} from './previewPage.ts'
import { test } from './test.ts'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('a reference at rest shows its card after half a second, on the tooltip surface', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  // No hover text of the browser's beside it: its old words are its description.
  await expect(link).not.toHaveAttribute('title')
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
    return {
      background: [style.backgroundColor, token('--color-tooltip-surface')],
      border: [style.borderTopColor, token('--color-tooltip-border')],
      paddings: [style.paddingBlockStart, style.paddingInlineStart],
      width: element.getBoundingClientRect().width,
      zIndex: getComputedStyle(element.parentElement as Element).zIndex,
    }
  })
  expect(surface.background[0]).toBe(surface.background[1])
  expect(surface.border[0]).toBe(surface.border[1])
  expect(surface.paddings).toEqual(['8px', '12px'])
  expect(surface.width).toBe(352)
  expect(surface.zIndex).toBe('120')
})

test("only text shows a card: a tile, a list row and the card's own number already say it all", async ({
  page,
}) => {
  const { drawer } = await openReported(page)
  await expect(page.locator('.work-item-tile [data-reference-preview]')).toHaveCount(0)
  await expect(drawer.locator('.inspector-identity [data-reference-preview]')).toHaveCount(0)
  await expect(drawer.locator('.relations [data-reference-preview]')).toHaveCount(0)
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
  const { x, y } = await middle(shown)
  await page.mouse.move(x, y, { steps: 8 })
  expect(await cardsAfterTheDelay(page)).toBe(1)
  await page.mouse.move(5, 5, { steps: 8 })
  await expect(shown).toHaveCount(0)
})

test('a neighbour takes the card over at once; after a pause it waits again', async ({ page }) => {
  const { entry } = await openReported(page)
  await rest(page, reference(entry, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toContainText('MAIN-12')

  const neighbour = reference(entry, 'MAIN-13')
  const { x, y } = await middle(neighbour)
  const before = Date.now()
  await page.mouse.move(x, y, { steps: 4 })
  await expect(shown).toContainText('MAIN-13')
  expect(Date.now() - before).toBeLessThan(450)
  await expect(page.locator(CARD)).toHaveCount(1)
  // No fading in again: it is the same card, moved.
  await expect(shown).toHaveAttribute('data-state', 'instant-open')
  await expect(reference(entry, 'MAIN-12')).not.toHaveAttribute('aria-describedby')

  await page.mouse.move(5, 5, { steps: 4 })
  await expect(shown).toHaveCount(0)
  await coolDown()
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
  await page.mouse.move(start.x + start.width - 2, start.y + start.height / 2, { steps: 2 })
  await page.mouse.move(start.x + start.width + 40, edge, { steps: 6 })
  await page.mouse.move(under.x, under.y, { steps: 6 })
  expect(await cardsAfterTheDelay(page)).toBe(1)
  await expect(shown).toContainText('MAIN-15')

  // Once the card is gone the covered reference is a reference like any other.
  await page.mouse.move(5, 5, { steps: 6 })
  await expect(shown).toHaveCount(0)
  await coolDown()
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
  await rest(page, reference(entry, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toBeVisible()
  const { x, y } = await middle(shown)
  await page.mouse.move(x, y, { steps: 8 })
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
  await rest(page, reference(entry, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toBeVisible()
  const { x, y } = await middle(shown)
  await page.mouse.move(x, y, { steps: 8 })
  await page.mouse.down()
  await page.mouse.up()
  await expect(draft).toBeFocused()
  await expect(draft).toHaveValue('A draft in progress')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('.overlay-host') !== null)).toBe(
    true,
  )
})

test('a wheel under a still pointer opens nothing, and a scroll closes the card', async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, index) =>
    index % 2 === 0 ? `Line ${index} with MAIN-12 in it.` : `Line ${index}, plain.`,
  )
  const { drawer, entry } = await openReported(page, lines.join('\n\n'))
  await entry.getByRole('button', { name: 'Show all', exact: true }).click()
  const links = reference(entry, 'MAIN-12')
  await rest(page, links.nth(3))
  await expect(card(page)).toBeVisible()
  await page.mouse.wheel(0, 120)
  await expect(card(page)).toHaveCount(0)

  // Wheeling on until a reference stands under the pointer, which has not moved.
  const standing = await links.nth(3).boundingBox()
  await page.mouse.wheel(0, 60)
  expect(await cardsAfterTheDelay(page)).toBe(0)
  expect(await links.nth(3).boundingBox()).not.toEqual(standing)
  await expect(drawer).toBeVisible()

  // A wheel while the card still waits calls it off too.
  await page.mouse.move(5, 5)
  await coolDown()
  await rest(page, links.nth(8))
  await page.mouse.wheel(0, 240)
  expect(await cardsAfterTheDelay(page)).toBe(0)
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
    await coolDown()
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
