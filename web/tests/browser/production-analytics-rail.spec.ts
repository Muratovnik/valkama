/**
 * The tiles of the Analytics page's rail in the real app, at the widths it is used at: beside the
 * panel at 1440 pixels, as the list of sections at 1024 and 390.
 *
 * A tile keeps its size and its place while its figures are read, when they arrive, when a new
 * period or measure changes them, and while the pointer passes over it: every tile's box is the
 * same to the pixel through all of it. What one change of the view asks is counted: a dimension
 * a read, asked again for a new period, never for a new measure or section. The tile of the tokens
 * by kind stands after the overview's and reads the page's own answer, so it asks nothing, and with
 * it the overview still fits the window, the rail scrolling on its own. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

/**
 * Where every tile of the rail stands, to the fraction of a pixel, on the page as if the rail
 * were not scrolled: pointing at a tile out of view scrolls the rail to it, which moves no tile.
 */
const tiles = (page: Page) =>
  page.evaluate(() => {
    const scrolled = document.querySelector('.analytics-page-rail')?.scrollTop ?? 0
    return [...document.querySelectorAll('.analytics-rail-entry')].map((entry) => {
      const { x, y, width, height } = entry.getBoundingClientRect()
      return { section: (entry as HTMLElement).dataset.section, x, y: y + scrolled, width, height }
    })
  })

/** The words every tile leads with, which say whether its figures have arrived. */
const leads = (page: Page) => page.locator('.analytics-rail .rail-tile-lead').allTextContents()

/** Holds every read of the usage until `release` is called, then answers it as `serve` does. */
async function holdReads(page: Page) {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/analytics/usage?*', async (route) => {
    await gate
    await route.fallback()
  })
  return () => release?.()
}

/** Every read of the usage the page asks, in order, by its query. */
function countReads(page: Page) {
  const asked: URLSearchParams[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/analytics/usage') asked.push(url.searchParams)
  })
  return asked
}

const settled = async (page: Page) => {
  await expect
    .poll(async () => {
      const words = await leads(page)
      return words.includes('Loading')
    })
    .toBe(false)
  await expect(page.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)
}

for (const width of [1440, 1024, 390])
  test(`at ${width}px a tile keeps its size and place as its figures are read, arrive, change and are pointed at`, async ({
    page,
  }, info) => {
    await serve(page)
    const release = await holdReads(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(pageAt())
    await expect(page.locator('.analytics-rail .rail-tile-lead').first()).toHaveText('Loading')
    await page.evaluate(() => document.fonts.ready)
    const reading = await tiles(page)

    release()
    await settled(page)
    const arrived = await tiles(page)
    expect(arrived, 'the figures arrived').toEqual(reading)
    const words = await leads(page)
    expect(words.filter((lead) => lead === 'Loading')).toEqual([])

    // A new period: the tiles say other figures in the same boxes.
    await page.getByRole('radio', { name: 'Past 4 weeks' }).click()
    await settled(page)
    expect(await tiles(page), 'a new period').toEqual(reading)

    // The pointer over each tile in turn moves none of them.
    for (const entry of await page.locator('.analytics-rail-entry').all()) {
      await entry.hover()
      expect(await tiles(page), 'pointed at').toEqual(reading)
    }
    await expectNoSilentClipping(page, `rail at ${width}px`, '.analytics-rail')
    await page.locator('.analytics-rail').screenshot(shot(info, `analytics-rail-${width}.png`))
    await record(info, `analytics rail ${width}`, { tiles: reading.length, words })
  })

test('a new measure changes what the tiles say, in the same boxes, and asks nothing', async ({
  page,
}) => {
  await serve(page)
  const asked = countReads(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  await settled(page)
  const before = { boxes: await tiles(page), words: await leads(page), reads: asked.length }
  await page.locator('.spending-tiles .segmented-option').nth(1).click()
  await expect(page.locator('.spending-days h3')).toContainText('Tokens')
  await expect.poll(() => leads(page)).not.toEqual(before.words)
  expect(await tiles(page)).toEqual(before.boxes)
  expect(asked, 'reads asked for a measure').toHaveLength(before.reads)
})

test('one change of the view asks a read a dimension, and none for a measure or a section', async ({
  page,
}, info) => {
  await serve(page)
  const asked = countReads(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  await settled(page)
  const groups = (from: number) => asked.slice(from).map((query) => query.get('group_by') ?? '')
  const opened = groups(0)

  let from = asked.length
  await page
    .getByRole('navigation', { name: 'Sections of the usage' })
    .getByRole('button', { name: 'Model', exact: true })
    .click()
  await expect(page.locator('.spending-bars h3')).toHaveText('Agent time by model')
  await settled(page)
  const section = groups(from)

  from = asked.length
  await page.getByRole('radio', { name: 'Past 4 weeks' }).click()
  await settled(page)
  const period = groups(from)

  await record(info, 'analytics rail reads', {
    opened: opened.length,
    section: section.length,
    period: period.length,
    opened_by: opened,
  })
  // Opening: the page's read of the week by task beside the same days before and by account, the
  // overview's outline of the week before, and a read for each of the nine dimensions of the rail.
  // A read two parts ask is asked once: the rail's tiles of tasks and accounts are the page's own
  // reads, and the overview's cards of models, roles and projects are the rail's tiles of them.
  expect(opened.toSorted()).toEqual(
    [
      'work_item',
      'work_item',
      'account',
      '',
      'project',
      'executor',
      'role',
      'launch_class',
      'model',
      'effort',
      'environment',
    ].toSorted(),
  )
  // Another section: the week before by model, and nothing for the rail; the week by model is the
  // rail's tile of models, and the accounts are the ones the view has.
  expect(section).toEqual(['model'])
  // Another period: the page's read beside the period before, and the rail's nine, its read by
  // account the page's own.
  expect(period).toHaveLength(10)
})

for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
] as const)
  test(`at ${width}×${height} the tile of the tokens by kind follows the overview's and the overview still fits`, async ({
    page,
  }, info) => {
    await serve(page)
    const asked = countReads(page)
    await page.setViewportSize({ width, height })
    await page.goto(pageAt())
    await settled(page)
    await page.evaluate(() => document.fonts.ready)
    // Under load the rail can still be drawing once the reads settle: wait for its first entries.
    const entries = page.locator('.analytics-rail-entry')
    await expect(entries.nth(0)).toHaveAttribute('data-section', 'overview')
    await expect(entries.nth(1)).toHaveAttribute('data-section', 'token_kind')
    const sections = await entries.evaluateAll((all) =>
      all.map((entry) => (entry as HTMLElement).dataset.section),
    )

    // The largest kind the tokens figure counts and its share; the double's input is half of it.
    const tile = page.locator('.analytics-rail-entry[data-section="token_kind"]')
    await expect(tile.locator('.rail-tile-lead')).toHaveText('Input')
    await expect(tile.locator('.rail-tile-aside')).toHaveText('50%')
    await expect(tile.locator('.analytics-rail-count')).toHaveText('3 kinds')
    await expect(tile.locator('[role="img"]')).toHaveAttribute(
      'aria-label',
      'Shares of Tokens: Input 50%, Output 30%, Cache write, 5 min 20%',
    )

    const fit = await page.evaluate(() => {
      const rail = document.querySelector('.analytics-page-rail')
      return {
        document: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        rail: rail ? rail.scrollHeight - rail.clientHeight : -1,
        railScrolls: rail ? getComputedStyle(rail).overflowY : '',
      }
    })
    await record(info, `analytics rail kinds ${width}x${height}`, { sections, fit })
    expect(fit.document, 'the document scrolls').toBe(0)
    expect(fit.railScrolls).toBe('auto')

    // The section reads the page's own answer: choosing it asks nothing.
    const before = asked.length
    await tile.click()
    await expect(page.locator('.kinds-panel')).toBeVisible()
    await settled(page)
    expect(asked, 'reads asked for the tokens by kind').toHaveLength(before)
  })
