/**
 * A lane heading at every width a board takes, in both languages, where a pointer can hover and
 * where only a finger can press, with work out of sight on either side: its card and chain
 * actions cover nothing at rest, under the pointer or with the keyboard on them, and nothing moves
 * when they come up; no line holds the state or the actions alone; a long title keeps a readable
 * share of its line; and a tile the board brings into view under the heading stands below it at
 * the lane's own gap, however many lines the heading takes.
 *
 * What is measured is what is drawn: the letters of the title, the state's dot and word, the
 * counts, each line of a note and each action's glyph (`laneHeadRows.ts`).
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { overlaps, settle } from './laneHeadGeometry.ts'
import { readHeading } from './laneHeadRows.ts'
import type { Part, Reading } from './laneHeadRows.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/** The widths where a heading's lines change, from the narrowest phone to a wide desktop. */
const WIDTHS = [320, 350, 390, 430, 480, 530, 560, 600, 680, 760, 900, 1024, 1280, 1440]

/**
 * The least a long title keeps whole, and the most lines its heading takes, where a reader
 * counts them, with work out of sight to the right, in the built app and its fonts. The base
 * drew 15 letters at 320px, 25 at 390px and 68 or more at 1280px, in at most three lines, two
 * and two, only by laying the actions over the counts. Then the actions kept a place of their
 * own and the heading took five lines at 320px, up to five at 390px and two at 1280px. Now
 * beside the title on a full line, the actions cost it letters at 390px instead of a line: 12
 * or 13 of its 25 stay in English. At 1280px a heading the base drew on two lines takes one,
 * and its title gives up its end: 64 letters or more stay.
 */
const LONG_TITLES = new Map([
  [320, { letters: 15, lines: 3 }],
  [390, { letters: 12, lines: 3 }],
  [1280, { letters: 64, lines: 1 }],
])

async function openWide(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  // The actions fade in; with less motion asked for they are up as soon as they are shown.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)
  await page.mouse.move(0, 0)
}

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

/** A line that holds the state or the actions and nothing else. */
function alone(reading: Reading): string[] {
  return reading.rows.flatMap((row) => {
    if (row.length === 1 && row[0] === 'state') return ['the state stands on a line alone']
    return row.every((member) => member === 'action') ? ['the actions stand on a line alone'] : []
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
function faults(reading: Reading, rest: Reading): string[] {
  const outside = reading.parts
    .filter(({ box }) => box.left < -0.5 || box.right > reading.width + 0.5)
    .map(({ member }) => `the ${member} runs past the heading`)
  const moved = still(reading, rest) ? [] : ['something moves']
  return [...new Set([...covered(reading), ...alone(reading), ...outside, ...moved])]
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
 * and what is wrong with each, with what each long title keeps at rest.
 */
async function readWidth(page: Page, width: number, hover: boolean) {
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
      const name = await head.locator('.lane-reference, .lane-title').first().textContent()
      const states = await readStates(page, head, hover)
      const [[, rest]] = states
      for (const [state, reading] of states)
        found.push(
          ...faults(reading, rest).map((one) => `${width}px ${scroll} ${name} ${state}: ${one}`),
        )
      if (!states.every(([, reading], at) => at === 0 || reading.actionsShown))
        found.push(
          `${width}px ${scroll} ${name}: an action the pointer or keyboard is on is not up`,
        )
      found.push(...longTitle(width, scroll, name ?? '', rest))
    }
  }
  return found
}

/** What a long title keeps against its least at this width, on the board's first states. */
function longTitle(width: number, scroll: string, name: string, rest: Reading): string[] {
  const least = LONG_TITLES.get(width)
  if (!least || scroll !== 'start' || !['MAIN-401', 'MAIN-493'].includes(name)) return []
  return [
    ...(rest.titleChars < least.letters ? [`${width}px ${name}: ${rest.titleChars} letters`] : []),
    ...(rest.rows.length > least.lines ? [`${width}px ${name}: ${rest.rows.length} lines`] : []),
  ]
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
      for (const width of WIDTHS) found.push(...(await readWidth(page, width, true)))
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
        const lines = await readWidth(page, width, false)
        found.push(...lines, ...(await readReach(page, width)))
      }
      expect(found).toEqual([])
    })
  })
}

/** A tile the board brings into view under its lane's heading, by the board's own ways. */
type Way = 'walk' | 'press'

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

/**
 * Brings MAIN-403 into view one of the board's ways: the keyboard walking up to it from the
 * tile below, or a press on the part of it in view, which opens it.
 */
async function bring(page: Page, epic: Locator, way: Way) {
  const tile = epic.locator('li[data-reference="MAIN-403"]')
  if (way === 'walk') {
    await epic.locator('li[data-reference="MAIN-404"] .tile-open').evaluate((node: HTMLElement) => {
      node.focus({ preventScroll: true })
    })
    await page.keyboard.press('ArrowUp')
    await expect(tile.locator('.tile-open')).toBeFocused()
    return
  }
  const box = await tile.locator('.work-item-tile').boundingBox()
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
 * the top, brings it in, and says how far below the heading it then stands, against the gap the
 * lane keeps under its heading where nothing is scrolled.
 */
async function bringsTileIn(page: Page, way: Way) {
  const board = page.locator('.work-item-lanes')
  const epic = page.locator('.board-lane.open').first()
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
  return { after: await gapUnder(head, sheet('MAIN-403')), before, height, normal }
}

for (const width of [320, 390, 760, 1280])
  test(`at ${width}px a tile the board brings in under its lane heading stands at the lane's gap`, async ({
    page,
  }) => {
    for (const way of ['walk', 'press'] as const) {
      await openWide(page, width)
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
