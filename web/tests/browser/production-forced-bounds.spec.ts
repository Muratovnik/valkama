/**
 * A forced palette clears every ground. Whatever the board told apart by its ground alone —
 * a tile from its column, a column from the next, a chip from the words beside it — draws
 * an edge in the palette's ink instead, or its bounds go with the ground.
 *
 * Every element is read twice: in the product's own palette, for the ones whose ground
 * differs from what lies under them and that draw no edge of their own; and in the forced
 * palette, for an edge those ones now draw. The pixels of one tile's edge are read as well,
 * because a computed style says what was asked for, not what the palette painted.
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

/** How far apart, in lightness, an element's drawn edge and the ground just inside it are. */
async function edgeStep(page: Page, what: Locator) {
  const box = await what.boundingBox()
  if (!box) throw new Error('nothing to read the edge of')
  const shot = await page.screenshot({
    clip: { x: box.x, y: box.y + box.height / 2, width: 6, height: 1 },
  })
  const blank = await page.context().newPage()
  const row = await blank.evaluate(async (data) => {
    const picture = new Image()
    picture.src = `data:image/png;base64,${data}`
    await picture.decode()
    const surface = new OffscreenCanvas(picture.width, picture.height)
    const paint = surface.getContext('2d')
    paint?.drawImage(picture, 0, 0)
    const pixels = paint?.getImageData(0, 0, picture.width, 1).data ?? []
    return Array.from(
      { length: picture.width },
      (_, at) => (pixels[at * 4] ?? 0) + (pixels[at * 4 + 1] ?? 0) + (pixels[at * 4 + 2] ?? 0),
    )
  }, shot.toString('base64'))
  await blank.close()
  return Math.abs((row[0] ?? 0) - (row[4] ?? 0))
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
  // Painted, not only asked for: the tile's first column of pixels is the palette's ink.
  expect.soft(await edgeStep(page, page.locator('.work-item-tile').first())).toBeGreaterThan(300)

  // By epic: the cells that hold tiles.
  await page.emulateMedia({ forcedColors: 'none' })
  await openBoard(page)
  const lanes = await sweep(page)
  expect(lanes.kinds.join(' ')).toContain('lane-cell')
  expect.soft(lanes.lost, 'the board by epic').toEqual([])

  // A label picked in the filter, and the menu's choice between all and any of them.
  await page.emulateMedia({ forcedColors: 'none' })
  await openBoard(page, { labels: 'coordinator' })
  await page.getByRole('combobox', { name: 'Filter work' }).click()
  await expect(page.locator('.option-choices')).toBeVisible()
  const filtered = await sweep(page)
  for (const kind of ['filter-chip', 'option-choices'])
    expect(filtered.kinds.join(' '), `${kind} is told apart by its ground`).toContain(kind)
  expect.soft(filtered.lost, 'the filtered board').toEqual([])

  // The chain the board is narrowed to.
  await page.emulateMedia({ forcedColors: 'none' })
  await openBoard(page, { chain: 'MAIN-401', chain_scope: 'chain' })
  const chained = await sweep(page)
  expect(chained.kinds.join(' ')).toContain('scope-chip')
  expect.soft(chained.lost, 'the board narrowed to a chain').toEqual([])

  // The list.
  await page.emulateMedia({ forcedColors: 'none' })
  await openList(page)
  const list = await sweep(page)
  expect(list.kinds.join(' ')).toContain('work-item-list')
  expect.soft(list.lost, 'the list').toEqual([])
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
