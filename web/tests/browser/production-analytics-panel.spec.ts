/**
 * The panel of a dimension in the real app, measured. Beside the rail its parts stand whole, one
 * under the next, and a table shorter than the window stands at its own height, its frame no
 * taller: a wheel over it scrolls the panel or the table, the document standing still, and at the
 * end of both scrolls its heading row, its names and its total row are still in view. On a phone the names stay in view
 * while the table scrolls sideways. A second dimension chosen in the section's heading splits the
 * table into pairs, is the address and outlives a reload, and the file downloaded is a row per
 * pair; with the measure
 * tokens, the table and the file split the tokens by kind. At 1440 pixels the ranked list and the
 * small charts beside it are titled in one line each, and so is the line over the table that
 * counts its rows, in Russian as in English; on a phone no name in a chart's table breaks inside a
 * word. The section of the tokens by kind is such a panel too: its counted kinds add up to the
 * summary's «Tokens» figure and are the sectors of its ring, the cache reads stand apart from
 * them, and its address gives it back. Each run prints what it measured.
 */
import { readFile } from 'node:fs/promises'

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, pageAt, record, serve, TASK_REPORT } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { brokenWords } from './brokenWords.ts'
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

/** How far the document, the panel and the table's frame are scrolled, and could be. */
async function scrolled(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.analytics-panel')
    const frame = document.querySelector('.spending-table-frame')
    const charts = document.querySelector('.dimension-charts')
    return {
      document: document.scrollingElement?.scrollTop ?? 0,
      panel: panel?.scrollTop ?? -1,
      panelEnd: panel ? panel.scrollHeight - panel.clientHeight : 0,
      // How far the charts could scroll sideways: never, whatever a chart reaches past.
      chartsWide: charts ? charts.scrollWidth - charts.clientWidth : -1,
      // How far the table's frame could scroll up and down, and how much taller it is than its table.
      tableEnd: frame ? frame.scrollHeight - frame.clientHeight : -1,
      frameRoom: frame
        ? frame.clientHeight - (frame.querySelector('table')?.offsetHeight ?? 0)
        : -1,
      tableLeft: frame?.scrollLeft ?? 0,
    }
  })
}

/**
 * Whether each of the table's fixed parts is in the part of its frame the panel shows, and drawn
 * on top: the heading row, the total row and the name of the row the test names.
 */
async function fixedParts(page: Page, row: 'first' | 'last') {
  return page.evaluate((which) => {
    const frame = document.querySelector('.spending-table-frame')
    if (!frame) throw new Error('the table drew no frame')
    const rows = [...frame.querySelectorAll('tbody tr')]
    const named = (which === 'first' ? rows[0] : rows.at(-1))?.querySelector('th')
    const own = frame.getBoundingClientRect()
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const shown = panel?.getBoundingClientRect()
    const box = {
      left: own.left,
      right: own.right,
      top: Math.max(own.top, shown?.top ?? own.top),
      bottom: Math.min(own.bottom, shown && panel ? shown.top + panel.clientHeight : own.bottom),
    }
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

// Beside the rail: a wide window, and the narrowest common one where the panel still keeps its
// 640 pixels beside the rail. At 1024 the section takes the list's place instead, and is not held.
for (const [width, height] of [
  [1440, 900],
  [1280, 768],
] as const)
  test(`at ${width}×${height} the table stands at its own height and keeps its heading, names and total in view`, async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width, height })
    await page.goto(TASK_REPORT)
    const frame = page.locator('.spending-table-frame')
    await expect(frame.locator('tbody tr').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    expect(await parts(page), 'parts that spill or overlap').toEqual([])
    const before = await scrolled(page)
    // Fourteen rows are shorter than the window: the frame is as tall as its table, no taller.
    expect(before.tableEnd, 'a short table that scrolls up and down on its own').toBe(0)
    expect(before.frameRoom, 'room in the frame past its table').toBe(0)
    expect(before.panelEnd, 'a panel taller than its window').toBeGreaterThan(0)
    expect(before.chartsWide, 'charts that scroll sideways').toBe(0)

    await frame.evaluate((one) => {
      one.scrollIntoView({ block: 'start' })
    })
    await pointAt(page, '.spending-table-frame', 100)
    await page.mouse.wheel(0, 20_000)
    await expect
      .poll(async () => {
        const now = await scrolled(page)
        return now.panelEnd - now.panel
      })
      .toBeLessThanOrEqual(1)
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    const after = await scrolled(page)
    const fixed = await fixedParts(page, 'last')
    await record(info, `analytics panel table ${width}x${height}`, { before, after, fixed })
    expect(after.document).toBe(0)
    expect(fixed).toEqual({
      head: { inside: true, onTop: true },
      name: { inside: true, onTop: true },
      total: { inside: true, onTop: true },
    })
  })

test('at 1440 pixels the ranked list and the small charts beside it are titled in one line each', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(TASK_REPORT)
  await expect(page.locator('.spending-multiples h3')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  const headings = await page.evaluate(() =>
    ['.spending-bars', '.spending-multiples'].map((part) => {
      const heading = document.querySelector(`${part} h3`)
      if (!heading) throw new Error(`${part} has no heading`)
      const { height } = heading.getBoundingClientRect()
      const line = Number.parseFloat(getComputedStyle(heading).lineHeight)
      return {
        part,
        text: heading.textContent.trim(),
        lines: Math.round(height / line),
        header: Math.round(heading.parentElement?.getBoundingClientRect().height ?? 0),
      }
    }),
  )
  await record(info, 'analytics panel headings 1440x900', headings)
  expect(headings.map(({ lines }) => lines)).toEqual([1, 1])
  // Side by side, the two charts start at one height.
  expect(headings[0]?.header).toBe(headings[1]?.header)
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

/** Each heading of the table: its words, whether it is marked sorted, its ink and its rule. */
const sortMarks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spending-table-frame thead th')].map((one) => {
      const style = getComputedStyle(one)
      return {
        text: one.textContent.trim(),
        sorted: one.hasAttribute('aria-sort'),
        arrow: one.querySelector('.table-sort-icon') !== null,
        ink: style.color,
        rule: style.boxShadow,
      }
    }),
  )

test('the column the table is sorted by is marked on its heading, and the mark follows a sort', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(TASK_REPORT)
  await expect(page.locator('.spending-table-frame tbody tr').first()).toBeVisible()
  const first = await sortMarks(page)
  const body = await page
    .locator('.spending-table-frame tbody td[data-chosen="true"]')
    .first()
    .evaluate((one) => getComputedStyle(one).color)
  await record(info, 'analytics table sort marks', { first, body })
  const sorted = first.filter((one) => one.sorted)
  expect(sorted.map((one) => one.text)).toEqual(['Agent time'])
  const [mark] = sorted
  const tokens = first.find((one) => one.text === 'Tokens')
  expect(mark?.arrow).toBe(true)
  expect(mark?.ink, 'the sorted heading in the ink of the figures').toBe(body)
  expect(mark?.ink).not.toBe(tokens?.ink)
  expect(mark?.rule).not.toBe(tokens?.rule)

  await page.locator('.spending-table-frame thead').getByRole('button', { name: 'Tokens' }).click()
  const next = await sortMarks(page)
  expect(next.filter((one) => one.sorted).map((one) => one.text)).toEqual(['Tokens'])
  expect(next.find((one) => one.text === 'Tokens')?.rule).toBe(mark?.rule)
})

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('at 1440 pixels the small charts’ title and the table’s count each keep to one line', async ({
    page,
  }, info) => {
    await serve(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(TASK_REPORT)
    await expect(page.locator('.spending-table-summary')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const seen = await page.evaluate(() => {
      // This body runs in the page, so a helper at the module's own scope would not be there.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const fit = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) throw new Error(`${selector} is missing`)
        return {
          text: element.textContent.trim(),
          height: Math.round(element.getBoundingClientRect().height),
          cut: element.scrollWidth > element.clientWidth,
        }
      }
      return {
        bars: fit('.spending-bars h3'),
        multiples: fit('.spending-multiples h3'),
        count: fit('.spending-table-summary'),
      }
    })
    await record(info, 'analytics panel one line ru 1440x900', seen)
    expect(seen.multiples.text).toBe('По дням, по задачам')
    expect(seen.multiples.cut).toBe(false)
    expect(seen.multiples.height).toBe(seen.bars.height)
    // Twelve tasks spent this week, and none only in the week before.
    expect(seen.count.text).toBe('12 задач')
    expect(seen.count.cut).toBe(false)
  })

  test('on a phone no name or heading in a chart’s table breaks inside a word', async ({
    page,
  }, info) => {
    await serve(page)
    const analytics = await openReport(page, 390)
    await expect(analytics.locator('.spending-days table')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const broken = await brokenWords(page, '.analytics-panel .chart-cell')
    const days = await analytics.locator('.spending-days tbody th').allInnerTexts()
    await record(info, 'analytics panel words 390 ru', { broken, days })
    expect(days.some((day) => day.startsWith('понедельник'))).toBe(true)
    expect(broken).toEqual([])
  })
})

/** The text of the CSV file the table's button downloads, and its name. */
async function download(page: Page) {
  const offered = page.waitForEvent('download')
  await page.locator('.spending-download').click()
  const file = await offered
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8') }
}

test('a split chosen in the section heading makes the table pairs, is the address, outlives a reload and downloads', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(TASK_REPORT)
  const table = page.locator('.spending-table')
  await expect(table.locator('tbody tr').first()).toBeVisible()

  await page.locator('.dimension-section .dimension-split .choice-trigger').click()
  await page.getByRole('option', { name: 'Model' }).click()
  await expect(table.locator('h3')).toHaveText('Spending by task and by model')
  await expect
    .poll(() => page.url().slice(new URL(page.url()).origin.length))
    .toBe(pageAt({ by: 'work_item', across: 'model' }))
  await page.reload()
  await expect(table.locator('h3')).toHaveText('Spending by task and by model')
  const names = await table.locator('tbody th').allInnerTexts()
  await record(info, 'analytics panel split', { url: page.url(), names })
  // Every row is a pair, the task first and the model after it.
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) expect(name).toContain(' · ')
  expect(await parts(page), 'parts that spill or overlap').toEqual([])

  const file = await download(page)
  expect(file.name).toBe('agent-usage-2026-11-09-to-2026-11-11-by-work_item-and-model.csv')
  const [header, first] = file.text.split('\r\n')
  expect(
    header?.startsWith(
      '\u{FEFF}breakdown,value_id,value_reference,value_name,value_kind,split,split_id,split_reference,split_name,split_kind,time_seconds,',
    ),
  ).toBe(true)
  expect(first?.startsWith('work_item,')).toBe(true)
  expect(first).toContain(',model,')
})

test('with the measure tokens the table and its file split the tokens by kind', async ({
  page,
}) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt({ by: 'work_item', measure: 'tokens' }))
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

/**
 * The week's tokens by kind as the double splits them (`split` in the fixture): every stretch of
 * the week is a whole number of ten thousand tokens, half input, three tenths output, the rest
 * written to the cache for five minutes, and ten times as many read from it.
 */
const WEEK_TOKENS = [
  ...Array.from({ length: 12 }, (_, index) => (13 - index) * 1_250_000),
  900_000,
  10_000,
]
const WEEK_KINDS = {
  input: WEEK_TOKENS.reduce((sum, tokens) => sum + Math.round(tokens / 2), 0),
  output: WEEK_TOKENS.reduce((sum, tokens) => sum + Math.round((tokens * 3) / 10), 0),
  cacheWrite: WEEK_TOKENS.reduce(
    (sum, tokens) => sum + tokens - Math.round(tokens / 2) - Math.round((tokens * 3) / 10),
    0,
  ),
  cacheRead: WEEK_TOKENS.reduce((sum, tokens) => sum + tokens * 10, 0),
  reasoning: WEEK_TOKENS.reduce(
    (sum, tokens) => sum + Math.floor(Math.round((tokens * 3) / 10) / 3),
    0,
  ),
}
const compact = (count: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(count)

test('the tokens by kind are a panel whose counted kinds add up to the «Tokens» figure', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  const figure = page.locator('.tile-figure[data-measure="tokens"]')
  await expect(figure).toBeVisible()
  const tokens = await figure.evaluate((element) => element.textContent.trim())

  await page
    .getByRole('navigation', { name: 'Sections of the usage' })
    .getByRole('button', { name: 'Token kinds', exact: true })
    .click()
  await expect
    .poll(() => page.url().slice(new URL(page.url()).origin.length))
    .toBe(pageAt({ by: 'token_kind' }))
  const panel = page.locator('.kinds-panel')
  const table = panel.locator('.kinds-table')
  await expect(table.locator('tbody tr').first()).toBeVisible()

  const rows = await table
    .locator('tbody tr')
    .evaluateAll((all) =>
      all.map((row) => [...row.children].slice(0, 2).map((cell) => cell.textContent.trim())),
    )
  await record(info, 'analytics token kinds', { tokens, rows })
  // The counted kinds are exactly the double's, and they add up to the figure of the summary.
  const { input, output, cacheWrite, cacheRead, reasoning } = WEEK_KINDS
  expect(input + output + cacheWrite).toBe(WEEK_TOKENS.reduce((sum, one) => sum + one, 0))
  expect(rows).toEqual([
    ['Input', compact(input)],
    ['Output', compact(output)],
    ['Cache write, 5 min', compact(cacheWrite)],
    ['Total', compact(input + output + cacheWrite)],
    ['Cache read', compact(cacheRead)],
    ['Reasoning', compact(reasoning)],
  ])
  expect(rows[3]?.[1]).toBe(tokens)
  await expect(panel.locator('.kinds-figure-value')).toHaveText(tokens)
  // The two kinds apart are named briefly; why they stand apart is the section's caveat, which
  // the «ⓘ» of its heading says, and no line beside the figure says again.
  await expect(panel).not.toContainText(/cache reads stand apart/u)
  await panel.locator('.level-about-press').click()
  const about = page.locator('.info-tip-panel')
  await expect(about).toContainText(/cache reads stand apart/u)
  await expect(about).toContainText(/reasoning is part of output/u)
  await panel.locator('.level-about-press').click()

  // A ring of the counted kinds, named by its legend; beside it, no part of it, the two the
  // figure leaves out.
  const ring = panel.locator('.kinds-bars .donut-chart')
  await expect(ring.locator('.chart-key-name')).toHaveText([
    'Input',
    'Output',
    'Cache write, 5 min',
  ])
  await expect(ring.locator('.donut-sector')).toHaveCount(3)
  await expect(ring.locator('.donut-note-name')).toHaveText(['Cache read', 'Reasoning'])
  // A small chart of each counted kind on one scale, the cache reads apart by their figure.
  await expect(panel.locator('.kinds-multiples h3')).toHaveText('Per day, by kind')
  expect(await parts(page), 'parts that spill or overlap').toEqual([])

  // The address gives the section back.
  await page.reload()
  await expect(table.locator('tbody tr').first()).toBeVisible()
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveAttribute(
    'data-section',
    'token_kind',
  )
  await page.locator('.analytics-panel').screenshot(shot(info, 'analytics-kinds-1440.png'))
})
