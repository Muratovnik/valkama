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
import { readHeading } from './laneHeadRows.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/** A box's vertical middle. */
const middle = ({ bottom, top }: { bottom: number; top: number }) => (top + bottom) / 2

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
  /** Whether the title, whole, and every part after it would fit the heading's first line. */
  oneLine: boolean
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
    // The title's whole width is its text's; the tail's is its parts' and the gaps between them.
    const range = document.createRange()
    if (title) range.selectNodeContents(title)
    const toggle = head.querySelector('.lane-toggle')?.getBoundingClientRect().width ?? 0
    const tail = head.querySelector('.lane-tail')
    const after = [...(tail?.children ?? [])]
      .filter((part) => getComputedStyle(part).position !== 'absolute')
      .map((part) => part.getBoundingClientRect().width)
      .filter((one) => one > 0)
    const tailGap = tail ? Number.parseFloat(getComputedStyle(tail).columnGap) : 0
    const tailWidth = after.reduce((sum, one) => sum + one, 0) + tailGap * (after.length - 1)
    const titleWidth =
      toggle - (title?.getBoundingClientRect().width ?? 0) + range.getBoundingClientRect().width
    const style = getComputedStyle(head)
    const inset = Number.parseFloat(style.paddingInlineStart)
    return {
      actions: actions && {
        right: actions.getBoundingClientRect().right,
        shown: Number(getComputedStyle(actions).opacity) > 0,
      },
      bottom: box.bottom,
      clipped: Boolean(title && title.scrollWidth > title.clientWidth),
      drawnBottom: Math.max(...drawn.map((part) => part.getBoundingClientRect().bottom)),
      elsewhere: head.querySelector('.lane-elsewhere') !== null,
      oneLine:
        titleWidth - inset + Number.parseFloat(style.columnGap) + tailWidth <= box.width - inset,
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
    // The counts go below a title only where it and they would not fit one line whole: a title
    // is not cut to keep them beside it.
    const alone = head.rows.slice(1).filter((row) => row.every((part) => counts.has(part)))
    expect
      .soft(
        alone.length === 0 || !head.oneLine,
        `${said} puts its counts on a row of their own beside a title they fit beside`,
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
      // They end the last line, or stand beside the title on the first.
      const last = Math.max(...[...drawn.counts, ...drawn.elsewhere].map((box) => middle(box)))
      const onRow = drawn.actions.every((action) =>
        [middle(drawn.toggle), last].some((row) => Math.abs(middle(action) - row) <= 2),
      )
      expect.soft(onRow, `${said} ${state}: actions leave the first and the last row`).toBe(true)
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

/**
 * A short title on a phone: where its state fits beside it whole, the base drew the state there
 * and the counts with the actions on the line below. Held to one part, the state and the counts
 * below the title once left the actions a third line of their own, an empty band at rest.
 */
async function shortTitleRows(page: Page) {
  const head = page.locator('.lane-head', {
    has: page.locator('.lane-reference', { hasText: 'MAIN-420' }),
  })
  const found: string[] = []
  let fitting = 0
  for (let width = 320; width <= 400; width += 2) {
    await page.setViewportSize({ width, height: 900 })
    await settle(head)
    // The toggle drawn with its title whole, the heading's gap and the state, against its width.
    const fits = await head.evaluate((node) => {
      const toggle = node.querySelector('.lane-toggle')
      const title = node.querySelector('.lane-title')
      const state = node.querySelector('.lane-state')
      if (!toggle || !title || !state) return false
      const range = document.createRange()
      range.selectNodeContents(title)
      const whole =
        toggle.getBoundingClientRect().width -
        title.getBoundingClientRect().width +
        range.getBoundingClientRect().width
      const gap = Number.parseFloat(getComputedStyle(node).columnGap)
      return whole + gap + state.getBoundingClientRect().width <= node.getBoundingClientRect().width
    })
    const { rows } = await readHeading(head)
    const lone = rows.some((row) => row.every((member) => member === 'action'))
    fitting += fits ? 1 : 0
    if (fits && (rows.length > 2 || lone))
      found.push(`${width}px: ${rows.map((row) => row.join(' + ')).join(' / ')}`)
  }
  return { fitting, found }
}

for (const locale of ['en-US', 'ru-RU'])
  for (const finger of [false, true])
    test.describe(`${locale}, ${finger ? 'where only a finger presses' : 'with a pointer'}`, () => {
      test.use(finger ? { locale, hasTouch: true, isMobile: true } : { locale })

      test('a short title keeps its state beside it and its actions with the counts', async ({
        page,
      }) => {
        await page.setViewportSize({ width: 390, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await installBackend(page)
        await serve(page)
        await serveWide(page)
        await openBoard(page)
        await page.evaluate(() => document.fonts.ready)
        await page.mouse.move(0, 0)
        const { fitting, found } = await shortTitleRows(page)
        // A walk on which the state never fitted beside the title would prove nothing.
        expect(fitting).toBeGreaterThan(5)
        expect(found).toEqual([])
      })
    })
