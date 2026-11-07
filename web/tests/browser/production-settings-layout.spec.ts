import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installAlerts, READINESS_CASES } from './alertsFixtures.ts'
import { installBackend } from './backend.ts'
import { frames } from './frames.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * How Settings is drawn, measured rather than looked at: where a disclosure's chevron stands
 * against its words, which type a line takes beside its neighbours, and which edges and
 * heights the members of one column or one row share.
 */

const WIDTHS = [1280, 390] as const

async function openSettings(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
}

async function openDiagnostics(page: Page, width: number) {
  await installBackend(page)
  await openSettings(page, width)
  await page
    .getByRole('tablist', { name: 'Settings section' })
    .getByRole('tab', { name: 'Diagnostics' })
    .click()
  await expect(page.locator('.health-level').first()).toBeVisible()
}

/**
 * The words a disclosure's toggle shows and the mark drawn before them: every weight its text
 * is set in, whether the mark is an element at all — the browser's own `::marker` is not —
 * and how far its middle stands off the first line of the words and its end past their start.
 */
function readToggle(toggle: Locator) {
  return toggle.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const weights: number[] = []
    let line: DOMRect | undefined
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement) continue
      weights.push(Number(getComputedStyle(node.parentElement).fontWeight))
      const range = document.createRange()
      range.selectNodeContents(node)
      line ??= range.getClientRects()[0]
    }
    const mark = element.querySelector('svg')?.getBoundingClientRect()
    const middle = mark ? (mark.top + mark.bottom) / 2 : Number.NaN
    return {
      weights,
      marked: Boolean(mark && line),
      offLine: mark && line ? Math.max(0, line.top - middle, middle - line.bottom) : -1,
      past: mark && line ? Math.max(0, mark.right - line.left - 1) : -1,
    }
  })
}

// The diagnostics' disclosures were the browser's `<summary>`: «Passed checks» was a flex row
// inside one, which put the browser's triangle on a line of its own above the words, and its
// `<strong>` inside a 600 summary came out at 900.
for (const width of WIDTHS)
  test(`a diagnostics disclosure draws its chevron on its words' line at ${width}px`, async ({
    page,
  }) => {
    await openDiagnostics(page, width)
    const toggles = page.locator(
      '.installation-health [aria-expanded], .installation-health summary',
    )
    // «Passed checks» and the technical details of each finding.
    await expect(toggles).toHaveCount(3)
    const read: Awaited<ReturnType<typeof readToggle>>[] = []
    for (const toggle of await toggles.all()) read.push(await readToggle(toggle))
    const weights = read.flatMap((toggle) => toggle.weights)
    expect(weights.length).toBeGreaterThanOrEqual(read.length)
    expect(weights.filter((weight) => weight < 400 || weight > 700)).toEqual([])
    const each = (value: number | boolean) => read.map(() => value)
    expect(
      read.map(({ marked }) => marked),
      'a chevron drawn as an element',
    ).toEqual(each(true))
    expect(
      read.map(({ offLine }) => offLine),
      'off the first line',
    ).toEqual(each(0))
    expect(
      read.map(({ past }) => past),
      'past the start of the words',
    ).toEqual(each(0))
  })

test('the time of the check is set in the type of the counts beside it', async ({ page }) => {
  await openDiagnostics(page, 1280)
  const sizes = await page.evaluate(() =>
    ['.health-checked', '.health-countline', '.health-detail'].map(
      (selector) => getComputedStyle(document.querySelector(selector) as Element).fontSize,
    ),
  )
  expect(new Set(sizes).size, sizes.join(' / ')).toBe(1)
})

// A level's head, its findings and the passed checks' levels are one column: the findings
// stood 4px further in than the heads they belong to.
for (const width of WIDTHS)
  test(`the diagnostics levels start on one edge at ${width}px`, async ({ page }) => {
    await openDiagnostics(page, width)
    const passed = page.locator('.health-passed')
    await passed.locator('[aria-expanded], summary').first().click()
    await expect(passed.locator('.health-passed-title').first()).toBeVisible()
    const edges = await page.evaluate(() =>
      [
        '.health-section-head .section-heading',
        '.health-level-head .health-level-state',
        '.health-finding .health-finding-state',
        '.health-finding .health-detail',
        '.health-passed-title',
        '.health-passed [aria-expanded] svg',
      ].flatMap((selector) =>
        [...document.querySelectorAll(selector)].map((element) => ({
          what: selector,
          left: Math.round(element.getBoundingClientRect().left),
        })),
      ),
    )
    expect(edges.length).toBeGreaterThanOrEqual(8)
    const lefts = edges.map(({ left }) => left)
    expect(Math.max(...lefts) - Math.min(...lefts), JSON.stringify(edges)).toBeLessThanOrEqual(1)
  })

// Readiness says a state, often a sentence under it and a button after: three things, a stack.
// Its name stood centred against all three, half way down beside nothing it names.
const switchedOff = READINESS_CASES.find(({ name }) => name === 'switched-off')?.status

async function readReadiness(page: Page, width: number) {
  await installBackend(page)
  await installAlerts(page, { status: switchedOff })
  await openSettings(page, width)
  const row = page.locator('.settings-row').filter({ hasText: 'Readiness' })
  await expect(row.locator('.settings-alerts-detail')).toBeVisible()
  return row.evaluate((element) => {
    const label = element.querySelector('.settings-row-label')
    const state = element.querySelector('.settings-alerts-state .state-label')
    const control = element.querySelector('.settings-row-control')
    if (!label || !state || !control) throw new Error('Expected the whole Readiness row')
    const [labelLine, stateLine] = [label, state].map((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return range.getClientRects()[0]
    })
    const column = control.getBoundingClientRect()
    return {
      lines: Math.round(labelLine.bottom - stateLine.bottom),
      stack: column.height > 60,
      above: labelLine.bottom <= column.top,
      edges: Math.round(labelLine.left - column.left),
    }
  })
}

test('Readiness is named on the line of its state beside the stack at 1280px', async ({ page }) => {
  const read = await readReadiness(page, 1280)
  expect(read.stack).toBe(true)
  expect(Math.abs(read.lines)).toBeLessThanOrEqual(3)
})

test('Readiness is named above its state, on its edge, at 390px', async ({ page }) => {
  const read = await readReadiness(page, 390)
  expect(read.above).toBe(true)
  expect(Math.abs(read.edges)).toBeLessThanOrEqual(1)
})

// A colour's swatch and its reset share a row, and stood 40 and 28px high in it.
for (const width of WIDTHS)
  test(`a colour's swatch and its reset stand one height at ${width}px`, async ({ page }) => {
    await installBackend(page)
    await openSettings(page, width)
    const fields = page.locator('.kind-color-field')
    await expect(fields.first()).toBeVisible()
    const rows = await fields.evaluateAll((all) =>
      all.map((field) => {
        const swatch = field.querySelector('.kind-color-input')?.getBoundingClientRect()
        const reset = field.querySelector('button')?.getBoundingClientRect()
        if (!swatch || !reset) throw new Error('Expected a swatch and a reset')
        return {
          swatch: Math.round(swatch.height),
          reset: Math.round(reset.height),
          apart: Math.round(
            Math.abs(swatch.top + swatch.height / 2 - reset.top - reset.height / 2),
          ),
        }
      }),
    )
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows.filter(({ swatch, reset }) => swatch !== reset)).toEqual([])
    expect(rows.filter(({ apart }) => apart > 1)).toEqual([])
  })

// A narrow workspace stacks a passed check's words under its name and a technical value under
// its term. The stacking rule lost to the nested rule of two columns, so at a phone's width
// «Schema 5 is supported by this build» was set a few letters to a line beside its name.
test('the diagnostics rows stack their two cells at 390px', async ({ page }) => {
  await openDiagnostics(page, 390)
  await page.locator('.health-passed').getByRole('button').click()
  await page.locator('.health-technical').first().getByRole('button').click()
  await expect(page.locator('.health-passed-row').first()).toBeVisible()
  const rows = await page
    .locator('.health-passed-row, .installation-health .health-technical-row')
    .evaluateAll((all) =>
      all.map((row) => {
        const [first, second] = [...row.children].map((cell) => cell.getBoundingClientRect())
        return { row: row.className, apart: Math.round(Math.abs(second.left - first.left)) }
      }),
    )
  expect(rows.length).toBeGreaterThanOrEqual(3)
  expect(rows.filter(({ apart }) => apart > 1)).toEqual([])
})

/** Where an element's first letter is drawn, or, with `chevron`, its chevron's stroke. */
function startOf(target: Locator, chevron = false) {
  return target.evaluate((node, drawn) => {
    if (drawn) return node.querySelector('svg path')?.getBoundingClientRect().left ?? Number.NaN
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    while (text && !text.textContent?.trim()) text = walker.nextNode()
    if (!text) return Number.NaN
    const range = document.createRange()
    range.selectNodeContents(text)
    return range.getClientRects()[0]?.left ?? Number.NaN
  }, chevron)
}

/** The toggle's chevron on its column's first letter folded and open, its words staying put. */
async function expectFoldOnEdge(page: Page, toggle: Locator, column: Locator, what: string) {
  const edge = await startOf(column)
  const held = async (state: string) => {
    await expect(toggle).toHaveAttribute('aria-expanded', state)
    // A frame drawn first: Chromium answers a path's old box for the frame its `d` changed in.
    await frames(page.locator(':root'))
    const mark = await startOf(toggle, true)
    expect
      .soft(Math.abs(mark - edge), `${what}, expanded ${state}: ${mark} against ${edge}`)
      .toBeLessThanOrEqual(0.5)
    return startOf(toggle)
  }
  const folded = await held('false')
  await toggle.click()
  const open = await held('true')
  expect.soft(Math.abs(open - folded), `${what}: its words moved`).toBeLessThanOrEqual(0.5)
}

// A disclosure put its chevron's square on the column's edge, and the set draws a chevron 6px
// into that square folded and 4px open, so the mark stood off the edge the words start on.
for (const width of WIDTHS)
  test(`a diagnostics disclosure draws its chevron on its column's edge at ${width}px`, async ({
    page,
  }) => {
    await openDiagnostics(page, width)
    const heading = page.locator('.health-section-head .section-heading').first()
    const finding = page.locator('.health-finding').first()
    await expect(finding.locator('.health-detail')).toBeVisible()
    const cases = [
      {
        what: 'passed',
        toggle: page.locator('.health-passed').getByRole('button').first(),
        column: heading,
      },
      {
        what: 'technical',
        toggle: finding.locator('.health-technical').getByRole('button'),
        column: finding.locator('.health-detail'),
      },
    ]
    for (const { what, toggle, column } of cases) await expectFoldOnEdge(page, toggle, column, what)
  })
