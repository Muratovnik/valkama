/**
 * The panel of a dimension in the real app, measured. Beside the rail its parts stand whole, one
 * under the next, and the table takes the height the charts leave: a wheel over it scrolls the
 * table alone, the document and the panel standing still, and at the end of its scroll its
 * heading row, its names and its total row are still in view. On a phone the names stay in view
 * while the table scrolls sideways. A second dimension chosen over the table crosses it, is the
 * address and outlives a reload, and the file downloaded is the table crossed; with the measure
 * tokens, the table and the file split the tokens by kind. Each run prints what it measured.
 */
import { readFile } from 'node:fs/promises'

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** Whether each part of the charts and of the table stands whole, above the next one. */
async function parts(page: Page) {
  return page.evaluate(() => {
    const spilled: string[] = []
    for (const area of ['.dimension-charts', '.dimension-panel', '.spending-table']) {
      const children = [...(document.querySelector(area)?.children ?? [])] as HTMLElement[]
      for (const [index, child] of children.entries()) {
        const name = `${area} > ${child.className || child.tagName}`
        // A scroller is meant to hold more than it shows; anything else shows all it holds.
        const scrolls = ['auto', 'scroll'].includes(getComputedStyle(child).overflowY)
        if (!scrolls && child.scrollHeight > child.clientHeight + 1) spilled.push(`${name} spills`)
        const next = children[index + 1]
        if (next && child.getBoundingClientRect().bottom > next.getBoundingClientRect().top + 0.5)
          spilled.push(`${name} lies on the next part`)
      }
    }
    return spilled
  })
}

/** Puts the pointer over an element, `down` pixels below its top or at its middle. */
async function pointAt(page: Page, selector: string, down?: number) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not on screen`)
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, down ?? box.height))
}

/** How far the document, the panel, the charts and the table's frame are scrolled. */
async function scrolled(page: Page) {
  return page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)?.scrollTop ?? -1
    const frame = document.querySelector('.spending-table-frame')
    const charts = document.querySelector('.dimension-charts')
    return {
      document: document.scrollingElement?.scrollTop ?? 0,
      panel: top('.analytics-panel'),
      charts: top('.dimension-charts'),
      // How far the charts could scroll sideways: never, whatever a chart reaches past.
      chartsWide: charts ? charts.scrollWidth - charts.clientWidth : -1,
      table: frame?.scrollTop ?? 0,
      tableEnd: frame ? frame.scrollHeight - frame.clientHeight : 0,
      tableLeft: frame?.scrollLeft ?? 0,
    }
  })
}

/**
 * Where the frame stands, and whether each of its fixed parts is in it and drawn on top: the
 * heading row, the total row and the name of the row the test names.
 */
async function fixedParts(page: Page, row: 'first' | 'last') {
  return page.evaluate((which) => {
    const frame = document.querySelector('.spending-table-frame')
    if (!frame) throw new Error('the table drew no frame')
    const rows = [...frame.querySelectorAll('tbody tr')]
    const named = (which === 'first' ? rows[0] : rows.at(-1))?.querySelector('th')
    const box = frame.getBoundingClientRect()
    const seen = (cell: Element | null | undefined) => {
      if (!cell) return { inside: false, onTop: false }
      const { left, right, top, bottom } = cell.getBoundingClientRect()
      const inside =
        left >= box.left - 0.5 &&
        right <= box.right + 0.5 &&
        top >= box.top - 0.5 &&
        bottom <= box.bottom + 0.5
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
      return { inside, onTop: hit !== null && cell.contains(hit) }
    }
    return {
      head: seen(frame.querySelector('thead th')),
      name: seen(named),
      total: seen(frame.querySelector('tfoot th')),
    }
  }, row)
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const)
  test(`at ${width}×${height} the table scrolls alone and keeps its heading, names and total in view`, async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width, height })
    await page.goto(pageAt())
    const frame = page.locator('.spending-table-frame')
    await expect(frame.locator('tbody tr').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    expect(await parts(page), 'parts that spill or overlap').toEqual([])
    const before = await scrolled(page)
    expect(before.tableEnd, 'a table taller than its frame').toBeGreaterThan(0)
    expect(before.chartsWide, 'charts that scroll sideways').toBe(0)

    await pointAt(page, '.spending-table-frame')
    await page.mouse.wheel(0, 20_000)
    await expect
      .poll(async () => {
        const now = await scrolled(page)
        return now.tableEnd - now.table
      })
      .toBeLessThanOrEqual(1)
    const after = await scrolled(page)
    const fixed = await fixedParts(page, 'last')
    await record(info, `analytics panel table ${width}x${height}`, { before, after, fixed })
    expect(after.document).toBe(0)
    expect(after.panel).toBe(0)
    expect(after.charts).toBe(before.charts)
    expect(fixed).toEqual({
      head: { inside: true, onTop: true },
      name: { inside: true, onTop: true },
      total: { inside: true, onTop: true },
    })
  })

test('on a phone the names stay in view while the table scrolls sideways', async ({
  page,
}, info) => {
  await serve(page)
  const analytics = await openReport(page, 390)
  const frame = analytics.locator('.spending-table-frame')
  await frame.scrollIntoViewIfNeeded()
  await pointAt(page, '.spending-table-frame', 40)
  await page.mouse.wheel(2000, 0)
  await expect
    .poll(async () => {
      const now = await scrolled(page)
      return now.tableLeft
    })
    .toBeGreaterThan(0)
  const fixed = await fixedParts(page, 'first')
  const now = await scrolled(page)
  await record(info, 'analytics panel table sideways 390', { left: now.tableLeft, fixed })
  expect(fixed.name).toEqual({ inside: true, onTop: true })
})

/** The text of the CSV file the table's button downloads, and its name. */
async function download(page: Page) {
  const offered = page.waitForEvent('download')
  await page.locator('.spending-download').click()
  const file = await offered
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') }
}

test('a second dimension crosses the table, is the address, outlives a reload and downloads', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  const table = page.locator('.spending-table')
  await expect(table.locator('tbody tr').first()).toBeVisible()

  await table.locator('.spending-table-across .choice-trigger').click()
  await page.getByRole('option', { name: 'Model' }).click()
  await expect(table.locator('h2')).toHaveText('Agent time by task and by model')
  await expect
    .poll(() => page.url().slice(new URL(page.url()).origin.length))
    .toBe(pageAt({ across: 'model' }))
  await page.reload()
  await expect(table.locator('h2')).toHaveText('Agent time by task and by model')
  const headings = await table.locator('thead th').allInnerTexts()
  await record(info, 'analytics panel crossed', { url: page.url(), headings })
  // Work on no task and work nobody can place ran under no known model: a column apart.
  expect(headings.map((one) => one.trim())).toEqual([
    'Task',
    'model-a',
    'model-b',
    'Unknown',
    'Total',
  ])
  expect(await parts(page), 'parts that spill or overlap').toEqual([])

  const file = await download(page)
  expect(file.name).toBe('agent-usage-2026-11-09-to-2026-11-11-by-work_item-and-model.csv')
  const [header, first] = file.text.split('\r\n')
  expect(header).toBe(
    '\u{FEFF}breakdown,across,measure,value_id,value_reference,value_name,value_kind,model-a,model-b,Unknown,total,period_from,period_to,filters',
  )
  expect(first?.startsWith('work_item,model,time_seconds,')).toBe(true)
})

test('with the measure tokens the table and its file split the tokens by kind', async ({
  page,
}) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt({ measure: 'tokens' }))
  const table = page.locator('.spending-table')
  await expect(table.locator('tbody tr').first()).toBeVisible()
  const texts = await table.locator('thead th').allInnerTexts()
  const headings = texts.map((one) => one.trim())
  expect(headings.slice(-6)).toEqual([
    'Input',
    'Cache read',
    'Cache write, 5 min',
    'Cache write, 1 h',
    'Output',
    'Of it reasoning',
  ])
  const file = await download(page)
  const [header] = file.text.split('\r\n')
  expect(
    header?.endsWith(
      ',filters,input_tokens,cached_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,output_tokens,reasoning_tokens',
    ),
  ).toBe(true)
})
