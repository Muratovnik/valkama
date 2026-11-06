/**
 * A forced palette clears every ground. Whatever the board told apart by its ground alone —
 * a tile from its column, a column from the next, a chip from the words beside it — draws
 * an edge in the palette's ink instead, or its bounds go with the ground.
 *
 * Every element is read twice: in the product's own palette, for the ones whose ground
 * differs from what lies under them and that draw no edge of their own; and in the forced
 * palette, for an edge those ones now draw. The pixels of each kind's edge are read as well,
 * on two sides, because a computed style says what was asked for, not what was painted: the
 * panel under the board asked for its edge and something opaque inside it was drawn over it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, openList, serve } from './boardPage.ts'
import { test } from './test.ts'

/** Marks every visible element that is told apart by its ground alone; returns how many. */
const markGroundOnly = () => {
  // Serialized into the page, so neither can live at module scope.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const opaque = (colour: string) => {
    const parts = colour.match(/[\d.]+/gu)?.map(Number) ?? []
    return parts.length > 0 && (parts.length < 4 || (parts[3] ?? 0) > 0)
  }
  const behind = (node: Element) => {
    for (let up = node.parentElement; up; up = up.parentElement) {
      const colour = getComputedStyle(up).backgroundColor
      if (opaque(colour)) return colour
    }
    return ''
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const edged = (style: CSSStyleDeclaration) =>
    ['top', 'right', 'bottom', 'left'].some(
      (side) =>
        Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
        style.getPropertyValue(`border-${side}-style`) !== 'none',
    ) ||
    (Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none')
  let marked = 0
  for (const node of document.querySelectorAll<HTMLElement>('body *')) {
    delete node.dataset.groundOnly
    const box = node.getBoundingClientRect()
    if (box.width < 16 || box.height < 16 || !node.checkVisibility()) continue
    const style = getComputedStyle(node)
    if (!opaque(style.backgroundColor) || style.backgroundColor === behind(node)) continue
    if (edged(style)) continue
    node.dataset.groundOnly = String(node.className)
    marked += 1
  }
  return marked
}

/** The marked elements that draw no edge in the forced palette, by class. */
const unbounded = () =>
  [...document.querySelectorAll<HTMLElement>('[data-ground-only]')].flatMap((node) => {
    const style = getComputedStyle(node)
    const sides = ['top', 'right', 'bottom', 'left'].filter(
      (side) =>
        Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
        style.getPropertyValue(`border-${side}-style`) !== 'none',
    )
    const outlined = Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none'
    return outlined || sides.length > 0 || style.forcedColorAdjust === 'none'
      ? []
      : [node.dataset.groundOnly ?? '']
  })

/** What the forced palette leaves without bounds, and what the product's own palette marked. */
async function sweep(page: Page) {
  await page.emulateMedia({ forcedColors: 'none' })
  await page.mouse.move(0, 0)
  await page.evaluate(`(${markGroundOnly.toString()})()`)
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-ground-only]')].map(
      (node) => node.dataset.groundOnly ?? '',
    ),
  )
  await page.emulateMedia({ forcedColors: 'active' })
  const lost = (await page.evaluate(`(${unbounded.toString()})()`)) as string[]
  return { kinds, lost: [...new Set(lost)] }
}

/**
 * The colours along six pixels of a screenshot, from where an element's box starts inward:
 * across its left side at the height of its middle, or down its top side at its middle.
 * A pixel is what the palette painted, where a computed style says only what was asked for.
 */
async function pixelsIn(page: Page, what: Locator, side: 'left' | 'top') {
  await what.scrollIntoViewIfNeeded()
  const box = await what.boundingBox()
  if (!box) throw new Error('nothing to read the edge of')
  const x = Math.round(box.x + (side === 'top' ? box.width / 2 : 0))
  const y = Math.round(side === 'top' ? box.y : box.y + Math.min(box.height / 2, 60))
  const shot = await page.screenshot({
    clip: { x, y, width: side === 'top' ? 1 : 6, height: side === 'top' ? 6 : 1 },
  })
  const blank = await page.context().newPage()
  const run = await blank.evaluate(async (data) => {
    const picture = new Image()
    picture.src = `data:image/png;base64,${data}`
    await picture.decode()
    const surface = new OffscreenCanvas(picture.width, picture.height)
    const paint = surface.getContext('2d')
    paint?.drawImage(picture, 0, 0)
    const pixels = paint?.getImageData(0, 0, picture.width, picture.height).data ?? []
    return Array.from({ length: 6 }, (_, at) =>
      [pixels[at * 4], pixels[at * 4 + 1], pixels[at * 4 + 2]].join(','),
    )
  }, shot.toString('base64'))
  await blank.close()
  return run
}

const lightness = (colour = '') => colour.split(',').reduce((sum, part) => sum + Number(part), 0)

/**
 * Whether the first visible element of each kind draws its edge on its left and its top: the
 * first pixel in from its box stands apart from what lies just inside it, in a light palette
 * or a dark one. The panel the board lies on asked for an edge and lost it under the board's
 * own opaque ground, so every kind is read, and on two sides.
 */
async function drawnEdges(page: Page, kinds: string[]) {
  const lost: string[] = []
  for (const kind of kinds)
    for (const side of ['left', 'top'] as const) {
      const run = await pixelsIn(page, page.locator(`.${kind}:visible`).first(), side)
      const step = Math.max(
        ...run.slice(1).map((colour) => Math.abs(lightness(colour) - lightness(run[0]))),
      )
      if (step < 300) lost.push(`${kind} ${side}: ${run.join(' ')}`)
    }
  return lost
}

test('in the forced palette the board keeps the bounds its grounds drew', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)

  // The flat board: its columns, its tiles, the stage they lie on and the chips in its bar.
  await openBoard(page, {})
  const flat = await sweep(page)
  for (const kind of ['work-item-column', 'work-item-tile', 'toggle-chip', 'module-stage'])
    expect(flat.kinds.join(' '), `${kind} is told apart by its ground`).toContain(kind)
  expect.soft(flat.lost, 'the flat board').toEqual([])
  const surfaces = ['module-stage', 'work-item-column', 'work-item-tile', 'toggle-chip']
  expect.soft(await drawnEdges(page, surfaces), 'edges drawn on the flat board').toEqual([])

  // By epic: the cells that hold tiles.
  await page.emulateMedia({ forcedColors: 'none' })
  await openBoard(page)
  const lanes = await sweep(page)
  expect(lanes.kinds.join(' ')).toContain('lane-cell')
  expect.soft(lanes.lost, 'the board by epic').toEqual([])
  const laneSurfaces = ['module-stage', 'lane-cell:not(.bare)', 'work-item-tile']
  expect.soft(await drawnEdges(page, laneSurfaces), 'edges drawn by epic').toEqual([])

  // A label picked in the filter, and the menu's choice between all and any of them.
  await page.emulateMedia({ forcedColors: 'none' })
  await openBoard(page, { labels: 'coordinator' })
  await page.getByRole('combobox', { name: 'Filter work' }).click()
  await expect(page.locator('.option-choices')).toBeVisible()
  const filtered = await sweep(page)
  for (const kind of ['filter-chip', 'option-choices'])
    expect(filtered.kinds.join(' '), `${kind} is told apart by its ground`).toContain(kind)
  expect.soft(filtered.lost, 'the filtered board').toEqual([])
  const picked = ['filter-chip', 'option-choices']
  expect.soft(await drawnEdges(page, picked), 'edges drawn on the filtered board').toEqual([])

  // The chain the board is narrowed to.
  await page.emulateMedia({ forcedColors: 'none' })
  await openBoard(page, { chain: 'MAIN-401', chain_scope: 'chain' })
  const chained = await sweep(page)
  expect(chained.kinds.join(' ')).toContain('scope-chip')
  expect.soft(chained.lost, 'the board narrowed to a chain').toEqual([])
  expect.soft(await drawnEdges(page, ['scope-chip']), 'the chain chip’s edge').toEqual([])

  // The list.
  await page.emulateMedia({ forcedColors: 'none' })
  await openList(page)
  const list = await sweep(page)
  expect(list.kinds.join(' ')).toContain('work-item-list')
  expect.soft(list.lost, 'the list').toEqual([])
  const listSurfaces = ['module-stage', 'work-item-list']
  expect.soft(await drawnEdges(page, listSurfaces), 'edges drawn on the list').toEqual([])
})

test('on a phone in the forced palette the board draws the same edges', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  await page.mouse.move(0, 0)
  const flat = ['module-stage', 'work-item-column', 'work-item-tile']
  expect.soft(await drawnEdges(page, flat), 'the flat board').toEqual([])
  await openBoard(page)
  await page.mouse.move(0, 0)
  const lanes = ['module-stage', 'lane-cell:not(.bare)', 'work-item-tile']
  expect.soft(await drawnEdges(page, lanes), 'the board by epic').toEqual([])
})

test('in the forced palette the connection’s dot stays, the one mark of a narrow rail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  const dot = page.locator('.nav-refresh .connection-dot')
  await expect(dot).toBeVisible()
  // The palette paints the button's words in its ink; the dot is drawn in the same ink,
  // where the palette left to itself clears it to the ground it lies on.
  const [fill, ink] = await dot.evaluate((node) => [
    getComputedStyle(node).backgroundColor,
    getComputedStyle(node.closest('button') ?? node).color,
  ])
  expect(fill, 'the dot is drawn in the palette’s ink').toBe(ink)
})

test('in the forced palette a tile the keyboard reached keeps its edge and rings apart from it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  await page.mouse.move(0, 0)
  const tile = page.locator('.work-item-tile').first()
  const rest = await pixelsIn(page, tile, 'left')
  await page.keyboard.press('Tab')
  await tile.locator('.tile-open').focus()
  await expect(tile.locator('.tile-open')).toBeFocused()
  const focused = await pixelsIn(page, tile, 'left')

  // The edge stays where it was; a ring in the edge's ink, laid on it, only made it thicker.
  expect(focused[0], `the edge at rest ${rest.join(' ')}, focused ${focused.join(' ')}`).toBe(
    rest[0],
  )
  const ring = focused.slice(1).findIndex((colour) => lightness(colour) > 300) + 1
  expect(ring, `a ring inside the edge: ${focused.join(' ')}`).toBeGreaterThan(1)
  expect(lightness(focused[ring - 1]), 'ground between the edge and the ring').toBeLessThan(100)
  expect(focused[ring], 'the ring in a colour of its own').not.toBe(focused[0])
})
