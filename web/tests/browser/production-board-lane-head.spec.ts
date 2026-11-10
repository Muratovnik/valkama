/**
 * A lane heading at every width a board takes, in both languages, where a pointer can hover and
 * where only a finger can press, with work out of sight on either side: its card and chain
 * actions cover nothing at rest, under the pointer or with the keyboard on them, and nothing moves
 * when they come up; no line holds the state alone but where it and the counts do not fit one,
 * nor the actions but where nothing can come down with them; the title keeps the letters the base drew; the heading takes no more lines than
 * the base but where one of these needs it; and a tile the board brings into view under the
 * heading stands below it at the lane's own gap, however many lines the heading takes.
 *
 * What is measured is what is drawn (`laneHeadRows.ts`), in the built app once its fonts are in,
 * against how the base drew the same heading (`laneHeadBase.ts`), every 10px from 320 to 1440 at
 * rest and at `WIDTHS` under the pointer and the keyboard too. Each exception is read from the
 * heading itself, not listed. A line more than the base is the cost of one of three things. The
 * base held that line only by laying its actions over the counts or the note. Or every other
 * layout of the heading with fewer lines, each drawn on a copy of it (`laneHeadOthers.ts`), covers
 * text, leaves a part alone on a line or cuts the title. Or the lines after the first start under
 * the reference rather than at the heading's edge, and the same heading laid out from its edge
 * takes fewer: that inset is kept, since a line wrapped from the edge stood 4px left of the
 * chevron. The actions stand alone on a line only where every other layout of as few lines does
 * one of those things too. The title keeps at least the letters the base drew, everywhere: where
 * one line would cut it, the heading takes the base's lines instead.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { baseOf, SWEEP, WIDTHS } from './laneHeadBase.ts'
import type { Drawn } from './laneHeadBase.ts'
import { settle } from './laneHeadGeometry.ts'
import { better, covered } from './laneHeadOthers.ts'
import { readHeading, rowsFromTheEdge } from './laneHeadRows.ts'
import type { Part, Reading } from './laneHeadRows.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/**
 * The board as a reader opens it at `width`, its fonts in before anything is measured: the wide
 * one, or the board's own space on a screen short enough for it to scroll.
 */
async function open(page: Page, width: number, wide: boolean) {
  await page.setViewportSize({ width, height: wide ? 900 : 600 })
  // The actions fade in; with less motion asked for they are up as soon as they are shown.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  if (wide) await serveWide(page)
  await openBoard(page)
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

const openWide = (page: Page, width: number) => open(page, width, true)

/** The widths where, with only a finger, the keyboard and each action's reach are read too. */
const TOUCHED = new Set([320, 390, 760, 1280])

const SIDES = ['left', 'top', 'right', 'bottom'] as const

/** The state alone on a line, which is forced only where the state and the counts do not fit one. */
const stateAlone = (reading: Reading) =>
  reading.rows.some((row) => row.length === 1 && row[0] === 'state')

/**
 * Whether the state and the counts fit one line of the heading together. «Dev» always did; on a
 * phone «В работе» and «Выполнено» beside Russian counts take more than the line has, and there
 * the state stands on a line of its own above the counts. Read in the page.
 */
const stateFitsCounts = (head: Element) => {
  const state = head.querySelector('.lane-state:not(.visually-hidden)')
  const counts = head.querySelector('.lane-counts')
  const tail = head.querySelector('.lane-tail')
  if (!state || !counts || !tail) return true
  const style = getComputedStyle(head)
  const line = head.getBoundingClientRect().width - Number.parseFloat(style.paddingInlineStart)
  const gap = Number.parseFloat(getComputedStyle(tail).columnGap)
  const width = (element: Element) => element.getBoundingClientRect().width
  return width(state) + gap + width(counts) <= line + 0.5
}

/** Whether the actions stand on a line of their own. */
const actionsAlone = (reading: Reading) =>
  reading.rows.some((row) => row.every((member) => member === 'action'))

/** Whether every part but the actions stands where it stood at rest. */
function still(reading: Reading, rest: Reading): boolean {
  const kept = (one: Reading): Part[] => one.parts.filter(({ member }) => member !== 'action')
  const after = kept(reading)
  return (
    Math.abs(reading.height - rest.height) <= 0.5 &&
    kept(rest).length === after.length &&
    kept(rest).every(({ box }, index) =>
      SIDES.every((side) => Math.abs(box[side] - (after[index]?.box[side] ?? Number.NaN)) <= 0.5),
    )
  )
}

/**
 * What is wrong with one heading in one state, against its reading at rest; `paired` says
 * whether its state and its counts fit one line.
 */
function faults(reading: Reading, rest: Reading, paired: boolean): string[] {
  const outside = reading.parts
    .filter(({ box }) => box.left < -0.5 || box.right > reading.width + 0.5)
    .map(({ member }) => `the ${member} runs past the heading`)
  const moved = still(reading, rest) ? [] : ['something moves']
  const over = covered(reading).map((member) => `an action covers the ${member}`)
  const alone = paired && stateAlone(reading) ? ['the state stands on a line alone'] : []
  return [...new Set([...over, ...alone, ...outside, ...moved])]
}

/** What one heading at rest gives up against the base: letters of its title, or lines. */
async function againstBase(head: Locator, rest: Reading, base: Drawn | undefined) {
  if (!base) return ['the base has no reading here']
  const found =
    rest.titleChars < base.letters
      ? [`the title keeps ${rest.titleChars} letters, the base ${base.letters}`]
      : []
  const lines = rest.rows.length
  if (lines <= base.rows || base.covered) return found
  const inset = lines - (await rowsFromTheEdge(head))
  if (lines - base.rows <= inset) return found
  // A line more is forced only where every layout with fewer lines does worse.
  const fewer = await better(head, rest)
  return fewer.length === 0
    ? found
    : [...found, `${lines} lines, the base ${base.rows}; ${fewer.join(', ')}`]
}

/** Where the actions stand on a line alone, the layouts of as few lines that need not. */
async function aloneAgainst(head: Locator, states: (readonly [string, Reading])[]) {
  const [[, rest]] = states
  if (!states.some(([, reading]) => actionsAlone(reading))) return []
  const others = await better(head, rest, 1)
  return others.length === 0 ? [] : [`the actions stand on a line alone; ${others.join(', ')}`]
}

/**
 * Waits until the actions have faded in or out, however many frames that takes under load, and
 * two more for what it draws.
 */
async function faded(head: Locator) {
  await head
    .locator('.lane-actions')
    .evaluate((node) => Promise.all(node.getAnimations().map((one) => one.finished)))
  await settle(head)
}

/** One heading at rest, under the pointer if one can hover, and with the keyboard on it. */
async function readStates(page: Page, head: Locator, hover: boolean) {
  const rest = await readHeading(head)
  const states: [string, Reading][] = [['at rest', rest]]
  if ((await head.locator('.lane-actions').count()) === 0) return states
  if (hover) {
    await head.hover({ position: { x: 4, y: 4 } })
    await faded(head)
    states.push(['under the pointer', await readHeading(head)])
    await page.mouse.move(0, 0)
  }
  await head.locator('.lane-toggle').evaluate((node: HTMLElement) => {
    node.focus({ preventScroll: true })
  })
  await page.keyboard.press('Tab')
  await faded(head)
  states.push(['with the keyboard on an action', await readHeading(head)])
  await page.locator('body').evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  await faded(head)
  return states
}

/**
 * Every heading at `width`, with the board at its first states and scrolled to its middle ones,
 * and what is wrong with each, against itself at rest and against the base: at rest only, or
 * under the pointer and the keyboard too where `every`.
 */
async function readWidth(
  page: Page,
  width: number,
  { every, hover, locale }: { every: boolean; hover: boolean; locale: string },
) {
  await page.setViewportSize({ width, height: 900 })
  const board = page.locator('.work-item-lanes')
  const found: string[] = []
  for (const scroll of ['start', 'middle'] as const) {
    await page.mouse.move(0, 0)
    await board.evaluate((node: HTMLElement, where) => {
      const states = node.querySelectorAll<HTMLElement>('.lanes-state')
      node.scrollLeft = where === 'start' ? 0 : (states[2]?.offsetLeft ?? 0)
    }, scroll)
    await settle(board)
    const heads = page.locator('.lane-head')
    for (let index = 0; index < (await heads.count()); index += 1) {
      const head = heads.nth(index)
      const name = (await head.locator('.lane-reference, .lane-title').first().textContent()) ?? ''
      const where = `${width}px ${scroll} ${name}`
      const states = every
        ? await readStates(page, head, hover)
        : [['at rest', await readHeading(head)] as const]
      const [[, rest]] = states
      const paired = await head.evaluate(stateFitsCounts)
      for (const [state, reading] of states)
        found.push(...faults(reading, rest, paired).map((one) => `${where} ${state}: ${one}`))
      if (!states.every(([, reading], at) => at === 0 || reading.actionsShown))
        found.push(`${where}: an action the pointer or keyboard is on is not up`)
      const alone = await aloneAgainst(head, states)
      found.push(...alone.map((one) => `${where}: ${one}`))
      const base = baseOf(`${locale}|${hover ? 'pointer' : 'touch'}|${scroll}|${name}`, width)
      const lost = await againstBase(head, rest, base)
      found.push(...lost.map((one) => `${where}: ${one}`))
    }
  }
  return found
}

/** Every heading at `width` where only a finger presses, and at `TOUCHED` its focus and reach. */
async function readTouch(page: Page, width: number, locale: string) {
  const every = TOUCHED.has(width)
  const found = await readWidth(page, width, { every, hover: false, locale })
  return every ? [...found, ...(await readReach(page, width))] : found
}

/**
 * Whether each action answers a press anywhere 44px around it, and only it: a reach
 * that met its neighbour's would send that press to the neighbour. A probe stands a pixel inside
 * the 44px, since two reaches that meet share the pixel between them.
 */
const reaches = (head: Element) =>
  [...head.querySelectorAll('.lane-actions button')].flatMap((button) => {
    if (!button.querySelector('svg')) return [`${button.getAttribute('aria-label')} draws no glyph`]
    const box = button.getBoundingClientRect()
    const x = (box.left + box.right) / 2
    const y = (box.top + box.bottom) / 2
    return [-21, 0, 21].flatMap((dx) =>
      [-21, 0, 21].flatMap((dy) =>
        document.elementFromPoint(x + dx, y + dy)?.closest('button') === button
          ? []
          : [`${button.getAttribute('aria-label')} misses a press at ${dx}, ${dy}`],
      ),
    )
  })

/**
 * Every open epic lane's heading at `width`: its actions up and each reaching a finger's width.
 * A folded lane ends at its heading, and the next lane is drawn over the 4px of reach below it.
 */
async function readReach(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const board = page.locator('.work-item-lanes')
  await board.evaluate((node: HTMLElement) => {
    node.scrollLeft = 0
    node.scrollTop = 0
  })
  await settle(board)
  const heads = page.locator('.board-lane.open .lane-head', { has: page.locator('.lane-actions') })
  const found: string[] = []
  for (let index = 0; index < (await heads.count()); index += 1) {
    const head = heads.nth(index)
    // Where a press lands is asked of the page in view.
    await head.evaluate((node) => {
      node.scrollIntoView({ block: 'center' })
    })
    await settle(board)
    const reading = await readHeading(head)
    if (!reading.actionsShown) found.push(`${width}px heading ${index}: the actions are not up`)
    const misses = await head.evaluate(reaches)
    found.push(...misses.map((one) => `${width}px heading ${index}: ${one}`))
  }
  return found
}

for (const locale of ['en-US', 'ru-RU']) {
  test.describe(`${locale}, with a pointer`, () => {
    test.use({ locale })

    test('a heading’s actions cover nothing, move nothing and never stand alone', async ({
      page,
    }) => {
      test.setTimeout(900_000)
      await openWide(page, 1280)
      const found: string[] = []
      for (const width of SWEEP)
        found.push(
          ...(await readWidth(page, width, { every: WIDTHS.includes(width), hover: true, locale })),
        )
      expect(found).toEqual([])
    })
  })

  test.describe(`${locale}, where only a finger presses`, () => {
    test.use({ locale, hasTouch: true, isMobile: true })

    test('a heading keeps its actions up, a finger’s reach apart, covering nothing', async ({
      page,
    }) => {
      test.setTimeout(900_000)
      await openWide(page, 390)
      await expect.poll(() => page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
      const found: string[] = []
      for (const width of SWEEP) found.push(...(await readTouch(page, width, locale)))
      expect(found).toEqual([])
    })
  })
}

/**
 * A tile the board brings into view under its lane's heading, by the board's own ways: the
 * keyboard walking up to it, a press on the part of it in view, or the keyboard moving the tile
 * below up into its place.
 */
type Way = 'move' | 'press' | 'walk'

/** The tile each way brings in: the one walked to or pressed, or the one moved into its place. */
const BROUGHT: Record<Way, string> = { move: 'MAIN-404', press: 'MAIN-403', walk: 'MAIN-403' }

/**
 * The board each way is tried on. A move is answered by the board's own space: the wide one is
 * read the same whatever is written to it, so the next read puts a moved tile back.
 */
const OPEN: Record<Way, (page: Page, width: number) => Promise<void>> = {
  move: (page, width) => open(page, width, false),
  press: openWide,
  walk: openWide,
}

/** How far below the lane's heading a tile's sheet stands. */
async function gapUnder(head: Locator, sheet: Locator) {
  const heading = await head.boundingBox()
  const top = await sheet.boundingBox()
  return top && heading ? top.y - (heading.y + heading.height) : Number.NaN
}

/** Scrolls the board until `sheet` stands `by` px under the heading held at the top. */
async function tuck(page: Page, head: Locator, sheet: Locator, by: number) {
  const board = page.locator('.work-item-lanes')
  // Scrolling lays out the lanes above anew, so the tile is moved in steps until it holds.
  for (let step = 0; step < 6; step += 1) {
    const short = (await gapUnder(head, sheet)) + by
    if (Math.abs(short) <= 0.5) return
    await board.evaluate((node: HTMLElement, distance: number) => {
      node.scrollTop += distance
    }, short)
    await settle(board)
  }
}

/** The references of a lane's first three tiles, in the order it draws them. */
const order = (epic: Locator) =>
  epic
    .locator('li[data-reference]')
    .evaluateAll((items) =>
      items.slice(0, 3).map((item) => (item as HTMLElement).dataset.reference),
    )

/** Brings a tile in one of the board's ways, from MAIN-404 below MAIN-403 or on MAIN-403 itself. */
async function bring(page: Page, epic: Locator, way: Way) {
  const below = epic.locator('li[data-reference="MAIN-404"] .tile-open')
  if (way !== 'press') {
    await below.evaluate((node: HTMLElement) => {
      node.focus({ preventScroll: true })
    })
    await page.keyboard.press(way === 'walk' ? 'ArrowUp' : 'Alt+ArrowUp')
    const tile = epic.locator(`li[data-reference="${BROUGHT[way]}"] .tile-open`)
    await expect(tile).toBeFocused()
    if (way === 'move')
      await expect.poll(() => order(epic)).toEqual(['MAIN-402', 'MAIN-404', 'MAIN-403'])
    return
  }
  const box = await epic.locator('li[data-reference="MAIN-403"] .work-item-tile').boundingBox()
  const heading = await epic.locator('.lane-head').boundingBox()
  if (!box || !heading) throw new Error('the tile is not on screen')
  await page.mouse.click(
    box.x + box.width / 2,
    (heading.y + heading.height + box.y + box.height) / 2,
  )
  await expect(page).toHaveURL(/entity=/)
}

/**
 * Leaves MAIN-403, the second tile of MAIN-401's Backlog, 12px under its lane's heading held at
 * the top, brings a tile in, and says how far below the heading it then stands, against the gap
 * the lane keeps under its heading where nothing is scrolled.
 */
async function bringsTileIn(page: Page, way: Way) {
  const board = page.locator('.work-item-lanes')
  const epic = page.locator('.board-lane.open', {
    has: page.locator('li[data-reference="MAIN-404"]'),
  })
  const head = epic.locator('.lane-head')
  const sheet = (reference: string) =>
    epic.locator(`li[data-reference="${reference}"] .work-item-tile`)
  const normal = await gapUnder(head, sheet('MAIN-402'))
  await tuck(page, head, sheet('MAIN-403'), 12)
  const before = await gapUnder(head, sheet('MAIN-403'))
  await bring(page, epic, way)
  await settle(board)
  await settle(board)
  const heading = await head.boundingBox()
  const height = heading?.height ?? Number.NaN
  return { after: await gapUnder(head, sheet(BROUGHT[way])), before, height, normal }
}

for (const width of [320, 390, 760, 1280])
  test(`at ${width}px a tile the board brings in under its lane heading stands at the lane's gap`, async ({
    page,
  }) => {
    for (const way of ['walk', 'press', 'move'] as const) {
      await OPEN[way](page, width)
      const { after, before, height, normal } = await bringsTileIn(page, way)
      expect(before, `${way}: the tile starts under the heading`).toBeLessThan(-11)
      expect
        .soft(
          Math.abs(after - normal),
          `${way}: ${after.toFixed(1)}px under a heading ${height}px tall, the lane's gap ${normal.toFixed(1)}px`,
        )
        .toBeLessThanOrEqual(0.5)
    }
  })
