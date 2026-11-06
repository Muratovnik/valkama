/**
 * A lane's heading that wraps starts its next row where its words start: under the epic's
 * number, or under the title of the lane with no epic, and never under the chevron or at
 * the heading's own edge, where the counts once stood 4px left of the chevron and 28px left
 * of the number they count for.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve, shot } from './boardPage.ts'
import { drawnParts, overlaps, sameBoxes, settle } from './laneHeadGeometry.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

interface Row {
  left: number
  parts: string[]
}

interface Heading {
  rows: Row[]
  words: number
}

test('a lane heading that wraps at 390px starts its next row under its words', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  await page.mouse.move(0, 0)

  const headings = await page.locator('.lane-head').evaluateAll((heads) =>
    heads.map((head) => {
      const words = head.querySelector('.lane-reference') ?? head.querySelector('.lane-title')
      // Every part the heading lays out in its rows; one it takes out of them to lie over
      // the last row, or that is only for a screen reader, starts no row. Parts of one row
      // are centred on it, so their tops differ: a part below everything before it is a row.
      const parts = [...head.children]
        .filter(
          (part) =>
            getComputedStyle(part).position !== 'absolute' &&
            part.getBoundingClientRect().width > 1,
        )
        .map((part) => ({ box: part.getBoundingClientRect(), name: String(part.className) }))
        .toSorted((one, two) => one.box.top - two.box.top)
      const rows: (Row & { bottom: number })[] = []
      for (const { box, name } of parts) {
        const last = rows.at(-1)
        if (last && box.top < last.bottom - 1) {
          last.left = Math.min(last.left, box.left)
          last.bottom = Math.max(last.bottom, box.bottom)
          last.parts.push(name)
        } else rows.push({ bottom: box.bottom, left: box.left, parts: [name] })
      }
      return {
        rows: rows.map(({ left, parts: names }) => ({ left, parts: names })),
        words: words?.getBoundingClientRect().left ?? Number.NaN,
      } satisfies Heading
    }),
  )

  const wrapped = headings.filter((heading) => heading.rows.length > 1)
  // An epic's lane, an empty one and a closed one each wrap here; a heading on one row
  // proves nothing about where a second one starts.
  expect(wrapped.length, 'lane headings that wrap').toBeGreaterThanOrEqual(3)
  for (const [index, heading] of wrapped.entries()) {
    const [first, ...below] = heading.rows
    expect(first?.parts[0], `heading ${index} leads with its toggle`).toContain('lane-toggle')
    for (const row of below)
      expect(
        Math.abs(row.left - heading.words),
        `heading ${index}: ${row.parts.join(' + ')} starts ${Math.round(row.left - heading.words)}px from its words`,
      ).toBeLessThanOrEqual(1)
  }
  await page.screenshot(shot(info, 'lane-wrap-390.png'))
  const tallest = await page
    .locator('.lane-head')
    .evaluateAll((heads) => heads.map((head) => (head as HTMLElement).offsetHeight))
  await page
    .locator('.lane-head')
    .nth(tallest.indexOf(Math.max(...tallest)))
    .screenshot(shot(info, 'lane-head-390-long-title.png'))
})

interface Head {
  actions: { right: number; shown: boolean } | null
  bottom: number
  clipped: boolean
  drawnBottom: number
  elsewhere: boolean
  right: number
  rows: string[][]
}

/** Every heading's rows of drawn parts, how far its box runs past them, and its actions. */
const readHeads = (heads: Element[]) =>
  heads.map((head) => {
    const box = head.getBoundingClientRect()
    const title = head.querySelector('.lane-title')
    // A part is drawn when it has a size and is not see-through; one lying over the
    // heading rather than in its rows starts no row.
    const drawn = [...head.children].filter(
      (part) =>
        part.getBoundingClientRect().width > 1 && Number(getComputedStyle(part).opacity) > 0,
    )
    const rows: { bottom: number; parts: string[] }[] = []
    for (const part of drawn
      .filter((one) => getComputedStyle(one).position !== 'absolute')
      .toSorted((one, two) => one.getBoundingClientRect().top - two.getBoundingClientRect().top)) {
      const edge = part.getBoundingClientRect()
      const name = String(part.className).split(' ')[0] ?? ''
      const last = rows.at(-1)
      if (last && edge.top < last.bottom - 1) {
        last.bottom = Math.max(last.bottom, edge.bottom)
        last.parts.push(name)
      } else rows.push({ bottom: edge.bottom, parts: [name] })
    }
    const actions = head.querySelector('.lane-actions')
    return {
      actions: actions && {
        right: actions.getBoundingClientRect().right,
        shown: Number(getComputedStyle(actions).opacity) > 0,
      },
      bottom: box.bottom,
      clipped: Boolean(title && title.scrollWidth > title.clientWidth),
      drawnBottom: Math.max(...drawn.map((part) => part.getBoundingClientRect().bottom)),
      elsewhere: head.querySelector('.lane-elsewhere') !== null,
      right: box.right,
      rows: rows.map(({ parts }) => parts),
    } satisfies Head
  })

test('at 1280px a lane heading wraps only for want of room and keeps no blank row', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  // The actions fade in; with less motion asked for they are up as soon as hovered.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)
  await page.mouse.move(0, 0)

  const heads = await page.locator('.lane-head').evaluateAll(readHeads)
  // The states run past the board's width here, so headings name work out of sight.
  expect(heads.filter(({ elsewhere }) => elsewhere).length).toBeGreaterThanOrEqual(1)
  // The counts, the note of work out of sight and the actions wrap as one unit.
  const counts = new Set(['lane-tail'])
  for (const [index, head] of heads.entries()) {
    const said = `heading ${index}: ${JSON.stringify(head.rows)}`
    // The lane's actions, out of sight at rest, once wrapped onto a row that showed nothing.
    expect.soft(head.bottom - head.drawnBottom, `${said} keeps a blank band`).toBeLessThanOrEqual(1)
    // A title cut short is what lets the counts stay; only one shown whole may lack room.
    const alone = head.rows.slice(1).filter((row) => row.every((part) => counts.has(part)))
    expect
      .soft(
        head.clipped || alone.length === 0,
        `${said} puts its counts on a row of their own beside a title shown whole`,
      )
      .toBe(true)
  }

  // A pointer brings the actions up at the heading's end and moves nothing else.
  const first = page.locator('.lane-head').first()
  await first.hover()
  await expect(first.locator('.lane-actions')).toHaveCSS('opacity', '1')
  const [hovered] = await first.evaluateAll(readHeads)
  const [rest] = heads
  expect(hovered?.rows).toEqual(rest?.rows)
  expect(hovered?.bottom).toBe(rest?.bottom)
  expect(hovered?.actions?.shown).toBe(true)
  expect(Math.abs((hovered?.actions?.right ?? 0) - (hovered?.right ?? 0))).toBeLessThanOrEqual(1)
  await page.screenshot(shot(info, 'lane-heads-1280.png'))
})

test('at 1280px an epic heading keeps its actions in a place of their own on hover and focus', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)

  const epics = page.locator('.lane-head', { has: page.locator('.lane-actions') })
  const total = await epics.count()
  expect(total, 'epic headings with actions').toBeGreaterThanOrEqual(3)
  for (let index = 0; index < total; index += 1) {
    const head = epics.nth(index)
    const said = `heading ${index}`
    const actions = head.locator('.lane-actions')

    await page.mouse.move(0, 0)
    await expect(actions, `${said} at rest`).toHaveCSS('opacity', '0')
    const rest = await head.evaluate(drawnParts)
    await head.screenshot(shot(info, `lane-head-1280-${index}-rest.png`))

    await head.hover()
    await expect(actions, `${said} on hover`).toHaveCSS('opacity', '1')
    const hovered = await head.evaluate(drawnParts)
    await head.screenshot(shot(info, `lane-head-1280-${index}-hover.png`))

    await page.mouse.move(0, 0)
    await head.locator('.lane-toggle').evaluate((node: HTMLElement) => {
      node.focus({ preventScroll: true })
    })
    await page.keyboard.press('Tab')
    await expect(actions, `${said} on keyboard focus`).toHaveCSS('opacity', '1')
    const focused = await head.evaluate(drawnParts)
    await head.screenshot(shot(info, `lane-head-1280-${index}-focus.png`))

    for (const [state, drawn] of [
      ['at rest', rest],
      ['on hover', hovered],
      ['on focus', focused],
    ] as const) {
      const others = [...drawn.title, ...drawn.counts, ...drawn.elsewhere]
      const hits = drawn.actions.flatMap((action, at) =>
        others.some((other) => overlaps(action, other)) ? [`action ${at}`] : [],
      )
      expect.soft(hits, `${said} ${state}: actions over a title or count`).toEqual([])
      const onRow = drawn.actions.every(
        (action) =>
          Math.abs(
            (action.top + action.bottom) / 2 - (drawn.toggle.top + drawn.toggle.bottom) / 2,
          ) <= 2,
      )
      expect.soft(onRow, `${said} ${state}: actions leave the first row`).toBe(true)
      expect
        .soft(Math.abs(drawn.height - rest.height), `${said} ${state}: height`)
        .toBeLessThanOrEqual(0.5)
      expect.soft(sameBoxes(drawn.counts, rest.counts), `${said} ${state}: counts`).toBe(true)
      expect
        .soft(sameBoxes(drawn.elsewhere, rest.elsewhere), `${said} ${state}: elsewhere`)
        .toBe(true)
      expect.soft(sameBoxes(drawn.title, rest.title), `${said} ${state}: title`).toBe(true)
    }
  }
})

/** A tile the board brings into view under its sticky lane heading stops at the lane's normal gap. */
async function scrollsTileBelowHeading(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)
  await page.mouse.move(0, 0)

  // The tallest heading below the first open lane, so the heading that stays at the top is
  // the one this width makes: two rows on a narrow board.
  const heights = await page
    .locator('.board-lane.open .lane-head')
    .evaluateAll((heads) => heads.map((head) => (head as HTMLElement).offsetHeight))
  const at = heights.indexOf(Math.max(...heights.slice(1)), 1)

  const board = page.locator('.work-item-lanes')
  const lane = page.locator('.board-lane.open').nth(at)
  const head = lane.locator('.lane-head')
  const tile = lane.locator('[data-reference]').first()
  // The sheet is the tile as drawn; its open button sits lower inside it.
  const sheet = tile.locator('.work-item-tile')
  await expect(sheet).toBeVisible()

  const gapAt = async () => {
    const heading = await head.boundingBox()
    const top = await sheet.boundingBox()
    return top && heading ? top.y - (heading.y + heading.height) : Number.NaN
  }
  // The gap a tile keeps under its heading in the lane's own layout, before anything scrolls.
  const normal = await gapAt()

  // Bring the tile to 50px below the board's top, under the heading that stays at the top while
  // its lane passes. Scrolling re-lays out the lanes above (their heights are estimates until
  // they are drawn), so the tile is moved in steps, each read once the layout has settled.
  for (let step = 0; step < 4; step += 1) {
    const top = await tile.boundingBox()
    const scroller = await board.boundingBox()
    if (!top || !scroller || Math.abs(top.y - scroller.y - 50) <= 1) break
    await board.evaluate(
      (node: HTMLElement, by: number) => {
        node.scrollTop += by
      },
      top.y - scroller.y - 50,
    )
    await settle(board)
  }
  const before = await head.boundingBox()
  const beforeTile = await sheet.boundingBox()
  const tileUnder = Boolean(before && beforeTile && beforeTile.y < before.y + before.height)

  // The way the board brings a tile into view: the tile's open button, nearest edge.
  await tile.locator('.tile-open').evaluate((node: HTMLElement) => {
    node.scrollIntoView({ block: 'nearest' })
  })
  await settle(board)
  return { after: await gapAt(), heading: heights[at], normal, tileUnder }
}

test('at 1280px a tile scrolled into view stops under its lane heading at the normal gap', async ({
  page,
}) => {
  const { after, heading, normal, tileUnder } = await scrollsTileBelowHeading(page, 1280)
  expect(heading, 'a one-row heading').toBeLessThanOrEqual(40)
  expect(tileUnder, 'tile under the heading before the scroll').toBe(true)
  expect(after, 'gap under the heading after scrolling').toBeGreaterThanOrEqual(-0.5)
  expect(after, `gap under the heading, normal gap ${normal.toFixed(1)}px`).toBeLessThanOrEqual(
    normal + 0.5,
  )
})

test('at 390px a tile scrolled into view under a two-row heading stops at the normal gap', async ({
  page,
}) => {
  const { after, heading, normal, tileUnder } = await scrollsTileBelowHeading(page, 390)
  expect(heading, 'a two-row heading').toBeGreaterThan(40)
  expect(tileUnder, 'tile under the heading before the scroll').toBe(true)
  expect(after, 'gap under the heading after scrolling').toBeGreaterThanOrEqual(-0.5)
  expect(after, `gap under the heading, normal gap ${normal.toFixed(1)}px`).toBeLessThanOrEqual(
    normal + 0.5,
  )
})
