/**
 * The signs of the card's facts that name another thing by what it is, measured in the built
 * app: the parent by its own kind, and the holder's session by its client, each at the size it
 * is drawn at and on the middle of its words' capitals (`production-card-alignment.spec.ts`
 * holds the rest of the head).
 */
import { expect } from '@playwright/test'

import { alignmentGaps, measure, openCard } from './cardHeadPage.ts'
import { test } from './test.ts'

/**
 * The parent's row: any item may hold others, so the row is «Parent» and its sign is the
 * parent's own kind, in that kind's ink — the epic's for an epic, the generic parent's for a
 * plain task — at the size a facet's glyph is drawn at, as the priority's beside it, and on the
 * middle of the reference's capitals, as every sign of the facts stands. Every parent was called «Epic» under the epic's sign, a task holding others too.
 */
const PARENT_SIGNS = {
  epic: { icon: 'lucide-layers', ink: '--color-kind-epic' },
  task: { icon: 'lucide-corner-down-right', ink: '--color-kind-task' },
} as const
const PARENT_ROW = { ru: 'Родитель', en: 'Parent' } as const

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    for (const [parentKind, sign] of Object.entries(PARENT_SIGNS)) {
      test(`a ${parentKind} parent is named a parent and drawn by its own kind, ${locale} at ${width}px`, async ({
        page,
      }) => {
        const drawer = await openCard(page, locale, width, { epic: 'MAIN-12', parentKind })
        const names = await drawer.locator('.card-row-label').allTextContents()
        expect(names.map((name) => name.trim())).toContain(PARENT_ROW[locale])
        expect(names.map((name) => name.trim())).not.toContain(locale === 'ru' ? 'Эпик' : 'Epic')
        const mark = drawer.locator('.card-parent [data-facet="parent"]')
        await expect(mark).toHaveAttribute('data-kind', parentKind)
        const glyph = mark.locator('svg')
        await expect(glyph).toHaveClass(new RegExp(sign.icon, 'u'))
        const drawn = await glyph.evaluate((element, ink) => {
          const probe = document.createElement('span')
          probe.style.color = `var(${ink})`
          document.body.append(probe)
          const expected = getComputedStyle(probe).color
          probe.remove()
          const { width: across, height } = element.getBoundingClientRect()
          const declared = Number(element.getAttribute('width'))
          return { across, declared, height, ink: getComputedStyle(element).color, expected }
        }, sign.ink)
        // A facet's glyph is drawn at 14px on every surface (`drawMarks`).
        expect(drawn.declared).toBe(14)
        expect(drawn.across, 'the sign is as wide as it is drawn').toBeCloseTo(drawn.declared, 1)
        expect(drawn.height, 'the sign is as tall as it is drawn').toBeCloseTo(drawn.declared, 1)
        expect(drawn.ink, `the sign takes ${sign.ink}`).toBe(drawn.expected)
        const line = await measure(page, {
          root: '.drawer .card-parent',
          texts: { reference: '.card-parent-link a' },
          marks: { sign: '[data-facet="parent"] svg' },
        })
        console.info(`parent ${parentKind} ${locale} ${width}px`, JSON.stringify(line))
        for (const { gap, label, room } of alignmentGaps(line, [['sign', 'reference']]))
          expect(gap, label).toBeLessThanOrEqual(room)
      })
    }
  }
}

/**
 * The executor in the holder's row is drawn by its client's sign, as a tile draws it, at the
 * size it is drawn at and on the middle of the name's capitals; the place its session opens in
 * is in what a press does, the button's name and hint. VS Code's mark stood there, a second
 * sign for the executor a tile draws as Claude.
 */
for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    test(`the holder's sign is its client's, ${locale} at ${width}px`, async ({ page }) => {
      const drawer = await openCard(page, locale, width, { held: true })
      const button = drawer.locator('.card-holder-value button.open-action')
      await expect(button.locator('[data-mark="client"]')).toHaveAttribute(
        'aria-label',
        'Claude Code',
      )
      await expect(button.locator('[data-mark="place"]')).toHaveCount(0)
      await expect(button).toHaveAttribute('aria-label', /VS Code/u)
      const glyph = button.locator('[data-mark="client"] svg')
      await expect(glyph).toHaveClass(/lucide-asterisk/u)
      const size = await glyph.evaluate((element) => {
        const { width: across, height } = element.getBoundingClientRect()
        return { across, height, declared: Number(element.getAttribute('width')) }
      })
      expect(size.declared).toBe(14)
      expect(size.across, 'the sign is as wide as it is drawn').toBeCloseTo(size.declared, 1)
      expect(size.height, 'the sign is as tall as it is drawn').toBeCloseTo(size.declared, 1)
      const line = await measure(page, {
        root: '.drawer .card-holder-value',
        texts: { name: '.open-action-name' },
        marks: { sign: '[data-mark="client"] svg' },
      })
      console.info(`holder ${locale} ${width}px`, JSON.stringify(line))
      for (const { gap, label, room } of alignmentGaps(line, [['sign', 'name']]))
        expect(gap, label).toBeLessThanOrEqual(room)
    })
  }
}
