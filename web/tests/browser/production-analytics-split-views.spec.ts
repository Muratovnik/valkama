/**
 * The charts of one whole split into parts, in the real app over the browser double: each is drawn
 * as a ring or as ranked bars, switched with its table, and opens on what the owner's rule gives —
 * the ring, but the bars where the parts are as many as the tasks. The oracle is that rule and the
 * charts' contracts: a section by account opens on its ring, one by task on its bars, one split by
 * a second dimension offers the bars alone, the tokens by kind open on their ring, a quota
 * window's block opens on its bars by task and on its ring by project; the overview's cards of
 * first values are no split and offer no switch; and every view of a chart reads the same figures.
 *
 * A ring writes nothing on its sectors: its legend gives each part its figure and share at the end
 * of its line, the figures of the legend and of the rows apart under it ending at one edge, each
 * on its name's line, measured with the legend beside the ring and under it. Each run prints what
 * it measured and keeps a picture of each section.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { SPENT_WORLD } from '../fixtures/quotaSpent.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { test } from './test.ts'

const section = (page: Page) => page.locator('.analytics-panel .spending-bars')

/** The options a section's switch offers and the one it shows. */
async function views(where: Locator) {
  const radios = where.locator('.level-head [role="radio"]')
  return {
    offered: await radios.allInnerTexts(),
    shown: await where.locator('.level-head [role="radio"][aria-checked="true"]').textContent(),
  }
}

/** Each legend line of a ring: its name and the figure before its share. */
const legendFigures = (chart: Locator) =>
  chart
    .locator('.chart-entry')
    .evaluateAll((entries) =>
      entries.map((entry) => [
        entry.querySelector('.chart-key-name')?.textContent ?? '',
        (entry.querySelector('.chart-figure')?.textContent ?? '').split(' · ')[0] ?? '',
      ]),
    )

/** Each ranked row: its name and its figure. */
const barFigures = (chart: Locator) =>
  chart
    .locator('.ranked-row')
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.querySelector('.ranked-label')?.textContent ?? '',
        row.querySelector('.ranked-value')?.textContent ?? '',
      ]),
    )

test('each split opens on its own drawing, switches, and reads the same figures in every view', async ({
  page,
}, info) => {
  await serve(page)
  await openReport(page, 1440, pageAt({ by: 'account' }))
  const accounts = section(page)
  expect(await views(accounts)).toEqual({ offered: ['Ring', 'Bars', 'Table'], shown: 'Ring' })
  await expect(accounts.locator('.donut-chart')).toBeVisible()
  const ring = await legendFigures(accounts)
  await accounts.getByRole('radio', { name: 'Bars', exact: true }).click()
  await expect(accounts).toHaveAttribute('data-shown', 'bars')
  const bars = await barFigures(accounts)
  // The two accounts and the unknown work: every part named by the ring, with the bar's figure.
  expect(ring.length).toBeGreaterThan(1)
  for (const [name, figure] of ring) expect(bars).toContainEqual([name, figure])
  await accounts.getByRole('radio', { name: 'Table', exact: true }).click()
  for (const [name, figure] of ring)
    await expect(accounts.locator('tbody tr', { hasText: name })).toContainText(figure)
  await record(info, 'split by account', { ring, bars })

  await openReport(page, 1440, pageAt({ by: 'work_item' }))
  expect(await views(section(page))).toEqual({ offered: ['Ring', 'Bars', 'Table'], shown: 'Bars' })
  await expect(section(page).locator('.ranked-bars')).toBeVisible()

  await openReport(page, 1440, pageAt({ by: 'model', across: 'effort' }))
  expect(await views(section(page))).toEqual({ offered: ['Bars', 'Table'], shown: 'Bars' })

  const kinds = await openSection(page, 1440, 'token_kind', '.kinds-bars')
  expect(await views(kinds)).toEqual({ offered: ['Ring', 'Bars', 'Table'], shown: 'Ring' })

  // The overview's cards rank the first values of a dimension, not a whole: no switch.
  await page.goto(pageAt())
  await expect(page.locator('.overview-top').first()).toBeVisible()
  await expect(page.locator('.overview-top [role="radio"]')).toHaveCount(0)
})

test('a quota window’s block opens on its bars by task and on its ring by project, with the same figures', async ({
  page,
}, info) => {
  await serve(page, SPENT_WORLD)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(pageAt({ by: 'quota_five_hour' }))
  const work = page
    .locator('.quota-account')
    .filter({ has: page.locator('.quota-account-name', { hasText: /^Work$/u }) })
    .locator('.quota-window[data-window="five_hour"] .window-spend')
  await expect(work.locator('.ranked-bars')).toBeVisible()
  await expect(work.getByRole('radio', { name: 'Bars', exact: true })).toBeChecked()

  await work.getByRole('radio', { name: 'Projects' }).click()
  await expect(work.getByRole('radio', { name: 'Ring', exact: true })).toBeChecked()
  await expect(work.locator('.donut-chart')).toBeVisible()
  const ring = await legendFigures(work)
  await work.getByRole('radio', { name: 'Bars', exact: true }).click()
  // The bars say a figure and its share in one value; the ring's figure is its start.
  const lines = await barFigures(work)
  const bars = lines.map(([name, value]) => [name, value?.split(' · ')[0]])
  expect(ring).toEqual(bars)
  await record(info, 'quota block by project', { ring, bars })
})

/**
 * Where the ring, its legend, the legend's figures and the rows apart stand: the legend beside
 * the ring or under it, both inside the column; each figure on its name's line and on one line;
 * the end of every figure, the legend's and the rows apart's, and the text of every sector.
 */
function legendLayout(chart: Locator) {
  return chart.evaluate((figure) => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => element?.getBoundingClientRect() ?? new DOMRect()
    const column = box(figure)
    const ring = box(figure.querySelector('.donut-ring'))
    const legend = box(figure.querySelector('.chart-legend'))
    const lines = [...figure.querySelectorAll('.chart-entry')].map((entry) => {
      const name = box(entry.querySelector('.chart-key-name'))
      const value = box(entry.querySelector('.chart-figure'))
      const lineHeight = Number.parseFloat(
        getComputedStyle(entry.querySelector('.chart-figure') ?? entry).lineHeight,
      )
      return {
        middleOff: Math.abs(name.top + name.height / 2 - (value.top + value.height / 2)),
        oneLine: value.height <= lineHeight + 0.5,
        end: value.right,
      }
    })
    const notes = [...figure.querySelectorAll('.donut-note-value')].map((one) => box(one).right)
    const ends = [...lines.map((line) => line.end), ...notes]
    let layout = 'over'
    if (legend.left >= ring.right) layout = 'beside'
    else if (legend.top >= ring.bottom) layout = 'under'
    const inside = (inner: DOMRect) =>
      inner.left >= column.left - 0.5 && inner.right <= column.right + 0.5
    return {
      layout,
      ringInColumn: inside(ring),
      legendInColumn: inside(legend),
      lines: lines.length,
      notes: notes.length,
      endsSpread: Math.round((Math.max(...ends) - Math.min(...ends)) * 100) / 100,
      worstMiddleOff: Math.round(Math.max(...lines.map((line) => line.middleOff)) * 100) / 100,
      allOneLine: lines.every((line) => line.oneLine),
      sectorText: figure.querySelector('.donut-ring')?.textContent ?? '',
      svgText: figure.querySelectorAll('.donut-ring text').length,
    }
  })
}

/** Opens a section at a width and finds `where` in it: a narrow page opens on its list of sections. */
async function openSection(page: Page, width: number, by: string, where: string) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(pageAt({ by }))
  const analytics = page.locator('.analytics-page')
  await analytics.locator('.analytics-rail:visible, .analytics-panel:visible').first().waitFor()
  if (!(await analytics.locator('.analytics-panel').isVisible()))
    await analytics.locator('.analytics-rail [aria-current="page"]').click()
  const block = page.locator(`.analytics-panel ${where}`).first()
  await expect(block).toBeVisible()
  return block
}

/** Turns the quota's section to its charts, which a narrow page opens as their tables. */
async function drawCharts(panel: Locator) {
  const charts = panel.locator('.chart-section > .level-head').getByRole('radio', { name: 'Chart' })
  if (!(await charts.isChecked())) await charts.click()
}

/** Opens a section at a width on its ring, which a narrow page reaches by its switch. */
async function ringAt(page: Page, width: number, by: string, where: string) {
  const block = await openSection(page, width, by, where)
  const ring = block.getByRole('radio', { name: 'Ring', exact: true })
  if (!(await ring.isChecked())) await ring.click()
  const chart = block.locator('.donut-chart')
  await expect(chart.locator('.donut-sector').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return { block, chart }
}

for (const [width, layout] of [
  [1440, 'beside'],
  [390, 'under'],
] as const)
  test(`at ${width} pixels a ring's legend carries its figures on one edge, ${layout} the ring, and its sectors no words`, async ({
    page,
  }, info) => {
    await serve(page)
    const measured: Record<string, unknown> = {}
    for (const [by, where] of [
      ['account', '.spending-bars'],
      ['token_kind', '.kinds-bars'],
    ] as const) {
      const { block, chart } = await ringAt(page, width, by, where)
      const seen = await legendLayout(chart)
      measured[by] = seen
      expect(seen).toMatchObject({
        layout,
        ringInColumn: true,
        legendInColumn: true,
        allOneLine: true,
        sectorText: '',
        svgText: 0,
      })
      expect(seen.lines).toBeGreaterThan(1)
      expect(seen.endsSpread, 'the figures end at one edge').toBeLessThanOrEqual(1)
      expect(seen.worstMiddleOff, 'a figure on its name’s line').toBeLessThanOrEqual(1)
      await block.screenshot(shot(info, `ring-legend-${by}-${width}.png`))
    }
    // The tokens' rows apart end where the legend's figures do.
    expect((measured.token_kind as { notes: number }).notes).toBe(2)
    await record(info, `ring legend ${width}`, measured)
  })

for (const width of [1440, 390])
  test(`at ${width} pixels a quota window's ring and its legend stand in its column, the figures on one edge`, async ({
    page,
  }, info) => {
    await serve(page, SPENT_WORLD)
    const panel = await openSection(page, width, 'quota_five_hour', '.quota-panel')
    await drawCharts(panel)
    const work = page
      .locator('.quota-account')
      .filter({ has: page.locator('.quota-account-name', { hasText: /^Work$/u }) })
      .locator('.quota-window[data-window="five_hour"] .window-spend')
    await work.getByRole('radio', { name: 'Projects' }).click()
    const chart = work.locator('.donut-chart')
    await expect(chart.locator('.donut-sector').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const seen = await legendLayout(chart)
    await record(info, `ring in a quota window ${width}`, seen)
    expect(seen).toMatchObject({
      ringInColumn: true,
      legendInColumn: true,
      allOneLine: true,
      sectorText: '',
    })
    expect(seen.endsSpread).toBeLessThanOrEqual(1)
    expect(seen.worstMiddleOff).toBeLessThanOrEqual(1)
    await work.screenshot(shot(info, `ring-quota-window-${width}.png`))
  })
