import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { aCardAsking, HUB_TITLE, LINK, linkIn, LONG_PATH } from './documentBackend.ts'
import {
  CARD_EDGE,
  inWindow,
  openBesideCard,
  paneOf,
  settled,
  shot,
  WINDOW,
} from './documentBeside.ts'
import { test } from './test.ts'

/**
 * The edges of a document beside a card or the questions: its divider, its frames, the
 * longest path, the threshold itself, and the same pair in Russian and in a forced palette.
 */

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
  // What is left is a strip that says what it holds, and that it is folded.
  await expect(edge).toHaveAttribute(
    'aria-valuetext',
    'Folded. Enter or a click shows the document again',
  )
  await expect(edge.locator('.overlay-resizer-name')).toHaveText('Document: The migration plan')
  await expect(edge).toHaveAccessibleName('Document: The migration plan')
  const strip = await inWindow(page, edge)
  expect(strip?.width).toBe(32)
  expect(strip?.height).toBe(WINDOW.height)
  await shot(page, 'beside-card-folded')

  await page.keyboard.press('Enter')
  await expect(pane).toBeVisible()
  await expect(edge).toHaveAttribute('aria-valuenow', width ?? '')
  await expect(edge).not.toHaveAttribute('aria-valuetext')
  expect(await body.evaluate((node) => node.scrollTop)).toBe(top)

  // A press of the pointer on the strip brings it back as well.
  await page.keyboard.press('Enter')
  await expect(pane).toBeHidden()
  await edge.click()
  await expect(pane).toBeVisible()
  await expect(edge).toHaveAttribute('aria-valuenow', width ?? '')
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
  await expect(path).toHaveAttribute('data-tooltip', `Copy the path ${LONG_PATH}`)
  await inWindow(page, path)
  expect(await path.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  // Two rows however long the path: the way out beside the title, the actions under it.
  const close = await pane.getByRole('button', { name: 'Close the document' }).boundingBox()
  const pathBox = await path.boundingBox()
  const refresh = await pane.getByRole('button', { name: 'Refresh' }).boundingBox()
  expect(close?.y).toBeLessThan((pathBox?.y ?? 0) + (pathBox?.height ?? 0))
  expect(refresh?.y).toBeGreaterThanOrEqual((close?.y ?? 0) + (close?.height ?? 0))
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
  await pane.getByRole('link', { name: 'MAIN-265', exact: true }).click()
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
  // The page hears of a new window on its next frame, after `setViewportSize` has returned,
  // and End takes the most the window it has heard of leaves.
  const narrow = await edge.getAttribute('aria-valuemax')
  await page.setViewportSize({ width: 2400, height: 900 })
  await expect(edge).not.toHaveAttribute('aria-valuemax', narrow ?? '')
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
    await drawer.getByRole('link', { name: `Открыть документ в Valkama: ${LINK}` }).click()
    const pane = page.getByRole('region', { name: /^Документ: / })
    await expect(pane.locator('.document-block.is-target')).toBeFocused()
    await expect(
      pane.getByRole('link', { name: 'Перейти к #part-two в этом документе' }),
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

/** The questions waiting for an answer, opened from the card, with the link pressed in them. */
async function besideTheQuestions(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^(Needs my answer|Ждут моего ответа)/u }).click()
  const hub = page.getByRole('dialog')
  await settled(hub)
  // The one in the prompt: the task's number above the question is a link as well.
  await hub.locator('.request-prompt .rich-reference').first().click()
  await expect(page.locator('.document-block.is-target')).toBeFocused()
  return hub
}

test.describe('the questions, either side of their threshold', () => {
  test('from 1160 the document stands beside them', async ({ page }) => {
    const hub = await besideTheQuestions(page, 1160)
    await expect(page.getByRole('region', { name: HUB_TITLE })).toBeVisible()
    await settled(hub)
    await inWindow(page, paneOf(page).pane)
    await shot(page, 'beside-questions-threshold')
  })

  test('at 1159 it stands over them', async ({ page }) => {
    await besideTheQuestions(page, 1159)
    await expect(paneOf(page).pane).toHaveCount(0)
    await expect(page.locator('.document-drawer')).toBeVisible()
    await shot(page, 'over-questions-1159')
  })
})

test.describe('the questions in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('beside them, with the longer words', async ({ page }) => {
    const hub = await besideTheQuestions(page, WINDOW.width)
    await expect(page.getByRole('region', { name: 'Ждут моего ответа' })).toBeVisible()
    await settled(hub)
    await shot(page, 'beside-questions-1500-ru')
  })
})

test.describe('the questions in a forced palette', () => {
  test.use({ forcedColors: 'active' })

  test('beside them, each pane in its own frame', async ({ page }) => {
    const hub = await besideTheQuestions(page, WINDOW.width)
    await expect(paneOf(page).pane).toHaveCSS('border-inline-start-style', 'solid')
    await settled(hub)
    await shot(page, 'beside-questions-forced')
  })
})
