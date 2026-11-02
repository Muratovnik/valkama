/**
 * Labels on a board tile in the built application: one line of whole words and a
 * count of the rest, a word that stays legible on a pointed-at sheet and a face
 * that comes up when it is pointed at, and a label that filters while the rest of
 * the sheet opens the card.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { centre, openBoard, serve } from './boardPage.ts'
import { drawnColours } from './contrast.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** The fill drawn behind a chip's word, or nothing where it has none of its own. */
const faceOf = (chip: Locator) =>
  chip.locator('.chip-face').evaluate((node) => getComputedStyle(node).backgroundColor)

test('a label chip on a tile filters instead of opening, and the rest of the sheet opens it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  const sheet = page.locator('.work-item-column[data-state="dev"] .work-item-tile').first()
  const chip = sheet.locator('.label-chip').first()
  await expect(chip).toBeVisible()
  // A pointed-at sheet lifts to the control grey, and chips drawn in it vanished. At
  // rest a label is its word, which holds its contrast on that ground too.
  await sheet.locator('.tile-title').hover()
  expect(await faceOf(chip)).toBe('rgba(0, 0, 0, 0)')
  const word = await chip.locator('.chip-face').evaluate(drawnColours, 'own' as const)
  expect(word.contrast).toBeGreaterThanOrEqual(4.5)
  // Pointed at itself it gets its face, which says it can be pressed.
  await chip.hover()
  await expect.poll(() => faceOf(chip)).not.toBe('rgba(0, 0, 0, 0)')
  // A chip lies over the open target stretched across the sheet, so the pointer reaches it.
  await chip.click()
  await expect(page.locator('.drawer')).toHaveCount(0)
  // The sheet is still one Tab stop: the chip is reached by the pointer only.
  await expect(chip).toHaveAttribute('tabindex', '-1')
  // Anywhere else on the sheet — here its last line, the holder — lies under the open
  // target and opens the card.
  const facts = await centre(sheet.locator('.tile-facts'))
  await page.mouse.click(facts.x, facts.y)
  await expect(page.locator('.drawer')).toBeVisible()
})

for (const width of [1440, 1024, 390] as const)
  test(`a tile keeps its labels on one line and counts the rest at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await serve(page)
    await openBoard(page)
    const sheet = page.locator('[data-reference="MAIN-430"] .work-item-tile')
    const line = sheet.locator('.tile-labels')
    const chips = line.locator('> .label-chip')
    const count = line.locator('> [data-facet="labels"]')
    await expect(count).toBeVisible()
    // Labels used to wrap, one 28px row per chip in a narrow column.
    const drawn = await chips.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { top: Math.round(box.top), right: box.right, height: box.height }
      }),
    )
    const edge = await line.evaluate((element) => element.getBoundingClientRect().right)
    expect(new Set(drawn.map((chip) => chip.top)).size).toBe(1)
    expect(drawn.length).toBeGreaterThanOrEqual(1)
    expect(drawn.length).toBeLessThanOrEqual(3)
    for (const chip of drawn) expect(chip.right).toBeLessThanOrEqual(edge + 0.5)
    // The line is a line of text tall, and the pointer still has its 28px: the box
    // reaches past the line into the air around it.
    const box = await line.boundingBox()
    expect(box?.height).toBeLessThan(24)
    const target = await chips
      .first()
      .evaluate((chip) => Number.parseFloat(getComputedStyle(chip, '::after').height))
    expect(Math.round(target)).toBe(28)
    // Whole chips and the count of the rest add up to the item's four labels.
    await expect(count).toHaveText(`+${4 - drawn.length}`)
    // The sheet is still one Tab stop, the copy measured out of sight included.
    const stops = await sheet.evaluate(
      (element) =>
        [...element.querySelectorAll<HTMLElement>('button, a, [tabindex]')].filter(
          (candidate) => candidate.tabIndex >= 0,
        ).length,
    )
    expect(stops).toBe(1)
    // The count lies under the open target, so a click on it opens the card.
    await count.scrollIntoViewIfNeeded()
    const where = await centre(count)
    await page.mouse.click(where.x, where.y)
    await expect(page.locator('.drawer')).toBeVisible()
  })
