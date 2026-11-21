/**
 * The ranked rows of Analytics on their column's edge (`RankedBars`). The oracle is the rule
 * (`DESIGN.md`, System rules): what a block in a column draws first stands on the column's edge;
 * a ranked row draws no ground at rest, so it keeps its fill's inset outside the column and its
 * name starts where the heading over it does. Inset inside, every ranked name stood 8px in from
 * its section's heading, in the page and in the value panel.
 *
 * Measured at 1440, 1024 and 390 pixels in the two compositions that draw ranked rows: a section
 * of the page under its level's heading, and the overview's cards, their dense rows under the
 * card's heading. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { openPanel, openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** Under a pixel: two edges a reader sees as one. */
const ONE_EDGE = 0.5

/** Where the first letters of each element's words are drawn. */
function wordsLeft(locator: Locator): Promise<number[]> {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      while (text && !text.textContent?.trim()) text = walker.nextNode()
      if (!text) return Number.NaN
      const range = document.createRange()
      range.selectNodeContents(text)
      return range.getClientRects()[0]?.left ?? Number.NaN
    }),
  )
}

/** A heading's words and the first ranked name under it. */
async function edgeOf(heading: Locator, chart: Locator) {
  const [words] = await wordsLeft(heading)
  const [name] = await wordsLeft(chart.locator('.ranked-label').first())
  return { heading: words ?? Number.NaN, label: name ?? Number.NaN }
}

for (const width of [1440, 1024, 390])
  test(`ranked names start on their heading's edge at ${width} px`, async ({ page }, info) => {
    await serve(page)
    const report = await openReport(page, width, pageAt({ by: 'work_item' }))
    const bars = report.locator('.spending-bars')
    await expect(bars.locator('.ranked-bars')).toBeVisible()
    const section = await edgeOf(
      bars.locator('[data-level-head] :is(h2, h3, h4, h5, h6)').first(),
      bars,
    )

    const overview = await openPanel(page, pageAt())
    const cards = overview.locator('.overview-top:has(.ranked-bars)')
    await expect(cards.first()).toBeVisible()
    const each = []
    for (const card of await cards.all())
      each.push(await edgeOf(card.locator('.overview-top-head'), card))
    await record(info, `ranked-edge-${width}`, { section, cards: each })

    expect(each.length, 'the overview’s ranked cards').toBeGreaterThan(0)
    for (const { heading, label } of [section, ...each])
      expect(Math.abs(label - heading), 'a ranked name on its heading’s edge').toBeLessThan(
        ONE_EDGE,
      )
  })
