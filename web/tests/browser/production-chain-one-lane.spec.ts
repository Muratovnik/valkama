import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainOf, mapMember } from '../fixtures/chainMap.ts'
import { installBackend } from './backend.ts'
import { serve } from './chainFixtures.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The card's chain section with all its work in one lane and one state, as a chain that has
 * just begun is: nothing to choose between and nothing to tell apart, so the section reads as
 * a name, its figures and a list, each part standing clear of the next.
 */

const ROOT = { id: workItem.work_item_id, reference: workItemRef.reference, title: workItem.title }

/** The least the parts stand apart, and the most the rows inside one of them do. */
const BETWEEN_PARTS = 20
const WITHIN_A_PART = 8

const bottomOf = (box: { height: number; y: number } | null) => (box?.y ?? 0) + (box?.height ?? 0)

for (const width of [1280, 390]) {
  test(`one lane in one state reads at ${width}px as a name, figures and a list`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page)
    await serve(
      page,
      chainOf(ROOT, [mapMember('MAIN-1401', 'backlog', null, { ready: true, title: 'One task' })]),
    )
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        entity: planningWorkItemEntity(workItemRef),
      }),
    )
    const section = page.locator('.drawer section.chain')
    await expect(section.locator('.chain-rows')).toBeVisible()

    // As the eye reads it: the state is named once, in the heading of the list. The map's
    // caption says it again for a screen reader, who has no key to read it from.
    const seen = await section.evaluate((node) => {
      const copy = node.cloneNode(true) as Element
      for (const hidden of copy.querySelectorAll('.visually-hidden')) hidden.remove()
      return copy.textContent
    })
    expect(seen.match(/backlog/giu)).toHaveLength(1)
    await expect(section.locator('.chain-group-title')).toHaveText('Backlog · 1')

    // The lane is named and offers nothing: no control, and the pointer does not say otherwise.
    const name = section.locator('.branch-map-label')
    await expect(name).toHaveText('no epic')
    await expect(section.locator('.branch-map').getByRole('button')).toHaveCount(0)
    await expect(name).toHaveCSS('cursor', 'auto')
    await name.click()
    await expect(section.locator('.chain-lane-chip')).toHaveCount(0)

    // Further apart between the parts than within them, so they do not read as one run.
    const canvas = await section.locator('.branch-map-canvas').boundingBox()
    const figures = await section.locator('.chain-summary').boundingBox()
    const line = await section.locator('.chain-summary-line').boundingBox()
    const details = await section.locator('.chain-details').boundingBox()
    const heading = await section.locator('.chain-group-title').boundingBox()
    const rows = await section.locator('.chain-rows').boundingBox()
    expect((figures?.y ?? 0) - bottomOf(canvas)).toBeGreaterThanOrEqual(BETWEEN_PARTS)
    expect((heading?.y ?? 0) - bottomOf(figures)).toBeGreaterThanOrEqual(BETWEEN_PARTS)
    expect((details?.y ?? 0) - bottomOf(line)).toBeLessThanOrEqual(WITHIN_A_PART)
    expect((rows?.y ?? 0) - bottomOf(heading)).toBeLessThanOrEqual(WITHIN_A_PART)

    await section.screenshot({ path: info.outputPath(`chain-one-lane-${width}.png`) })
  })
}
