import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'

/**
 * A card in Russian, the longer of the two languages, and what its identity line says after a
 * press there (`production-card-notes.spec.ts`).
 */

/** The card in Russian at `width`, its identity line drawn. */
export async function openCard(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-identity')).toBeVisible()
  return drawer
}

/**
 * A note in the head says what a press did, whole: its glyph, and its whole sentence in
 * the status region and the glyph's tooltip. Its words stand on screen beside the glyph
 * whole, or, on a line too short for them once all else has stepped aside, not at all:
 * never cut. Nothing else on the line is cut to make room for it.
 */
export async function expectNote(
  page: Page,
  drawer: Locator,
  sentence: string,
  {
    words,
    glyph = 'check',
  }: { words: 'whole' | 'stepped aside'; glyph?: 'check' | 'circle-alert' },
) {
  await expect(drawer.locator('.card-identity [role="status"]')).toHaveText(sentence)
  const shown = drawer.locator('.card-identity .identity-note')
  await expect(shown).toBeVisible()
  await expect(shown).toHaveAttribute('data-tooltip', sentence)
  // A failure keeps a glyph of its own, so it never reads as done.
  const mark = shown.locator('.identity-note-glyph')
  await expect(mark).toBeVisible()
  await expect(mark).toHaveClass(new RegExp(`(^| )lucide-${glyph}( |$)`, 'u'))
  if (words === 'whole') {
    await expect(shown.locator('.identity-note-words')).toHaveText(sentence)
  } else {
    // The words are the last to step aside: the date, the kind and the anchor went first.
    await expect(shown.locator('.identity-note-words')).toHaveCount(0)
    await expect(
      drawer
        .locator('.card-identity')
        .locator('.identity-updated, .identity-kind, .identity-source'),
    ).toHaveCount(0)
  }
  // Nothing on the line is cut to an ellipsis or past its edge: the browser's own measure.
  const cut = await drawer
    .locator('.card-identity, .card-identity :not(.visually-hidden)')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0)
        .map((node) => node.className),
    )
  expect(cut).toEqual([])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
}
