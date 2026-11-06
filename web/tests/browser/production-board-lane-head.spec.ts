/**
 * A lane heading at every width a board takes, in both languages, where a pointer can hover and
 * where only a finger can press, with work out of sight on either side: its card and chain
 * actions cover nothing at rest, under the pointer or with the keyboard on them, and nothing moves
 * when they come up; no line holds the state alone, nor the actions but where nothing can come
 * down with them; the title keeps the letters the base drew; the heading takes no more lines than
 * the base but where one of these needs it; and a tile the board brings into view under the
 * heading stands below it at the lane's own gap, however many lines the heading takes.
 *
 * What is measured is what is drawn (`laneHeadRows.ts`), in the built app once its fonts are in,
 * against how the base drew the same heading (`laneHeadBase.ts`). A line more than the base is
 * the cost of one of three things. The base held that line only by laying its actions over the
 * counts or the note. Or beside the title the actions would cut it, so they end the last line and
 * take its last part down with them. Or, in the lane of work under no epic at 320px in Russian,
 * the line under the title starts under the reference, not at the heading's edge, and holds less:
 * that inset is kept, since a line wrapped from the edge stood 4px left of the chevron. Where the
 * heading keeps one line that the base drew as two, its title gives way to keep it so, as it gives
 * way before the counts wrap; nowhere else does it keep fewer letters than the base.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { baseOf, WIDTHS } from './laneHeadBase.ts'
import type { Drawn } from './laneHeadBase.ts'
import { overlaps, settle } from './laneHeadGeometry.ts'
import { readHeading } from './laneHeadRows.ts'
import type { Part, Reading } from './laneHeadRows.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/**
 * Where the actions end the heading alone on its last line: the counts that end its text would
 * leave the state alone above them (MAIN-420), or stand alone and with the actions are wider than
 * the line (MAIN-410 in Russian). Beside the title they would leave it 2 of its 15 letters, and
 * the title wins. By locale, lane and width.
 */
const ALONE = new Set([
  'en-US MAIN-420 320',
  'en-US MAIN-420 350',
  'ru-RU MAIN-420 320',
  'ru-RU MAIN-420 350',
  'ru-RU MAIN-410 320',
])

/** Where the inset under the title costs a line (above). */
const INSET = new Set(['ru-RU Без эпика 320'])

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

const SIDES = ['left', 'top', 'right', 'bottom'] as const

/** What an action lies over. */
function covered(reading: Reading): string[] {
  if (!reading.actionsShown) return []
  const actions = reading.parts.filter(({ member }) => member === 'action')
  return reading.parts
    .filter(
      ({ box, member }) => member !== 'action' && actions.some((one) => overlaps(one.box, box)),
    )
    .map(({ member }) => `an action covers the ${member}`)
}

/** A line that holds the state or the actions and nothing else, but where it is named. */
function alone(reading: Reading, named: boolean): string[] {
  return reading.rows.flatMap((row) => {
    if (row.length === 1 && row[0] === 'state') return ['the state stands on a line alone']
    const lone = row.every((member) => member === 'action')
    return lone && !named ? ['the actions stand on a line alone'] : []
  })
}

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

/** What is wrong with one heading in one state, against its reading at rest. */
function faults(reading: Reading, rest: Reading, named: boolean): string[] {
  const outside = reading.parts
    .filter(({ box }) => box.left < -0.5 || box.right > reading.width + 0.5)
    .map(({ member }) => `the ${member} runs past the heading`)
  const moved = still(reading, rest) ? [] : ['something moves']
  return [...new Set([...covered(reading), ...alone(reading, named), ...outside, ...moved])]
}

/** What one heading at rest gives up against the base: letters of its title, or lines. */
function againstBase(rest: Reading, base: Drawn | undefined, named: boolean): string[] {
  if (!base) return ['the base has no reading here']
  const lines = rest.rows.length
  const last = rest.rows.at(-1) ?? []
  // The actions end the last line with the part that came down with them.
  const tied = last.includes('action') && last.length > 1
  const extra = lines > base.rows
  return [
    ...(rest.titleChars < base.letters && !(lines === 1 && base.rows > 1)
      ? [`the title keeps ${rest.titleChars} letters, the base ${base.letters}`]
      : []),
    ...(extra && !(base.covered || (tied && !rest.besideWhole) || named)
      ? [`${lines} lines, the base ${base.rows}`]
      : []),
  ]
}

/** One heading at rest, under the pointer if one can hover, and with the keyboard on it. */
async function readStates(page: Page, head: Locator, hover: boolean) {
  const board = page.locator('.work-item-lanes')
  const rest = await readHeading(head)
  const states: [string, Reading][] = [['at rest', rest]]
  if ((await head.locator('.lane-actions').count()) === 0) return states
  if (hover) {
    await head.hover({ position: { x: 4, y: 4 } })
    await settle(board)
    states.push(['under the pointer', await readHeading(head)])
    await page.mouse.move(0, 0)
  }
  await head.locator('.lane-toggle').evaluate((node: HTMLElement) => {
    node.focus({ preventScroll: true })
  })
  await page.keyboard.press('Tab')
  await settle(board)
  states.push(['with the keyboard on an action', await readHeading(head)])
  await page.locator('body').evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  await settle(board)
  return states
}

/**
 * Every heading at `width`, with the board at its first states and scrolled to its middle ones,
 * and what is wrong with each, against itself at rest and against the base.
 */
async function readWidth(page: Page, width: number, locale: string, hover: boolean) {
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
      const named = `${locale} ${name} ${width}`
      const states = await readStates(page, head, hover)
      const [[, rest]] = states
      for (const [state, reading] of states)
        found.push(
          ...faults(reading, rest, ALONE.has(named)).map((one) => `${where} ${state}: ${one}`),
        )
      if (!states.every(([, reading], at) => at === 0 || reading.actionsShown))
        found.push(`${where}: an action the pointer or keyboard is on is not up`)
      const base = baseOf(`${locale}|${hover ? 'pointer' : 'touch'}|${scroll}|${name}`, width)
      found.push(
        ...againstBase(rest, base, ALONE.has(named) || INSET.has(named)).map(
          (one) => `${where}: ${one}`,
        ),
      )
    }
  }
  return found
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
      test.setTimeout(300_000)
      await openWide(page, 1280)
      const found: string[] = []
      for (const width of WIDTHS) found.push(...(await readWidth(page, width, locale, true)))
      expect(found).toEqual([])
    })
  })

  test.describe(`${locale}, where only a finger presses`, () => {
    test.use({ locale, hasTouch: true, isMobile: true })

    test('a heading keeps its actions up, a finger’s reach apart, covering nothing', async ({
      page,
    }) => {
      test.setTimeout(240_000)
      await openWide(page, 390)
      await expect.poll(() => page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
      const found: string[] = []
      for (const width of [320, 390, 760, 1280]) {
        const lines = await readWidth(page, width, locale, false)
        found.push(...lines, ...(await readReach(page, width)))
      }
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
