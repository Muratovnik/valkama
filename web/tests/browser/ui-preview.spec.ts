/**
 * The hover card of a work item as the browser paints it: every line readable
 * on the tooltip's ground, a title of any length kept inside the card, and no
 * hover text of its own over the card.
 */
import { expect } from '@playwright/test'

import { drawnColours } from './contrast.ts'
import { test } from './test.ts'

const STATES = [
  'claimed',
  'closed',
  'foreign',
  'stale',
  'long',
  'loading',
  'failed',
  'missing',
  'unavailable',
]

/** Every element that paints words of its own, the title apart. */
const WORDS =
  '.preview-reference, .preview-when, .preview-note, .facet-word, .state-label, .preview-title'

test('every line of the card reads at 4.5:1 on the tooltip ground', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?lang=ru&surface=preview')
  for (const state of STATES) {
    const card = page.locator(`.preview-harness-surface[data-state="${state}"]`)
    await expect(card.locator('.work-item-preview')).toBeVisible()
    const lines = await card.locator(WORDS).all()
    expect(lines.length, state).toBeGreaterThan(0)
    for (const line of lines) {
      const { contrast } = await line.evaluate(drawnColours, 'own' as const)
      expect(contrast, `${state}: «${await line.textContent()}»`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('a title of 200 letters with no space wraps inside the card at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/tests/browser/harness.html?lang=ru&surface=preview')
  const card = page.locator('.preview-harness-surface[data-state="long"]')
  const title = card.locator('.preview-title')
  await expect(title).toHaveText('Ж'.repeat(200))
  const box = await card.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    right: node.getBoundingClientRect().right,
    overflow: node.scrollWidth - node.clientWidth,
  }))
  expect(box.overflow).toBe(0)
  expect(box.right).toBeLessThanOrEqual(390)
  expect(await title.evaluate((node) => node.getClientRects().length)).toBe(1)
  const lines = await title.evaluate(
    (node) =>
      node.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(node).lineHeight),
  )
  expect(Math.round(lines)).toBeGreaterThan(5)
})

test('the card is hidden from assistive technology and brings no hover text of its own', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html?lang=ru&surface=preview')
  const previews = page.locator('.work-item-preview')
  await expect(previews).toHaveCount(STATES.length)
  for (const preview of await previews.all())
    await expect(preview).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('.preview-harness [title]')).toHaveCount(0)
})
