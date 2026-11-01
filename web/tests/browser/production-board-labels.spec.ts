/**
 * Label chips on a board tile in the built application: one line of whole
 * chips and a count of the rest, a face that stays distinct on a pointed-at
 * sheet, and a chip that filters while the rest of the sheet opens the card.
 */
import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { centre, openBoard, serve } from './boardPage.ts'
import { drawnColours } from './contrast.ts'
import { projectScope } from './planningFixtures.ts'

/** How far a chip's drawn face stands above the sheet it lies on, as a WCAG 2 ratio. */
async function lift(chip: Locator, sheet: Locator) {
  const face = await chip.locator('.chip-face').evaluate(drawnColours, 'own')
  const ground = await sheet.evaluate(drawnColours, 'own')
  const [light = 0, dark = 0] = [face.fillLuminance, ground.fillLuminance].toSorted(
    (left, right) => right - left,
  )
  return {
    fill: face.fillLuminance,
    lighter: face.fillLuminance > ground.fillLuminance,
    ratio: (light + 0.05) / (dark + 0.05),
  }
}

test('a label chip on a tile filters instead of opening, and the rest of the sheet opens it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  const sheet = page.locator('.work-item-column[data-state="dev"] .work-item-tile').first()
  const chip = sheet.locator('.label-chip').first()
  await expect(chip).toBeVisible()
  // A pointed-at sheet lifts to the tone the chip's face used to be, and its
  // chips vanished into it; the face is a lift over its ground now.
  await sheet.locator('.tile-title').hover()
  const rest = await lift(chip, sheet)
  expect(rest.lighter).toBe(true)
  expect(rest.ratio).toBeGreaterThanOrEqual(1.1)
  // And pointed at itself it rises again, rather than sinking to a fixed grey.
  await chip.hover()
  const raised = await lift(chip, sheet)
  expect(raised.fill).toBeGreaterThan(rest.fill)
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
    // The 28px pointer box is the line's height, once.
    const box = await line.boundingBox()
    expect(Math.round(box?.height ?? 0)).toBe(28)
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
