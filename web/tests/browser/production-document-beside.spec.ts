import { expect } from '@playwright/test'

import { aCardAsking, HUB_TITLE, LINK, linkIn } from './documentBackend.ts'
import {
  CARD_EDGE,
  CARD_TITLE,
  inWindow,
  leading,
  openBesideCard,
  paneOf,
  samePlace,
  settled,
  shot,
  tabRound,
  WINDOW,
} from './documentBeside.ts'
import { test } from './test.ts'

/**
 * A document beside what it was opened from, in the built app with the real keyboard: the
 * window the desktop app opens at, then either side of the width it needs. Where it stands
 * is measured, and what the keys do is what they do in the browser.
 */

test('from a card: beside it, at the anchor, F6 between them, and Escape one at a time', async ({
  page,
}) => {
  const { drawer, comment } = await openBesideCard(page)
  await comment.fill('Half a thought')
  const link = linkIn(drawer, LINK)
  await link.focus()
  await page.keyboard.press('Enter')

  const { pane, body, title, target } = paneOf(page)
  await expect(title).toHaveText('The migration plan')
  await expect(target).toContainText('The target')
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await shot(page, 'beside-card-1500')

  await settled(drawer)
  // One dialog holding both, and the card is not put under anything.
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.locator('.document-drawer')).toHaveCount(0)
  await expect(drawer).not.toHaveAttribute('inert', '')
  const cardBox = await inWindow(page, page.getByRole('region', { name: CARD_TITLE }))
  const paneBox = await inWindow(page, pane)
  // The document at the window's end, the card to its left, the board's room left over.
  expect((paneBox?.x ?? 0) + (paneBox?.width ?? 0)).toBe(WINDOW.width)
  expect((cardBox?.x ?? 0) + (cardBox?.width ?? 0)).toBe(paneBox?.x)
  expect(cardBox?.x).toBe(400)

  // F6 goes to where focus was, and back to where it came from.
  await page.keyboard.press('F6')
  await expect(link).toBeFocused()
  await page.keyboard.press('Shift+F6')
  await expect(target).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(comment).toHaveValue('Half a thought')
  await expect(drawer).toBeVisible()

  // The next Escape is the card's own close, which asks about the draft first and keeps it.
  await page.keyboard.press('Escape')
  await expect(drawer.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  await expect(comment).toHaveValue('Half a thought')
  await drawer.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('with no draft the next Escape closes the card, and the document already went', async ({
  page,
}) => {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { pane, target } = paneOf(page)
  await expect(target).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Escape in the card closes the card and takes the document with it', async ({ page }) => {
  const { drawer } = await openBesideCard(page)
  const link = linkIn(drawer, LINK)
  await link.click()
  const { pane, target } = paneOf(page)
  await expect(target).toBeFocused()
  await page.keyboard.press('F6')
  await expect(link).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(pane).toHaveCount(0)
})

test('a new window takes the document from beside the card, and focus goes back to the link', async ({
  page,
}) => {
  const { drawer, comment } = await openBesideCard(page)
  await comment.fill('Half a thought')
  const link = linkIn(drawer, LINK)
  await link.click()
  const { pane, target } = paneOf(page)
  await expect(target).toBeFocused()
  // The tab itself is the page journey's to follow; here what it was asked for is enough.
  await page.evaluate(() => {
    const opened: unknown[][] = []
    Object.assign(window, { opened })
    window.open = (...args: unknown[]) => (opened.push(args), null)
  })
  await pane.getByRole('button', { name: 'Open in a new window' }).click()
  const asked = await page.evaluate(() => (window as unknown as { opened: string[][] }).opened)
  expect(asked).toHaveLength(1)
  expect(asked[0]?.[0]).toContain('/doc?')
  expect(asked[0]?.[2]).toBe('noopener')
  await expect(pane).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(comment).toHaveValue('Half a thought')
  await expect(drawer).toBeVisible()
})

test('one Tab trap goes through both panes and comes round', async ({ page }) => {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { close, edge, pane, target } = paneOf(page)
  await expect(target).toBeFocused()

  // On from the anchor, through the rest of the document, and round to the card's first.
  const seen = await tabRound(page)
  expect(seen).toContain('card')
  expect(seen).not.toContain('out')

  // Going on from the card reaches the edge between them, then the document's head.
  await edge.focus()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('.overlay-pane'))).not.toBeNull()
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  expect(await pane.evaluate((node) => node.contains(document.activeElement))).toBe(true)
})

test('from the questions waiting for an answer: beside the dialog, and nothing in it sends', async ({
  page,
}) => {
  await page.setViewportSize(WINDOW)
  const { drawer, requests } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^Needs my answer/u }).click()
  const hub = page.getByRole('dialog', { name: HUB_TITLE })
  await settled(hub)
  const link = linkIn(hub, LINK)
  await link.focus()
  await page.keyboard.press('Enter')

  const { pane, title, target, close, edge } = paneOf(page)
  await expect(target).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('region', { name: HUB_TITLE })).toBeVisible()
  await shot(page, 'beside-questions-1500')

  await settled(hub)
  // The pair stands centred, with the dialog at its own width.
  const dialog = await inWindow(page, page.getByRole('region', { name: HUB_TITLE }))
  const paneBox = await inWindow(page, pane)
  expect(dialog?.width).toBe(640)
  const left = dialog?.x ?? 0
  const right = WINDOW.width - (paneBox?.x ?? 0) - (paneBox?.width ?? 0)
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
  // Their heads are level.
  expect(dialog?.y).toBe(paneBox?.y)

  // A press on anything in the document answers nothing.
  const sent = requests.writes.length
  await pane.getByRole('button', { name: 'Refresh' }).click()
  await pane.getByRole('button', { name: 'Copy the path docs/plan.md' }).click()
  await edge.focus()
  await page.keyboard.press('ArrowLeft')
  await title.click()
  expect(requests.writes).toHaveLength(sent)

  await close.click()
  await expect(pane).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(hub).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(hub).toHaveCount(0)
})

test('the window narrowed past the threshold takes the document over the card, at the same place, and back', async ({
  page,
}) => {
  const { drawer, comment } = await openBesideCard(page)
  await comment.fill('Half a thought')
  await linkIn(drawer, LINK).click()
  const { pane, body, title, target } = paneOf(page)
  await expect(target).toBeFocused()

  // Somewhere that is neither the top of the text nor where it was opened.
  await body.evaluate((node) => node.scrollTo({ top: node.scrollTop + 170 }))
  const before = await leading(body)

  await page.setViewportSize({ width: 1400, height: 900 })
  const over = page.locator('.document-drawer')
  await expect(over).toBeVisible()
  await settled(over)
  await expect(pane).toHaveCount(0)
  await expect(over.locator('.overlay-header-name')).toHaveText('The migration plan')
  await samePlace(over.locator('.document-body'), before)
  await expect(over.locator('.document-block.is-target')).toContainText('The target')
  await expect(over.locator('.document-block.is-target')).toBeFocused()
  // Over the card, which stays mounted under it, its draft in it.
  await expect(drawer.locator('..').locator('.overlay-surface').first()).toHaveAttribute(
    'inert',
    '',
  )
  await expect(drawer.locator('.discussion-form textarea')).toHaveValue('Half a thought')
  // One pane: F6 goes nowhere.
  await page.keyboard.press('F6')
  await expect(over.locator('.document-block.is-target')).toBeFocused()
  await shot(page, 'over-card-1400')

  await page.setViewportSize(WINDOW)
  await expect(title).toHaveText('The migration plan')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await samePlace(body, before)
  await expect(target).toBeFocused()
  await expect(comment).toHaveValue('Half a thought')

  // Whichever host it was opened through, Escape closes it alone and finds the link.
  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0)
  await expect(linkIn(drawer, LINK)).toBeFocused()
})

test('after a move between hosts Escape still finds the link it was opened from', async ({
  page,
}) => {
  const { drawer } = await openBesideCard(page)
  const link = linkIn(drawer, LINK)
  await link.click()
  await expect(paneOf(page).target).toBeFocused()

  await page.setViewportSize({ width: 1400, height: 900 })
  const over = page.locator('.document-drawer')
  await settled(over)
  await page.keyboard.press('Escape')
  await expect(over).toHaveCount(0)
  await expect(link).toBeFocused()
})

test.describe('exactly at the threshold', () => {
  test('a card as it opens stands beside the document in a window of 1460', async ({ page }) => {
    await page.setViewportSize({ width: 1460, height: 900 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await linkIn(drawer, LINK).click()
    await expect(paneOf(page).target).toBeFocused()
    await expect(page.locator('.document-drawer')).toHaveCount(0)
    await settled(drawer)
    await inWindow(page, paneOf(page).pane)
    await shot(page, 'beside-card-threshold')
  })

  test('and under it in a window of 1459', async ({ page }) => {
    await page.setViewportSize({ width: 1459, height: 900 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await linkIn(drawer, LINK).click()
    await expect(page.locator('.document-drawer .document-block.is-target')).toBeFocused()
    await expect(paneOf(page).pane).toHaveCount(0)
  })
})

test('a drag on the card’s edge moves the document only when it ends', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 })
  const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await linkIn(drawer, LINK).click()
  const { pane } = paneOf(page)
  await expect(pane).toBeVisible()
  await settled(drawer)

  const edge = page.getByRole('separator', { name: CARD_EDGE })
  const box = await edge.boundingBox()
  await page.mouse.move((box?.x ?? 0) + 6, 500)
  await page.mouse.down()
  await page.mouse.move((box?.x ?? 0) - 40, 500, { steps: 4 })
  await expect(pane).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.document-drawer')).toBeVisible()
  await expect(pane).toHaveCount(0)
})
