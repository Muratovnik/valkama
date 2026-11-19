/**
 * Code in a task's title, written between backticks, is drawn as code on the Analytics page as on
 * every surface that draws a title (DESIGN.md, «Code in a title»): in the monospace face, without
 * the backticks, in a ranked list's names, the days chart's legend and a day's hint, the table,
 * the rail's tile, the overview's changes, the side panel's heading and a filter's chip. What is
 * text rather than drawing keeps the title as written: a dialog's name, a chip's button, the hint's
 * copy for a screen reader.
 *
 * Code changes no box. A name of a list, clamped to two lines, stays inside its row and breaks only
 * at a space or after a `/`, inside code as outside it, and a word of code wider than its line
 * breaks inside and stays in its box; a one-line name still ends in an ellipsis inside its own box;
 * a day's hint stays in the window with its code inside it. Each is measured from where the
 * characters are drawn, at 1440 and at 1024 pixels, where the page shows its panel alone.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { openPanel, openReport, pageAt, record, serve } from './analyticsPage.ts'
import { dayParts, middleOf, openDays, settledHint } from './dayHintPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'
import { breaksOf, overflowOf } from './titleBreaks.ts'

/** Made-up titles: two with code in them, one with a word of code wider than any line, one plain. */
const TITLES = [
  'Raise `STORE_SCHEMA_VERSION` and move `web/src/pages/analytics/composables/use-spending-words.ts` past the review',
  'Run `npm run test:browser:allowed` before `git push` on the release branch of the desktop app',
  `Bump \`${'SCHEMA_VERSION_OF_THE_STORE_'.repeat(4)}END\` once`,
  'Rework the import of long planning documents into the board',
] as const

/** The code each title holds, as it is drawn: without its backticks. */
const CODES = [
  ['STORE_SCHEMA_VERSION', 'web/src/pages/analytics/composables/use-spending-words.ts'],
  ['npm run test:browser:allowed', 'git push'],
  [`${'SCHEMA_VERSION_OF_THE_STORE_'.repeat(4)}END`],
  [],
]

/** The title whose one word of code is wider than any line it is given. */
const WIDE = 2

const TASKS = TITLES.map((title, index) => task(index + 1, title))
const named = (index: number) => `MAIN-${index + 1} ${TITLES[index] ?? ''}`
const on = (day: number) => new Date(2026, 10, day, 10)

/**
 * This week the four tasks over three days, the first the largest, each under one of two models;
 * the week before the first small and the last large, so the overview names both as moved.
 */
const WORLD: TimedStretch[] = [
  ...TASKS.flatMap((work, index) =>
    [9, 10, 11].map((day) => ({
      at: on(day),
      group: { work_item: work, model: { id: `model-${index % 2}`, unknown: false }, ...WORK },
      spend: { seconds: (8 - 2 * index) * 3600, tokens: (8 - 2 * index) * 1e5, cost: 8 - index },
    })),
  ),
  { at: on(2), group: { work_item: TASKS[0], ...WORK }, spend: { seconds: 600, cost: 1 } },
  { at: on(3), group: { work_item: TASKS[3], ...WORK }, spend: { seconds: 90_000, cost: 40 } },
]

/** A list's monospace face, quotes and spacing aside. */
const face = (family: string) =>
  family
    .replaceAll(/["']/gu, '')
    .replaceAll(/\s*,\s*/gu, ',')
    .trim()

/** Each drawn title under `where` (`data-text-runs`): its words, its code and the code's face. */
const titlesIn = (where: Locator) =>
  where.evaluate((root) => ({
    mono: getComputedStyle(document.documentElement).getPropertyValue('--font-family-mono'),
    titles: Array.from(root.querySelectorAll('[data-text-runs]'), (host) => ({
      text: host.textContent,
      codes: Array.from(host.querySelectorAll('code'), (code) => ({
        text: code.textContent,
        face: getComputedStyle(code).fontFamily,
      })),
    })),
  }))

/** The titles under `where` drawn with code, each code as its fixture holds it, in the mono face. */
async function expectCodeDrawn(where: Locator, at: string) {
  const { mono, titles } = await titlesIn(where)
  const coded = titles.filter((title) => title.codes.length)
  expect(coded.length, `titles drawn with code in ${at}`).toBeGreaterThan(0)
  for (const title of coded) {
    expect(title.text, at).not.toContain('`')
    const index = CODES.findIndex(
      (codes) => JSON.stringify(codes) === JSON.stringify(title.codes.map((code) => code.text)),
    )
    expect(index, `the code of «${title.text ?? ''}» in ${at}`).toBeGreaterThanOrEqual(0)
    for (const code of title.codes) expect(face(code.face), at).toBe(face(mono))
  }
  return coded
}

/**
 * A one-line name, the box a drawn title is laid in: whether its words are cut, whether it ends
 * them in an ellipsis on one line with its overflow hidden, and how far it stands past the box it
 * is laid in (`within`).
 */
/**
 * The filter's chips where they stand: on the bar where it has room for them, and where it has not
 * in the list the count opens, once the side panel over the bar is closed.
 */
async function filterChips(page: Page) {
  const folded = page.locator('.analytics-filter-folded')
  if (!(await folded.isVisible())) return page.locator('.analytics-bar-chips [data-filter-chip]')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await folded.click()
  return page.locator('.analytics-filter-body [data-filter-chip]')
}

const oneLine = (name: Locator, within: string) =>
  name.evaluate((element, container) => {
    let line: Element = element
    while (line.parentElement && getComputedStyle(line).display === 'inline')
      line = line.parentElement
    const style = getComputedStyle(line)
    const box = line.getBoundingClientRect()
    const room = line.closest(container)?.getBoundingClientRect() ?? box
    return {
      cut: line.scrollWidth > line.clientWidth + 0.5,
      ellipsis:
        style.textOverflow === 'ellipsis' &&
        style.whiteSpace === 'nowrap' &&
        style.overflowX === 'hidden',
      past: Math.max(box.right - room.right, room.left - box.left),
    }
  }, within)

/**
 * The character before each place a piece of code in `host` goes on to a new line, read from
 * where each of its characters is drawn.
 */
const codeBreaks = (host: Locator) =>
  host.evaluate((element) => {
    const range = document.createRange()
    return Array.from(element.querySelectorAll('code'), (code) => {
      const drawn: { character: string; top: number }[] = []
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node
        Array.from(at.textContent ?? '', (character, offset) => {
          range.setStart(at, offset)
          range.setEnd(at, offset + 1)
          const box = range.getClientRects()[0]
          if (box && box.width > 0) drawn.push({ character, top: box.top })
          return character
        })
      }
      return drawn.flatMap(({ top }, at) =>
        at > 0 && top > (drawn[at - 1]?.top ?? top) + 2 ? [drawn[at - 1]?.character ?? ''] : [],
      )
    }).flat()
  })

/** How many lines the block a drawn title is laid in takes, by its height and its line height. */
const linesOf = (host: Locator) =>
  host.evaluate((element) => {
    let block: Element = element
    while (block.parentElement && getComputedStyle(block).display.startsWith('inline'))
      block = block.parentElement
    return (
      block.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(block).lineHeight)
    )
  })

/** The words a page's region shows, as a reader sees them: hidden copies left out. */
const shownText = (where: Locator) =>
  where.evaluate((element) =>
    element instanceof HTMLElement
      ? // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- the words shown: `textContent` holds the hidden copies too
        element.innerText
      : '',
  )

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

for (const width of [1440, 1024]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
    })

    test('a list of tasks draws code as code, and each name stays in its row on two lines at most', async ({
      page,
    }, info) => {
      await serve(page, WORLD)
      const analytics = await openReport(page, width)
      const bars = analytics.locator('.spending-bars')
      await drawLined(bars)
      const rows = bars.locator('[data-kind="category"]')
      await expect(rows).toHaveCount(TASKS.length)
      const coded = await expectCodeDrawn(bars, 'the list')
      expect(coded.map((title) => title.codes.map((code) => code.text))).toEqual(CODES.slice(0, 3))
      expect(await shownText(bars)).not.toContain('`')

      const measured = []
      for (let index = 0; index < TASKS.length; index += 1) {
        const row = rows.nth(index)
        const name = row.locator('[data-text-runs]')
        await expect(name).toHaveCount(1)
        const lines = await linesOf(name)
        const past = await overflowOf(name)
        const breaks = await breaksOf(name)
        const inCode = await codeBreaks(name)
        const box = await row.evaluate((element) => {
          const own = element.getBoundingClientRect()
          const list = element.closest('figure')?.getBoundingClientRect() ?? own
          return { past: Math.max(own.right - list.right, list.left - own.left) }
        })
        measured.push({ index, lines, past, row: box.past, breaks, inCode })
        expect(lines, `lines of row ${index}`).toBeLessThanOrEqual(2.05)
        expect(past, `row ${index}'s name past its box, in px`).toBeLessThanOrEqual(0.5)
        expect(box.past, `row ${index} past its list, in px`).toBeLessThanOrEqual(0.5)
      }
      // A break falls at a space, after a `/` or a hyphen outside code, and in code never after a
      // hyphen; only the word of code wider than its line breaks inside, and stays in its box.
      const wrapped = measured.filter((one) => one.index !== WIDE)
      expect(wrapped).toHaveLength(TASKS.length - 1)
      for (const one of wrapped.flatMap((row) => row.breaks))
        expect([' ', '/', '-'], one.near).toContain(one.before)
      for (const before of wrapped.flatMap((row) => row.inCode))
        expect([' ', '/']).toContain(before)
      await record(info, `analytics list with code at ${width}`, measured)
    })

    test('the table, the days legend and a day’s hint draw code as code inside their boxes', async ({
      page,
    }, info) => {
      const days = await openDays(page, width, WORLD)
      const legend = days.locator('[data-hint-list="legend"]')
      await expectCodeDrawn(legend, 'the legend')
      const names = legend.locator('[data-series] [data-part="name"]')
      expect(await names.count()).toBeGreaterThanOrEqual(3)
      const entries = []
      for (const name of await names.all()) {
        const line = await oneLine(name, '[data-hint-list="legend"]')
        entries.push(line)
        expect(line.ellipsis, 'a legend name ends in an ellipsis').toBe(true)
        expect(line.past, 'a legend name past the legend, in px').toBeLessThanOrEqual(0.5)
      }

      // The day all four worked: its hint names each task beside its hue, its code as code.
      const parts = await dayParts(page, 1)
      const { x, y } = middleOf(parts.stack)
      await page.mouse.move(x, y)
      const shown = await settledHint(page)
      expect(shown.text).not.toContain('`')
      const hint = page.locator('.tooltip-hint')
      await expectCodeDrawn(hint, 'a day’s hint')
      const inside = await hint.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const codes = Array.from(element.querySelectorAll('[data-text-runs] code'), (code) =>
          Array.from(code.getClientRects(), (rect) => rect.right - box.right),
        ).flat()
        return { right: box.right, left: box.left, codePast: Math.max(...codes) }
      })
      expect(inside.left).toBeGreaterThanOrEqual(0)
      expect(inside.right).toBeLessThanOrEqual(width)
      expect(inside.codePast, 'code past the hint, in px').toBeLessThanOrEqual(0.5)
      // What a screen reader is given keeps the title as written.
      await expect(page.locator('[role="tooltip"]')).toContainText('`STORE_SCHEMA_VERSION`')

      const table = page.locator('.spending-table')
      await expectCodeDrawn(table, 'the table')
      const tableNames = table.locator('tbody th[scope="row"] [data-text-runs]')
      await expect(tableNames).toHaveCount(TASKS.length)
      const cells = []
      for (const name of await tableNames.all()) {
        const line = await oneLine(name, 'th')
        cells.push(line)
        expect(line.ellipsis, 'a table name ends in an ellipsis').toBe(true)
        expect(line.past, 'a table name past its cell, in px').toBeLessThanOrEqual(0.5)
      }
      expect(await shownText(table)).not.toContain('`')
      await record(info, `analytics legend, hint and table with code at ${width}`, {
        entries,
        hint: { ...shown.box, ...inside },
        cells,
      })
    })

    test('the side panel’s heading and a filter’s chip draw code as code; their names keep it written', async ({
      page,
    }, info) => {
      await serve(page, WORLD)
      await page.setViewportSize({ width, height: 900 })
      const id = TASKS[0]?.id ?? ''
      await page.goto(
        pageAt({
          by: 'work_item',
          filters: JSON.stringify({ work_item: [id] }),
          detail: JSON.stringify({ by: 'work_item', value: id }),
        }),
      )
      // The dialog is named by the title as written.
      const panel = page.getByRole('dialog', { name: `Details: ${named(0)}` })
      await expect(panel).toBeVisible()
      const heading = panel.getByRole('heading', { level: 2 })
      await expect(heading).toHaveText(named(0).replaceAll('`', ''))
      await expectCodeDrawn(heading, 'the panel’s heading')
      expect(
        await overflowOf(heading.locator('[data-text-runs]')),
        'heading past its box',
      ).toBeLessThanOrEqual(0.5)
      for (const one of await breaksOf(heading.locator('[data-text-runs]')))
        expect([' ', '/', '-'], one.near).toContain(one.before)

      const chips = await filterChips(page)
      await expect(chips).toHaveCount(1)
      await expect(chips).toHaveText(`Task: ${named(0).replaceAll('`', '')}`)
      await expectCodeDrawn(chips, 'a filter’s chip')
      const chip = await oneLine(chips.locator('[data-text-runs]'), 'li')
      expect(chip.ellipsis).toBe(true)
      expect(chip.past, 'a chip’s name past its chip, in px').toBeLessThanOrEqual(0.5)
      // Its button is named by the title as written.
      await expect(chips.getByRole('button', { name: `Remove Task: ${named(0)}` })).toHaveCount(1)
      await record(info, `analytics panel and chip with code at ${width}`, {
        url: path(page),
        chip,
      })
    })

    test('the rail, the overview’s changes and its card of tasks draw code as code on one line', async ({
      page,
    }, info) => {
      await serve(page, WORLD)
      await page.setViewportSize({ width, height: 1000 })
      // The plain address shows the rail: beside the overview, or alone in a narrow window.
      await page.goto(pageAt())
      const rail = page.locator('.analytics-rail-entry[data-section="work_item"]')
      const lead = rail.locator('[data-text-runs]')
      await expect(lead).toHaveCount(1)
      await expectCodeDrawn(rail, 'the rail')
      const railLine = await oneLine(lead, '.analytics-rail-entry')
      expect(railLine.ellipsis).toBe(true)
      expect(railLine.past, 'the rail’s lead past its entry, in px').toBeLessThanOrEqual(0.5)

      const analytics = await openPanel(page, pageAt())
      const changes = analytics.locator('.overview-changes')
      await expectCodeDrawn(changes, 'the changes')
      const card = analytics.locator('.overview-top[data-card="work_item"]')
      await expectCodeDrawn(card, 'the card of tasks')
      const changed = await changes.locator('[data-text-runs]').all()
      const ranked = await card.locator('[data-kind] [data-text-runs]').all()
      const lines = []
      for (const [name, within] of [
        ...changed.map((one) => [one, 'li'] as const),
        ...ranked.map((one) => [one, '[data-kind]'] as const),
      ]) {
        const line = await oneLine(name, within)
        lines.push(line)
        expect(line.ellipsis, 'a name ends in an ellipsis').toBe(true)
        expect(line.past, 'a name past its line, in px').toBeLessThanOrEqual(0.5)
      }
      expect(lines.length).toBeGreaterThanOrEqual(2 + TASKS.length - 1)
      // A long title cut short with code in it still ends in an ellipsis.
      expect(lines.some((line) => line.cut)).toBe(true)
      expect(await shownText(changes)).not.toContain('`')
      expect(await shownText(card)).not.toContain('`')
      await record(info, `analytics overview with code at ${width}`, { rail: railLine, lines })
    })
  })
}
