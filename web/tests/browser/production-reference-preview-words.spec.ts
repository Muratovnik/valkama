/**
 * The hover card is where an item is read in full, so a long word on it wraps and is
 * never cut: a holder used to end in «side sessi…», whole only for a screen reader.
 */
import { expect } from '@playwright/test'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { card, held, openReported, reference, rest, SPACE } from './previewPage.ts'
import { test } from './test.ts'

/** A holder whose session is no id the product reads, so the whole of it is its name. */
const HOLDER = 'claude-code session local_433e996b side session of a long acceptance probe'

const LONG_HELD = held(17, 'Held under a long name', {
  claim_ref: HOLDER,
  claim_state: 'live',
} as Partial<WorkItemBrief>)

for (const width of [1500, 390]) {
  test(`a long holder wraps on the card, whole and inside it, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { entry } = await openReported(page, 'Held by MAIN-17 now.', [...SPACE, LONG_HELD])
    await rest(page, reference(entry, 'MAIN-17'))
    const shown = card(page)
    await expect(shown).toContainText('Held under a long name')

    const holder = shown.locator('[data-facet="holder"] .facet-word')
    await expect(holder).toHaveText(HOLDER)
    // On screen, whole: nothing of it past its own box, and no ellipsis standing for it.
    const cut = await holder.evaluate((word) => ({
      clipped: word.scrollWidth > word.clientWidth + 1,
      ellipsis: getComputedStyle(word).textOverflow,
      lines: Math.round(
        word.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(word).lineHeight),
      ),
    }))
    expect(cut.clipped).toBe(false)
    expect(cut.ellipsis).not.toBe('ellipsis')
    expect(cut.lines).toBeGreaterThan(1)

    // The card stays inside the window, and the page does not scroll sideways for it.
    const box = await shown.boundingBox()
    expect(box).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
}
