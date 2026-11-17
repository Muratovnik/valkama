/**
 * What a board of many labelled tiles costs to draw, in the built application,
 * read as counts rather than times: a count is the same on any machine, and a
 * time on a shared one is not.
 *
 * The tiles once measured their labels one by one, each with an observer of
 * its own and a copy of its chips drawn out of sight; the page was laid out
 * again between two tiles' readings, a hundred times for a hundred tiles. The
 * guards here hold the number of layouts to what a board without labels needs,
 * the nodes of a tile to what it draws, and a closed filter menu to nothing.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, openList } from './boardPage.ts'
import { brief, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { LIST_ROW_NODES, longRows, space } from './served/boardLoad.ts'
import { test } from './test.ts'

/**
 * No trace here: this file counts the page's own layouts, and tracing adds some
 * of its own. The trace's snapshot of the DOM reads every element's scroll
 * offsets, with nothing of the application on its stack, in whichever runs a
 * snapshot fell after the board was drawn.
 */
test.use({ trace: 'off' })

/**
 * The layouts of drawing the board, read from before the space's data arrives
 * until the board stands still. The shell's own layouts before that are left
 * out: they come to five to nine with or without labels, as the font's arrival
 * falls, and said nothing about what a label costs but moved the difference.
 */
async function layoutsToSettle(page: Page, labelled: boolean) {
  await installBackend(page)
  const gate: { open?: () => void } = {}
  const answered = new Promise<void>((resolve) => {
    gate.open = resolve
  })
  await serveSpace(page, space(labelled), [], { answered })
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Performance.enable')
  const layouts = async () => {
    const { metrics } = await devtools.send('Performance.getMetrics')
    return metrics.find((metric) => metric.name === 'LayoutCount')?.value ?? Number.NaN
  }
  const reading = page.waitForRequest('**/api/planning?*')
  const opening = openBoard(page, {})
  await reading
  await page.evaluate(() => document.fonts.ready)
  await stillFrames(page)
  const before = await layouts()
  gate.open?.()
  await opening
  await expect(page.locator('.work-item-tile')).not.toHaveCount(0)
  await stillFrames(page)
  return (await layouts()) - before
}

test('labels cost a board a few layouts, not one a tile', async ({ browser }) => {
  // Each board is loaded twice in a fresh page and the fewer layouts kept: a
  // stray frame can only add layouts, never take the board's own away.
  const fewest = async (labelled: boolean) => {
    const counts: number[] = []
    while (counts.length < 2) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      counts.push(await layoutsToSettle(page, labelled))
      await page.close()
    }
    return Math.min(...counts)
  }
  const labelled = await fewest(true)
  const plain = await fewest(false)
  // Measured once a tile, the labelled board was laid out about once a tile on
  // screen more than the plain one; fitting every line in one pass costs one.
  expect(labelled - plain).toBeLessThanOrEqual(3)
})

test('a tile draws what it shows and nothing to measure it by', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, space(true))
  await openBoard(page, {})
  const tile = page.locator('.work-item-tile').first()
  await expect(tile.locator('.tile-labels > [data-facet="labels"]')).toBeVisible()
  const drawn = await page.locator('.work-item-tile').evaluateAll((tiles) => ({
    nodes: tiles.map((sheet) => sheet.querySelectorAll('*').length + 1),
    cut: tiles.flatMap((sheet) =>
      [...sheet.querySelectorAll('.tile-labels > .label-chip')].filter((chip) => {
        const face = chip.firstElementChild
        return face !== null && face.scrollWidth > face.clientWidth
      }),
    ).length,
  }))
  // Two glyphs, the reference, the title, three labels and a count, the holder and
  // the steps, every glyph an svg of its strokes: 49 nodes for the fullest tile
  // here. A copy of the chips drawn out of sight to be measured was eight more a
  // tile, and a box around every glyph one more each. The one box left is the steps
  // glyph's line, which centres it on the letters of its count; a glyph with no word
  // beside it is its mark's own line and has none.
  expect(Math.max(...drawn.nodes)).toBeLessThanOrEqual(49)
  await expect(page.locator('[data-ghost], .facet-ghost')).toHaveCount(0)
  // Whole chips only: a chip counted as fitting is never shortened.
  expect(drawn.cut).toBe(0)
})

/**
 * The component instances under each element that matches, from the tree the
 * application is really running: a production build has no other way to say.
 */
const instancesUnder = (page: Page, selector: string) =>
  page.evaluate((match) => {
    interface Drawn {
      children?: unknown
      component?: { subTree: Drawn } | null
      el?: Element | null
      suspense?: { activeBranch: Drawn | null } | null
    }
    const counts = new Map<Element, number>()
    const inside = (node: Drawn) =>
      [
        node.component?.subTree,
        node.suspense?.activeBranch,
        ...(Array.isArray(node.children) ? (node.children as Drawn[]) : []),
      ].filter((child) => child && typeof child === 'object') as Drawn[]
    const walk = (node: Drawn, host: Element | null) => {
      const under = host ?? (node.el instanceof Element && node.el.matches(match) ? node.el : null)
      if (under) counts.set(under, (counts.get(under) ?? 0) + (node.component ? 1 : 0))
      for (const child of inside(node)) walk(child, under)
    }
    const root = document.querySelector('#app') as Element & { _vnode?: Drawn }
    if (root._vnode) walk(root._vnode, null)
    return [...counts.values()]
  }, selector)

test('a tile costs one component, whatever it prints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, space(true))
  await openBoard(page, {})
  await expect(page.locator('.tile-labels > [data-facet="labels"]').first()).toBeVisible()
  const tiles = await page.locator('.work-item-tile').count()
  const instances = await instancesUnder(page, '[data-reference] .work-item-tile')
  expect(instances).toHaveLength(tiles)
  // The tile itself. A component for each run, chip and glyph, and two more
  // under every glyph, came to about nine a tile.
  expect(Math.max(...instances)).toBeLessThanOrEqual(1)
})

test('a list row draws what it shows, with one component for its state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, space(true))
  await openList(page)
  const rows = page.locator('.work-item-list tbody tr')
  await expect(rows).toHaveCount(60)
  await expect(rows.first().locator('.label-chip').first()).toBeVisible()
  const nodes = await rows.evaluateAll((all) =>
    all.map((row) => row.querySelectorAll('*').length + 1),
  )
  const instances = await instancesUnder(page, '.work-item-list tbody tr')
  expect(instances).toHaveLength(60)
  // The state is the one component a row keeps. A component for each of a row's
  // seven runs, each chip and each glyph came to eleven a row.
  expect(Math.max(...instances)).toBeLessThanOrEqual(1)
  // Seven cells; two glyphs in their slots, each a box, an svg and its strokes,
  // eleven of them for a bug; the reference; the title; two chips and a count;
  // the state and three words. A box around each word and a word inside it was
  // ten more a row.
  expect(Math.max(...nodes)).toBeLessThanOrEqual(LIST_ROW_NODES)
})

// One row short of the length a list draws only its window from
// (production-list-window.spec.ts holds that one).
test('a list one row short of a window paints its first rows first, then all of them, and no column moves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  // Everything that makes a column wider lies in the last row, the longest
  // unchanged, far below the fold; a date of another year prints its year too.
  const updated_at = new Date().toISOString()
  const rows = longRows(updated_at)
  const gate: { open?: () => void } = {}
  const answered = new Promise<void>((resolve) => {
    gate.open = resolve
  })
  await serveSpace(page, rows, [], { answered })
  await page.addInitScript(() => {
    const frames: { cells: number[]; rows: number }[] = []
    Object.assign(globalThis, { listFrames: frames })
    const watch = () => {
      const row = document.querySelector<HTMLTableRowElement>('tbody tr')
      const count = document.querySelectorAll('tbody tr:not(.list-row-held)').length
      if (row && frames.at(-1)?.rows !== count)
        frames.push({
          cells: [...row.cells].map((cell) => cell.getBoundingClientRect().left),
          rows: count,
        })
      requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  const reading = page.waitForRequest('**/api/planning?*')
  const opening = openList(page)
  await reading
  await page.evaluate(() => document.fonts.ready)
  await stillFrames(page)
  gate.open?.()
  await opening
  const list = page.locator('.work-item-list tbody tr')
  await expect(list).toHaveCount(299)
  await stillFrames(page)
  const frames = await page.evaluate(
    () => (globalThis as unknown as { listFrames: { cells: number[]; rows: number }[] }).listFrames,
  )
  // Under what fills the list's height at first, and every row in the end.
  expect(frames[0]?.rows).toBeLessThan(60)
  expect(frames.at(-1)?.rows).toBe(299)
  // The widths the far rows need were there from the first frame.
  expect(frames.at(-1)?.cells).toEqual(frames[0]?.cells)
  await expect(page.locator('.list-row-held')).toHaveCount(0)
  // Every row in its place, one that gave its widths included.
  await list.last().scrollIntoViewIfNeeded()
  await expect(list.last()).toBeInViewport()
  await expect(list.last().locator('.list-open')).toHaveText('MAIN-99280')
})

test('a closed filter menu draws none of its options', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, space(true))
  await openBoard(page, {})
  const menu = page.locator('.filter-menu')
  // A space's labels made the closed menu a list of hundreds of rows, built
  // before the first tile could show.
  await expect(menu.locator('[role="option"]')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Filter work' }).click()
  // It opens on the facets; the labels are built when their step is taken.
  await expect(menu.locator('[role="option"]', { hasText: 'agent-packets' })).toHaveCount(0)
  await menu.getByRole('option', { name: 'Label', exact: true }).click()
  await expect(menu.locator('[role="option"]', { hasText: 'agent-packets' })).toBeVisible()
})

test('a press on a tile opens its card wherever it lands, marks included', async ({ page }) => {
  await installBackend(page)
  const blocker = brief(1012, stateOf(2))
  const worst = brief(1008, stateOf(1), { priority: 'urgent', kind: 'improvement' })
  await serveSpace(
    page,
    [worst, blocker],
    [{ from: blocker.work_item_id, to: worst.work_item_id, kind: 'blocks' }],
  )
  await openBoard(page, {})
  const sheet = page.locator('[data-reference="MAIN-1008"] .work-item-tile')
  await expect(sheet).toBeVisible()
  const onTheBoard = page.url()
  // A real pointer, which is what lands on whichever box lies on top. Opening a
  // card moves the address to it; the title is the control.
  for (const target of [
    '.tile-open',
    '[data-facet="priority"]',
    '[data-facet="kind"]',
    '[data-facet="readiness"]',
  ]) {
    await sheet.locator(target).first().click()
    await expect(page, target).not.toHaveURL(onTheBoard)
    await page.goBack()
    await expect(page).toHaveURL(onTheBoard)
  }
})

for (const width of [1440, 1024] as const)
  test(`the widest first line keeps its blocker whole at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    // Urgent, an improvement, a four-digit reference and a four-digit blocker.
    const blocker = brief(1012, stateOf(2), { reference: 'KIT-1012' })
    const worst = brief(1008, stateOf(1), {
      reference: 'KIT-1008',
      priority: 'urgent',
      kind: 'improvement',
    })
    await serveSpace(
      page,
      [worst, blocker],
      [{ from: blocker.work_item_id, to: worst.work_item_id, kind: 'blocks' }],
    )
    await openBoard(page, {})
    const sheet = page.locator('[data-reference="KIT-1008"] .work-item-tile')
    const mark = sheet.locator('[data-facet="readiness"]')
    await expect(mark).toBeVisible()
    const line = await mark.evaluate((element) => {
      const word = element.querySelector('.facet-word:not(.facet-word-hidden)')
      const box = element.getBoundingClientRect()
      const drawnWord = word?.getBoundingClientRect()
      return {
        sheet: element.closest('.work-item-tile')?.getBoundingClientRect().width ?? 0,
        word: word?.textContent,
        // Folded, the word wraps under the glyph onto a line that is clipped.
        whole: drawnWord !== undefined && drawnWord.width > 0 && drawnWord.top < box.bottom - 1,
      }
    })
    // The narrow desktop column this case folded in.
    expect(line.sheet).toBeLessThanOrEqual(width === 1440 ? 200 : 216)
    expect(line.word).toBe('KIT-1012')
    expect(line.whole).toBe(true)
  })
