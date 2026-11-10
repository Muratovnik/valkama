/**
 * The edges of the list of work going on now, measured on every row rather than looked
 * at, the quiet rows opened: a row's words start at one x whatever its number's length, a
 * keyboard ring is whole with nothing drawn over it, the pin under the pointer covers
 * neither the title's ellipsis nor the count and stands where a pinned row's pin does, an
 * epic at work says so in the sign column every row does, the empty list and the panel's
 * heading start at an edge their surroundings have, and the panel's folds are a finger's
 * size.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveFrame } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow, openFolds, servePins } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
const RAIL = '.nav-work-list'
const PANEL = '.side-panel-body'

/** The busy frame with a count on a row of each level, and a long title on one. */
function edgeFrame() {
  const frame = busyFrame()
  const next = frame.spaces[1].rows[0]
  frame.spaces[1].rows[0] = {
    ...next,
    agents: 3,
    title: 'Second space work with a title long enough to need its end cut',
  }
  return frame
}

async function open(page: Page, width: number, frame: LiveFrame = edgeFrame()) {
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(frame)
  if (width > 760) {
    await openFolds(page, RAIL)
    return RAIL
  }
  await page.locator('.nav-work-rail').click()
  await settled(page.getByRole('dialog', { name: 'Work' }))
  await openFolds(page, PANEL)
  return PANEL
}

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

interface RowBoxes {
  depth: string
  meta: Box | null
  pin: Box | null
  reference: string
  sign: Box | null
  title: Box
  /** Where the row's words start: its epic's title, or its own. */
  words: Box
}

/** Every row's parts as they stand: depth, sign, title, count and a pin in sight. */
function rows(page: Page, within: string) {
  return page.locator(within).evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('.nav-row')].map((row) => {
      const parts = {
        sign: row.querySelector('.nav-row-sign, .nav-row-lead > :not(button), .nav-row-own > *'),
        title: row.querySelector('.nav-row-title'),
        words: row.querySelector('.nav-row-epic, .nav-row-title'),
        meta: row.querySelector('.nav-row-meta'),
        pin: row.querySelector('.nav-row-pin'),
      }
      const boxes = Object.fromEntries(
        Object.entries(parts).map(([part, node]) => {
          if (!node?.checkVisibility({ visibilityProperty: true })) return [part, null]
          const { bottom, left, right, top } = node.getBoundingClientRect()
          return [part, { bottom, left, right, top }]
        }),
      )
      return {
        ...boxes,
        reference:
          row.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ?? '',
        depth: row.style.getPropertyValue('--nav-row-depth'),
      }
    }),
  ) as Promise<RowBoxes[]>
}

function byLevel(all: RowBoxes[], pick: (row: RowBoxes) => number | null) {
  const levels = new Map<string, { reference: string; value: number }[]>()
  for (const row of all) {
    const value = pick(row)
    if (value === null) continue
    levels.set(row.depth, [...(levels.get(row.depth) ?? []), { reference: row.reference, value }])
  }
  return levels
}

/** The closed row of the edges frame, which a phone draws without a lead. */
const CLOSED_ROWS = new Set(['MAIN-7'])

/** The lead's width and the gap after it, as an open row's grid gives them. */
function leadRoom(page: Page, within: string) {
  return page.locator(within).evaluate((root) => {
    const row = root.querySelector<HTMLElement>('.nav-row:not(.nav-row-leadless)')
    if (row === null) throw new Error('no open row in the list')
    const style = getComputedStyle(row)
    return {
      gap: Number.parseFloat(style.columnGap),
      lead: Number.parseFloat(style.gridTemplateColumns.split(' ')[0]),
    }
  })
}

/**
 * On a phone a closed row has no lead, so its words stand one lead and gap to the left of the
 * open rows of its level: each closed row is measured against an open row of its level, and the
 * difference must be the lead and gap an open row's grid gives. Elsewhere a level shares one edge.
 */
function titlesOneEdge(all: RowBoxes[], width: number, room: { gap: number; lead: number }) {
  if (width > 760) {
    oneEdge(all, (row) => row.words.left, 'words')
    return
  }
  const closed = all.filter((row) => CLOSED_ROWS.has(row.reference))
  const open = all.filter((row) => !CLOSED_ROWS.has(row.reference))
  expect(closed.length, 'closed rows in the frame').toBeGreaterThan(0)
  oneEdge(open, (row) => row.words.left, 'words')
  for (const row of closed) {
    const peer = open.find((other) => other.depth === row.depth)
    if (peer === undefined)
      throw new Error(`no open row at level ${row.depth} for ${row.reference}`)
    expect(
      Math.abs(peer.words.left - row.words.left - (room.lead + room.gap)),
      `${row.reference} words one lead and gap left of level ${row.depth}`,
    ).toBeLessThanOrEqual(1)
  }
}

function oneEdge(all: RowBoxes[], pick: (row: RowBoxes) => number | null, what: string) {
  const levels = byLevel(all, pick)
  expect(levels.size).toBeGreaterThan(0)
  for (const [depth, values] of levels) {
    const first = values[0].value
    for (const { reference, value } of values)
      expect(Math.abs(value - first), `${what} of ${reference} at level ${depth}`).toBeLessThan(0.5)
  }
}

for (const width of [1280, 390])
  test(`every row's words start at one edge whatever its number’s length, at ${width}`, async ({
    page,
  }) => {
    const within = await open(page, width)
    const all = await rows(page, within)
    const numbers = await page
      .locator(within)
      .evaluate((root) =>
        [...root.querySelectorAll('.nav-row-number')].map((node) => node.textContent?.length),
      )
    // The fixture puts numbers of one, two and three digits side by side, and an epic's
    // title before some rows' own.
    expect(new Set(numbers)).toEqual(new Set([1, 2, 3]))
    expect(await page.locator(`${within} .nav-row-epic`).count()).toBeGreaterThan(0)
    titlesOneEdge(all, width, await leadRoom(page, within))
  })

/** Whatever lies over a point of the focused row's ring, above its link, and draws there. */
function overTheRing(page: Page) {
  return page.evaluate(() => {
    const link = document.activeElement
    const row = link?.closest('.nav-row')
    if (!link?.matches('.nav-row-link:focus-visible') || !row) return ['no focused row']
    const { bottom, left, right, top } = row.getBoundingClientRect()
    const across = [0.1, 0.3, 0.5, 0.7, 0.9].map((part) => left + (right - left) * part)
    const down = [0.25, 0.5, 0.75].map((part) => top + (bottom - top) * part)
    // One pixel inside each side: the middle of a two-pixel ring drawn two pixels in.
    const points = [
      ...across.map((x) => [x, top + 1]),
      ...across.map((x) => [x, bottom - 1]),
      ...down.map((y) => [left + 1, y]),
      ...down.map((y) => [right - 1, y]),
    ]
    // A forced palette keeps a ground's alpha, so a clear ground reads as any colour at 0.
    const clear = /^transparent$|,\s*0\)$/u
    const drawn: string[] = []
    for (const [x, y] of points) {
      const stack = document.elementsFromPoint(x, y)
      for (const node of stack.slice(0, stack.indexOf(link))) {
        const style = getComputedStyle(node)
        const ground = !clear.test(style.backgroundColor)
        const edge = style.borderTopStyle !== 'none' && Number.parseFloat(style.borderTopWidth) > 0
        if (ground || edge || node instanceof SVGElement)
          drawn.push(`${node.getAttribute('class')} at ${Math.round(x)},${Math.round(y)}`)
      }
    }
    // Nothing else in the list that is not focused draws a box of its own.
    for (const button of row.closest('.nav-tree')?.querySelectorAll('button') ?? [])
      if (
        button !== link &&
        button.checkVisibility({ visibilityProperty: true }) &&
        !clear.test(getComputedStyle(button).backgroundColor)
      )
        drawn.push(`${button.getAttribute('class')} draws a ground`)
    return drawn
  })
}

/** Tab through the rail's list and read, on every row the keyboard reaches, what covers its ring. */
async function ringsAlongTheList(page: Page) {
  await page.locator('.nav-entry-fold').focus()
  const seen: string[] = []
  const covered: Record<string, string[]> = {}
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press('Tab')
    const reference = await page.evaluate(() => {
      const active = document.activeElement
      if (!active?.closest('.nav-work-list')) return 'out'
      return active.matches('.nav-row-link')
        ? (active.getAttribute('aria-label')?.split(' ')[0] ?? '')
        : ''
    })
    if (reference === 'out') break
    if (reference === '') continue
    seen.push(reference)
    const drawn = await overTheRing(page)
    if (drawn.length > 0) covered[reference] = drawn
  }
  return { covered, seen }
}

for (const forcedColors of ['none', 'active'] as const)
  test(`a keyboard ring on any row is whole and nothing unfocused draws a box, forced colours ${forcedColors}`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors })
    await open(page, 1280)
    const { covered, seen } = await ringsAlongTheList(page)
    expect(covered).toEqual({})
    expect(seen).toEqual(expect.arrayContaining(['MAIN-4', 'MAIN-12', 'MAIN-20', 'MAIN-118']))
  })

/**
 * Bring the pin up on every item's row of the rail with the pointer, and say where it covers
 * the title's end or the count, where the title is cut without an ellipsis, and where it
 * stands apart from the pinned row's pin. A session's own row has no pin.
 */
async function pinsUnderThePointer(page: Page) {
  const before = await rows(page, RAIL)
  const pinned = before.find((row) => row.reference === 'MAIN-20')?.pin
  if (!pinned) return ['no pinned pin']
  const wrong: string[] = []
  for (const { reference } of before.filter((row) => /-\d+$/u.test(row.reference))) {
    const row = liveRow(page, reference)
    await row.hover()
    const now = await rows(page, RAIL)
    const shown = now.find((each) => each.reference === reference)
    const pin = shown?.pin
    if (!shown || !pin) {
      wrong.push(`${reference}: no pin in sight`)
      continue
    }
    if (shown.title.right > pin.left + 0.5) wrong.push(`${reference}: pin over the title`)
    if (shown.meta && shown.meta.right > pin.left) wrong.push(`${reference}: pin over the count`)
    const cut = await row.locator('.nav-row-title').evaluate((node) => ({
      over: node.scrollWidth > node.clientWidth,
      ellipsis: getComputedStyle(node).textOverflow,
    }))
    if (cut.over && cut.ellipsis !== 'ellipsis') wrong.push(`${reference}: cut with no ellipsis`)
    if (Math.abs(pin.left - pinned.left) > 0.5 || Math.abs(pin.right - pinned.right) > 0.5)
      wrong.push(
        `${reference}: pin at ${pin.left}..${pin.right}, pinned at ${pinned.left}..${pinned.right}`,
      )
  }
  return wrong
}

test('the pin under the pointer leaves the title’s ellipsis and the count in sight, on every row', async ({
  page,
}) => {
  await open(page, 1280)
  expect(await pinsUnderThePointer(page)).toEqual([])
  // The long titles are cut, so the ellipsis was asked of more than one row.
  const over = await page
    .locator(`${RAIL} .nav-row-title`)
    .evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length)
  expect(over).toBeGreaterThan(1)
})

for (const width of [1280, 390])
  test(`a pinned row’s pin takes the press and takes the pin off, at ${width}`, async ({
    page,
  }) => {
    const within = await open(page, width)
    // After the backend's routes, which would otherwise answer the pin first.
    const sent = await servePins(page, () => busyFrame())
    // The link's box is stretched over the row; the pin stands above it, not under.
    await liveRow(page, 'MAIN-20', within).locator('.nav-row-pin').click({ timeout: 3000 })
    await expect.poll(() => sent).toEqual([{ id: 'MAIN-20', pinned: false }])
  })

const signCentre = (row: RowBoxes) => (row.sign ? (row.sign.left + row.sign.right) / 2 : null)

for (const width of [1280, 390])
  test(`an epic at work carries its sign in the sign column every row does, at ${width}`, async ({
    page,
  }) => {
    const within = await open(page, width)
    await page.mouse.move(width - 10, 10)
    const all = await rows(page, within)
    const epic = all.find((row) => row.reference === 'MAIN-4')
    expect(epic?.sign, 'the epic’s own sign').toBeTruthy()
    oneEdge(all, signCentre, 'sign')
    // It is a row like its tasks, with no fold of its own.
    await expect(liveRow(page, 'MAIN-4', within).locator('button:not(.nav-row-pin)')).toHaveCount(0)
  })

/** Where a box starts, or a failure naming what is missing. */
async function startOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`${locator.toString()} is not drawn`)
  return box.x
}

test('the empty list starts its line where «Work» starts its label, and the panel under its heading', async ({
  page,
}) => {
  await open(page, 1280, liveFrame([]))
  const words = page.locator(`${RAIL} .nav-tree-note-words`)
  await expect(words).toHaveText('Nobody is working right now')
  const label = await startOf(page.locator('.nav-item.module-planning .nav-item-label'))
  expect(Math.abs((await startOf(words)) - label)).toBeLessThan(0.5)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.nav-work-rail').click()
  const panel = page.getByRole('dialog', { name: 'Work' })
  await settled(panel)
  const heading = await startOf(panel.getByRole('heading', { name: 'Work' }))
  const line = await startOf(panel.locator('.nav-tree-note-words'))
  expect(Math.abs(line - heading)).toBeLessThan(0.5)
})

test('the panel’s heading starts where its spaces’ names do, and every fold is a finger’s size', async ({
  page,
}) => {
  await open(page, 390)
  const panel = page.getByRole('dialog', { name: 'Work' })
  const heading = await startOf(panel.getByRole('heading', { name: 'Work' }))
  const names = await panel
    .locator('.nav-tree-space-name')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left))
  expect(names.length).toBeGreaterThan(1)
  for (const name of names) expect(Math.abs(name - heading)).toBeLessThan(0.5)
  const folds = await panel.locator('.nav-tree-fold').evaluateAll((nodes) =>
    nodes.map((node) => {
      const { height, width } = node.getBoundingClientRect()
      return { label: node.getAttribute('aria-label') ?? '', height, width }
    }),
  )
  expect(folds.length).toBeGreaterThan(1)
  for (const fold of folds) expect(fold, fold.label).toMatchObject({ width: 44, height: 44 })
  // Each fold of the rest of the work is a row, a finger's height across the panel.
  const rest = await panel
    .locator('.nav-fold-toggle')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  expect(rest.length).toBeGreaterThan(1)
  for (const height of rest) expect(height).toBe(44)
})
