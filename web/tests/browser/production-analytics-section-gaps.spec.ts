/**
 * The air between the parts of a section of the Analytics panel, in the built app (`PanelLevel`,
 * `DimensionPanel`, `TokenKindsPanel`). The oracle is the rule (`DESIGN.md`, System rules): the
 * air after every part of a section is the section's 24px, declared once on the section, whatever
 * view each block of a pair shows and whether the pair stands side by side or one under the other.
 * Under a ring, which reaches its block's foot, the day chart's heading stood 16px down and read as
 * stuck to it, where 24px parted every other part.
 *
 * The parts measured are the section's charts (`data-shown`), grouped in the rows they stand in:
 * a dimension's ranked chart and small charts, then its day chart; a list of tasks, alone across
 * the charts, over its day chart; the tokens' ring and small charts. Each row's lowest edge is measured against the next row's top, for every view of the
 * pair at 1440, 1024 and 390 pixels. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** The air between two parts of a section (`--space-6`). */
const SECTION_GAP = 24

const SHOWN = messages.en.analytics.shown

/** The charts of the panel's section, in the rows they stand in, and the air under each row. */
const rowsOf = (page: Page) =>
  page.locator('.analytics-panel [data-shown]').evaluateAll((parts) => {
    const boxes = parts
      .filter((part) => part.checkVisibility())
      .map((part) => ({
        shown: (part as HTMLElement).dataset.shown ?? '',
        top: part.getBoundingClientRect().top,
        bottom: part.getBoundingClientRect().bottom,
      }))
      .sort((one, other) => one.top - other.top)
    const rows: (typeof boxes)[] = []
    for (const box of boxes) {
      const row = rows.at(-1)
      // A part that starts above the row's lowest edge stands beside it, in that row.
      if (row && box.top < Math.max(...row.map((one) => one.bottom))) row.push(box)
      else rows.push([box])
    }
    return {
      parts: boxes.length,
      rows: rows.map((row) => row.map((one) => one.shown)),
      gaps: rows.slice(1).map((row, index) => {
        const above = rows[index] ?? []
        const lowest = Math.max(...above.map((one) => one.bottom))
        return Math.round((Math.min(...row.map((one) => one.top)) - lowest) * 10) / 10
      }),
    }
  })

/** Chooses `view` in the switch of the chart `part`, the `data-shown` section. */
async function choose(part: Locator, view: string) {
  await part
    .locator(':scope > [data-level-head]')
    .getByRole('radio', { name: view, exact: true })
    .click()
}

for (const width of [1440, 1024, 390])
  test(`a dimension's charts stand the section's air apart in every view at ${width} px`, async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width, height: 1000 })
    const analytics = await openPanel(page, pageAt({ by: 'account' }))
    const panel = analytics.locator('.analytics-panel')
    const parts = panel.locator('[data-shown]')
    // The ranked chart, the small charts and the day chart.
    await expect(parts).toHaveCount(3)
    const [ranked, small] = [parts.nth(0), parts.nth(1)]
    const seen: unknown[] = []
    for (const left of [SHOWN.ring, SHOWN.bars, SHOWN.table])
      for (const right of [SHOWN.chart, SHOWN.table]) {
        await choose(ranked, left)
        await choose(small, right)
        await expect(small.getByRole('radio', { name: right, exact: true })).toBeChecked()
        await expect(ranked.getByRole('radio', { name: left, exact: true })).toBeChecked()
        const measured = { left, right, ...(await rowsOf(page)) }
        seen.push(measured)
        expect(measured.parts, `${left} beside ${right}: the parts`).toBe(3)
        expect(measured.gaps.length, `${left} beside ${right}: rows under rows`).toBeGreaterThan(0)
        for (const gap of measured.gaps)
          expect(gap, `${left} beside ${right}: the air under a row`).toBeCloseTo(SECTION_GAP, 0)
      }
    await record(info, `section-gaps-dimension-${width}`, seen)
  })

test('a list of free text stands the section’s air over the day chart in either view', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const analytics = await openPanel(page, pageAt({ by: 'work_item' }))
  const parts = analytics.locator('.analytics-panel [data-shown]')
  // The list of tasks, alone across the charts' width, and the day chart.
  await expect(parts).toHaveCount(2)
  const seen: unknown[] = []
  for (const view of [SHOWN.chart, SHOWN.table]) {
    await choose(parts.first(), view)
    await expect(parts.first().getByRole('radio', { name: view, exact: true })).toBeChecked()
    const measured = { view, ...(await rowsOf(page)) }
    seen.push(measured)
    expect(measured.gaps, `${view}: the air under the list`).toHaveLength(1)
    expect(measured.gaps[0], `${view}: the air under the list`).toBeCloseTo(SECTION_GAP, 0)
  }
  await record(info, 'section-gaps-tasks-1440', seen)
})

test('the tokens’ charts, one under the other on a phone, stand the section’s air apart', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 390, height: 1000 })
  const analytics = await openPanel(page, pageAt({ by: 'token_kind' }))
  const panel = analytics.locator('.analytics-panel')
  await expect(panel.locator('[data-shown]')).toHaveCount(2)
  const measured = await rowsOf(page)
  await record(info, 'section-gaps-tokens-390', measured)
  expect(measured.rows, 'the ring and the small charts one under the other').toHaveLength(2)
  expect(measured.gaps[0], 'the air between them').toBeCloseTo(SECTION_GAP, 0)
})
