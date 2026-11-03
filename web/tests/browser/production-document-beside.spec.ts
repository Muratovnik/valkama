import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { aCardAsking, HUB_TITLE, LINK, linkIn, LONG_PATH } from './documentBackend.ts'
import { test } from './test.ts'

/**
 * A document beside what it was opened from, in the built app with the real keyboard: the
 * window the desktop app opens at, then either side of the width it needs. Where it stands
 * is measured, and what the keys do is what they do in the browser.
 */

const WINDOW = { width: 1500, height: 900 }
const CARD_TITLE = /^Valkama platform execution/u
const CARD_EDGE = 'Resize the work item'

/** The pane, by the name it is announced with. */
function paneOf(page: Page) {
  const pane = page.getByRole('region', { name: /^Document: / })
  return {
    pane,
    body: pane.locator('.document-body'),
    title: pane.locator('.overlay-header-name'),
    target: pane.locator('.document-block.is-target'),
    edge: page.getByRole('separator', { name: 'Document width' }),
    close: pane.getByRole('button', { name: 'Close the document' }),
  }
}

/** Where a shot goes when a person asks for shots: with whatever was moving at rest. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (!folder) return
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )
  await page.screenshot({ path: `${folder}/${name}.png` })
}

async function settled(surface: Locator) {
  await expect(surface).toHaveCSS('transform', 'none')
}

/** Every box is measured against the window it must stay inside. */
async function inWindow(page: Page, target: Locator) {
  const box = await target.boundingBox()
  const { width } = page.viewportSize() ?? WINDOW
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
  return box
}

/** The text of the block at the top of what is read, whichever width it wraps at. */
const leading = (scroller: Locator) =>
  scroller.evaluate((node) => {
    const top = node.getBoundingClientRect().top
    const blocks = [...node.querySelectorAll<HTMLElement>('.document-block')]
    return blocks.find((block) => block.getBoundingClientRect().bottom > top + 1)?.textContent
  })

/** Tab until the card holds focus again, and where focus stood on the way. */
async function tabRound(page: Page) {
  const seen = new Set<string>()
  for (let press = 0; press < 40 && !seen.has('card'); press++) {
    await page.keyboard.press('Tab')
    seen.add(
      await page.evaluate(() => {
        const active = document.activeElement
        if (active?.closest('.overlay-pane-main')) return 'card'
        if (active?.closest('.overlay-pane')) return 'pane'
        return active?.closest('.overlay-host') ? 'surface' : 'out'
      }),
    )
  }
  return seen
}

async function openBesideCard(page: Page, prompt = `Read \`${LINK}\` first.`) {
  await page.setViewportSize(WINDOW)
  const { drawer, comment } = await aCardAsking(page, prompt)
  return { drawer, comment }
}

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
  expect(await leading(over.locator('.document-body'))).toBe(before)
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
  await expect.poll(() => leading(body)).toBe(before)
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

test('the edge folds the document on Enter and brings it back where it was', async ({ page }) => {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { pane, body, edge, target } = paneOf(page)
  await expect(target).toBeFocused()
  const top = await body.evaluate((node) => node.scrollTop)
  const width = await edge.getAttribute('aria-valuenow')

  await edge.focus()
  await page.keyboard.press('Enter')
  await expect(pane).toBeHidden()
  await expect(edge).toHaveAttribute('aria-valuenow', '0')
  await expect(edge).toBeFocused()
  await settled(drawer)
  await inWindow(page, edge)
  await shot(page, 'beside-card-folded')

  await page.keyboard.press('Enter')
  await expect(pane).toBeVisible()
  await expect(edge).toHaveAttribute('aria-valuenow', width ?? '')
  expect(await body.evaluate((node) => node.scrollTop)).toBe(top)
  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0)
  await expect(drawer).toBeVisible()
})

test('a long path gives up its start, at the narrowest the pane stands', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 })
  const { drawer } = await aCardAsking(page, `Read \`${LONG_PATH}\` first.`)
  await linkIn(drawer, LONG_PATH).click()
  const { pane, title } = paneOf(page)
  await expect(title).toHaveText('The long way down')
  await settled(drawer)
  const path = pane.getByRole('button', { name: `Copy the path ${LONG_PATH}` })
  await expect(path).toBeVisible()
  await expect(path).toHaveAttribute('title', `Copy the path ${LONG_PATH}`)
  await inWindow(page, path)
  expect(await path.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  await shot(page, 'beside-card-threshold-long-path')
})

test('a card’s width and a document’s are kept apart, each by its own edge', async ({ page }) => {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { edge } = paneOf(page)
  await expect(edge).toBeVisible()
  const card = page.getByRole('separator', { name: CARD_EDGE })
  const cardWidth = await card.getAttribute('aria-valuenow')
  // Beside a card of 620 at 1500 the document has 480: the threshold's leftover.
  await expect(edge).toHaveAttribute('aria-valuenow', '480')
  await expect(edge).toHaveAttribute('aria-valuemax', '480')
  await edge.focus()
  await page.keyboard.press('Home')
  await expect(edge).toHaveAttribute('aria-valuenow', '440')
  await expect(card).toHaveAttribute('aria-valuenow', cardWidth ?? '')
  expect(await page.evaluate(() => localStorage.getItem('valkama-document-pane-width'))).toBe('440')
})

test('a link in the document goes to the card beside it through the card’s own guard', async ({
  page,
}) => {
  const { drawer, comment } = await openBesideCard(page, 'Read `docs/plan.md` and write.')
  await linkIn(drawer, 'docs/plan.md').click()
  const { pane, title } = paneOf(page)
  await expect(title).toHaveText('The migration plan')
  await comment.fill('A draft the card asks about')
  await pane.getByRole('button', { name: 'MAIN-265', exact: true }).click()
  // The guard asks where the card answers for itself, and the document stays.
  await expect(drawer.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  await expect(pane).toBeVisible()
  await expect(comment).toHaveValue('A draft the card asks about')
})

test('the two panes hold to the accessibility rules, with their frames', async ({ page }) => {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { target } = paneOf(page)
  await expect(target).toBeVisible()
  const { violations } = await new AxeBuilder({ page }).include('.overlay-surface').analyze()
  expect(violations.map(({ id, nodes }) => [id, nodes[0]?.target])).toEqual([])
})

test('a frame is a stop only while there is something in it to scroll', async ({ page }) => {
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).click()
  const { edge, pane, target } = paneOf(page)
  await expect(target).toBeFocused()
  const code = pane.locator('.rich-pre')
  // 480 is too narrow for the line of code, so the keyboard can reach and scroll it.
  await expect(code).toHaveAttribute('tabindex', '0')
  await expect.poll(() => code.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)

  // Grown to the width the code needs, the frame stops being a stop, with nothing else moved.
  await page.setViewportSize({ width: 2400, height: 900 })
  await edge.focus()
  await page.keyboard.press('End')
  await expect(code).not.toHaveAttribute('tabindex')
  await page.setViewportSize(WINDOW)
  await expect(code).toHaveAttribute('tabindex', '0')
})

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('the pair takes the longer words', async ({ page }) => {
    await page.setViewportSize(WINDOW)
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await drawer.getByRole('button', { name: `Открыть документ в Valkama: ${LINK}` }).click()
    const pane = page.getByRole('region', { name: /^Документ: / })
    await expect(pane.locator('.document-block.is-target')).toBeFocused()
    await expect(
      pane.getByRole('button', { name: 'Перейти к #part-two в этом документе' }),
    ).toBeAttached()
    await shot(page, 'beside-card-1500-ru')
  })
})

test.describe('in a forced palette', () => {
  test.use({ forcedColors: 'active' })

  test('the line between the panes stays', async ({ page }) => {
    const { drawer } = await openBesideCard(page)
    await linkIn(drawer, LINK).click()
    const { pane, target } = paneOf(page)
    await expect(target).toBeVisible()
    await expect(pane).toHaveCSS('border-inline-start-style', 'solid')
    await expect(pane).toHaveCSS('border-inline-start-width', '1px')
    await shot(page, 'beside-card-forced')
  })
})
