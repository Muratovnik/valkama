/**
 * The whole words of a text a clamp cuts to its lines cover every line it shows, in the built app.
 * A card's title on the graph is clamped to two lines and a frame's to three. Laid from the first
 * letter, the whole words ran on to the window's edge on one line, over the first line alone: at
 * a zoom of 0.75 and 0.625 the clamp's second line and its ellipsis showed under them, and the
 * title read twice. Now the whole words are as high and wide as the lines the clamp shows, at
 * every zoom, their first letter still on the cut text's.
 *
 * Every other text a clamp cuts takes the same whole words, where it had none and so could not be
 * read whole where it stands: a board tile's title at three lines, an outcome's preview on the card
 * and a title in the task finder at two. A text its clamp leaves whole shows none.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { markCut, openCutField, openRead, standing } from './cutFieldPage.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { openFinder } from './finderPage.ts'
import { settledZoom, zoomOutButton } from './graphFieldCamera.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * What of the marked cut text shows outside the whole words: its box, whose lines and ellipsis
 * the clamp shows, and each of its lines that the clamp lets show. A pixel of rim is no gap.
 */
const uncovered = (page: Page) =>
  page.evaluate(() => {
    const cut = document.querySelector('[data-probe-cut]')
    const laid = document.querySelector('.whole-text')?.getBoundingClientRect()
    if (!cut || !laid) return ['no whole words over a cut text']
    const clamp = cut.getBoundingClientRect()
    const outside = (box: DOMRect) =>
      box.left < laid.left - 1 ||
      box.right > laid.right + 1 ||
      box.top < laid.top - 1 ||
      box.bottom > laid.bottom + 1
    const found: string[] = []
    if (outside(clamp))
      found.push(
        `the clamp's box ${JSON.stringify(clamp)} past the whole words ${JSON.stringify(laid)}`,
      )
    const range = document.createRange()
    range.selectNodeContents(cut)
    for (const line of range.getClientRects()) {
      // What the clamp lets show of the line: the lines past its last are laid out and hidden.
      const shown = new DOMRect(
        Math.max(line.left, clamp.left),
        Math.max(line.top, clamp.top),
        Math.min(line.right, clamp.right) - Math.max(line.left, clamp.left),
        Math.min(line.bottom, clamp.bottom) - Math.max(line.top, clamp.top),
      )
      if (shown.width > 1 && shown.height > 1 && outside(shown))
        found.push(`a line ${JSON.stringify(shown)} past the whole words ${JSON.stringify(laid)}`)
    }
    return found
  })

/** Brings the field from the zoom it opens at to `zoom`: a button's step, or the wheel's. */
async function zoomTo(page: Page, zoom: number) {
  const opened = await settledZoom(page)
  expect(opened, 'the field opens at its reading zoom').toBeCloseTo(0.75, 2)
  if (zoom < opened) await zoomOutButton(page).click()
  for (let step = opened; step < zoom - 0.01; step *= 1.2) {
    if (zoom === 1) {
      // The wheel zooms by two to the power of its delta times 0.002: 0.75 to 1 is -207.5.
      const view = await page.locator('.graph-flow').boundingBox()
      await page.mouse.move((view?.x ?? 0) + 20, (view?.y ?? 0) + 20)
      await page.mouse.wheel(0, Math.log2(opened / zoom) / 0.002)
      break
    }
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await settledZoom(page)
  }
  expect(await settledZoom(page)).toBeCloseTo(zoom, 2)
}

/** Rests on the first cut text of `selector` in sight, and reads its whole words against it. */
async function restOnCut(page: Page, selector?: string) {
  const point = await markCut(page, selector)
  expect(point, 'a text the clamp cuts, in sight').not.toBeNull()
  await page.mouse.move(point?.x ?? 0, point?.y ?? 0)
  await expect(page.locator('.whole-text')).toBeVisible()
  await expect.poll(() => standing(page)).toBe('on its text')
  return uncovered(page)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
})

for (const zoom of [0.625, 0.75, 1, 1.296]) {
  test(`at a zoom of ${zoom} the whole words of a card's title cover both lines its clamp shows`, async ({
    page,
  }) => {
    await openCutField(page, 1440)
    await zoomTo(page, zoom)
    expect(await restOnCut(page)).toEqual([])
  })
}

/** Long enough that a frame's header cuts it at its third line. */
const FRAME_LONGER =
  ': a title that runs on past the three lines a frame gives it, and on past them again, and on once more'

// At its own size, and at the reading zoom the field opens at.
for (const zoom of [1, 0.75]) {
  test(`at a zoom of ${zoom} the whole words of a frame’s title cover the three lines its clamp shows`, async ({
    page,
  }) => {
    await openCutField(page, 1440, FRAME_LONGER)
    await zoomTo(page, zoom)
    expect(await restOnCut(page, '.graph-frame-title')).toEqual([])
  })
}

/** The whole words laid over a cut text. */
const whole = (page: Page) => page.locator('.whole-text')

/**
 * Marks `clamp`, a text its clamp must cut, and returns where its first letter's middle is, or
 * null where the clamp leaves it whole: the whole words over it would prove nothing.
 */
async function markClamp(clamp: Locator) {
  await clamp.scrollIntoViewIfNeeded()
  return clamp.evaluate((element: HTMLElement) => {
    if (element.scrollHeight <= element.clientHeight + 1) return null
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      const at = text.data.search(/\S/u)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      const { left, top, width, height } = range.getBoundingClientRect()
      element.dataset.probeCut = ''
      return { x: left + width / 2, y: top + height / 2 }
    }
    return null
  })
}

/** The pointer away from everything, then resting on `point` past the wait of a hint. */
async function restAt(page: Page, point: { x: number; y: number }) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await expect(whole(page)).toHaveCount(0)
  await page.mouse.move(point.x, point.y)
  await page.clock.runFor(1000)
}

/** The whole words `words` are up, on the marked cut text's first letter and over all of it. */
async function expectLaid(page: Page, words: string) {
  await expect(whole(page)).toBeVisible()
  await expect(whole(page)).toHaveText(words)
  await expect.poll(() => standing(page)).toBe('on its text')
  expect(await uncovered(page)).toEqual([])
}

/** The pointer resting on the first letter of `clamp`, which its clamp cuts: its whole words show. */
async function expectWholeOver(page: Page, clamp: Locator, words: string) {
  const point = await markClamp(clamp)
  expect(point, 'a text its clamp cuts, in sight').not.toBeNull()
  await restAt(page, point ?? { x: 0, y: 0 })
  await expectLaid(page, words)
}

/** The pointer resting on `clamp`, a text its clamp leaves whole: no whole words show. */
async function expectNoneOver(page: Page, clamp: Locator) {
  await clamp.scrollIntoViewIfNeeded()
  expect(await markClamp(clamp), 'a text its clamp leaves whole').toBeNull()
  const box = (await clamp.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  await restAt(page, { x: box.x + 4, y: box.y + box.height / 2 })
  await expect(whole(page)).toHaveCount(0)
}

/**
 * Points on `tile` off its title, each named: its ground beside the title and under it, where
 * the open target stretched over the tile is the target, and the middle of each of its marks.
 */
const groundOf = (tile: Locator) =>
  tile.evaluate((element) => {
    const sheet = element.getBoundingClientRect()
    const title = element.querySelector('.tile-title')?.getBoundingClientRect() ?? sheet
    const marks = ['.tile-lead', '.tile-exceptions', '.tile-labels', '.tile-facts'].flatMap(
      (name) => {
        const mark = element.querySelector(name)?.getBoundingClientRect()
        return mark && mark.width > 0 && mark.height > 0
          ? [{ name, x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }]
          : []
      },
    )
    const grounds = [
      { name: 'beside the title', x: sheet.left + 3, y: title.top + title.height / 2 },
      { name: 'under the title', x: title.left + title.width / 2, y: sheet.bottom - 3 },
    ]
    return { grounds, marks }
  })

/** What the window has at `point`: the tile's open target, or something else. */
const targetAt = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y)?.closest('.tile-open') ? 'open target' : 'else'),
    point,
  )

/** Longer than three lines of a board column, and than two lines of the card or the finder. */
const LONG_TITLE =
  'Read an attached planning store that an older build wrote without migrating it, name every scope the read had to skip instead of dropping it, and say which of them a newer build can still open'

/** The board, the item `workItemRef` names under `LONG_TITLE` and `MAIN-265` under its short one. */
const openBoard = (page: Page, width: number) =>
  openRead(
    page,
    width,
    serializePlatformRoute({ module_id: 'planning', scope: projectScope }),
    (read) => {
      for (const item of read.work_items as { reference: string; title: string }[])
        if (item.reference === workItemRef.reference) item.title = LONG_TITLE
    },
  )

/**
 * The whole words laid over the marked cut text, against the clamp that cuts it: the content
 * width and height of each and its line's height, how many lines the whole words take, and how
 * far past the window's edges their box stands. Either missing fails the reading.
 */
const wholeAgainstClamp = (page: Page) =>
  page.evaluate(() => {
    const clamp = document.querySelector<HTMLElement>('[data-probe-cut]')
    const laid = document.querySelector<HTMLElement>('.whole-text')
    if (!clamp || !laid) throw new Error('no whole words over the marked clamp')
    const inner = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      const inset = (side: 'Left' | 'Right' | 'Top' | 'Bottom') =>
        Number.parseFloat(style[`padding${side}`]) + Number.parseFloat(style[`border${side}Width`])
      return {
        width: box.width - inset('Left') - inset('Right'),
        height: box.height - inset('Top') - inset('Bottom'),
        line: Number.parseFloat(style.lineHeight),
      }
    }
    const range = document.createRange()
    range.selectNodeContents(laid)
    const tops = new Set(
      [...range.getClientRects()]
        .filter((line) => line.width > 0)
        .map((line) => Math.round(line.top)),
    )
    const box = laid.getBoundingClientRect()
    const { clientHeight, clientWidth } = document.documentElement
    return {
      clamp: inner(clamp),
      whole: inner(laid),
      wholeLines: tops.size,
      past: Math.max(0, -box.left, -box.top, box.right - clientWidth, box.bottom - clientHeight),
    }
  })

const SHORT = 'MAIN-265'

/** What was done, as an agent writes it: markdown, which the preview draws as words. */
const DONE =
  'Shipped **the reader** for an attached store that an older build wrote, kept every scope it could not read in a list of its own instead of dropping it, named each in the card with the build that can still open it, and left the store as it found it'
const DONE_WORDS = DONE.replaceAll('**', '')

/** The card of the item whose outcome is `done`, and the preview of that outcome on it. */
async function outcomePreview(page: Page, done: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const backend = await installDiscussionBackend(page)
  backend.item.summary = { done, next: 'Review' }
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const preview = page.locator('.drawer .outcome-preview-text')
  await expect(preview).toBeVisible()
  return preview
}

test.describe('a clamp off the graph', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install()
  })

  for (const width of [1440, 390])
    test(`at ${width}px a board tile's cut title shows its whole words over its three lines, and a press opens its card`, async ({
      page,
    }) => {
      await openBoard(page, width)
      const tile = (reference: string) =>
        page.locator(`[data-reference="${reference}"] .work-item-tile`)
      await expect(tile(workItemRef.reference)).toBeVisible()
      await expectNoneOver(page, tile(SHORT).locator('.tile-title'))
      await expectWholeOver(page, tile(workItemRef.reference).locator('.tile-title'), LONG_TITLE)
      // The whole words let the press through to the tile, which opens its card.
      await page.mouse.down()
      await page.mouse.up()
      await expect(page.locator('.drawer')).toBeVisible()
    })

  // `LONG_TITLE` takes five lines at the width of a board column's tile title in a 1440px
  // window, 319px, and six at a phone's, 254px; the clamp shows three.
  for (const [width, lines] of [
    [1440, 5],
    [390, 6],
  ] as const)
    test(`at ${width}px the whole words of a tile's title cut at its third line keep its column and take its ${lines} lines`, async ({
      page,
    }) => {
      await openBoard(page, width)
      const tile = page.locator(`[data-reference="${workItemRef.reference}"] .work-item-tile`)
      await expectWholeOver(page, tile.locator('.tile-title'), LONG_TITLE)
      const { clamp, whole, wholeLines, past } = await wholeAgainstClamp(page)
      expect(Math.round(clamp.height / clamp.line), 'the lines the clamp shows').toBe(3)
      expect(wholeLines, 'the lines the whole words take at the width the clamp cut them').toBe(
        lines,
      )
      // As wide as the clamp's column, and as high as its own lines: no empty room under them.
      expect(
        Math.abs(whole.width - clamp.width),
        `${whole.width}px over ${clamp.width}px`,
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(whole.height - lines * whole.line),
        `${whole.height}px for ${lines} lines`,
      ).toBeLessThanOrEqual(1)
      expect(past, 'how far past the window').toBe(0)
    })

  for (const width of [1440, 390])
    test(`at ${width}px a board tile's cut title shows its whole words only while the pointer rests on its lines`, async ({
      page,
    }) => {
      await openBoard(page, width)
      const tile = page.locator(`[data-reference="${workItemRef.reference}"] .work-item-tile`)
      await expect(tile).toBeVisible()
      const letter = await markClamp(tile.locator('.tile-title'))
      expect(letter, 'a title its clamp cuts').not.toBeNull()
      // The open target takes the pointer over the whole tile; off the title it raises nothing.
      const { grounds, marks } = await groundOf(tile)
      expect(marks.map(({ name }) => name)).toContain('.tile-lead')
      for (const ground of grounds) {
        await restAt(page, ground)
        expect(await targetAt(page, ground), `what is ${ground.name}`).toBe('open target')
        await expect(whole(page), `no whole words ${ground.name}`).toHaveCount(0)
      }
      for (const mark of marks) {
        await restAt(page, mark)
        await expect(whole(page), `no whole words on ${mark.name}`).toHaveCount(0)
      }
      // On its lines they rise; moved off them onto the tile's ground, they go after the grace.
      await restAt(page, letter ?? { x: 0, y: 0 })
      await expectLaid(page, LONG_TITLE)
      const [beside = { x: 0, y: 0 }] = grounds
      const laid = (await whole(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
      expect(beside.x, 'the ground beside the title is off the whole words').toBeLessThan(laid.x)
      await page.mouse.move(beside.x, beside.y, { steps: 4 })
      await page.clock.runFor(200)
      await expect(whole(page)).toHaveCount(0)
      await page.clock.runFor(1000)
      await expect(whole(page)).toHaveCount(0)
      // Back on the title, a press through the whole words still opens the card.
      await page.mouse.move(letter?.x ?? 0, letter?.y ?? 0, { steps: 4 })
      await page.clock.runFor(1000)
      await expectLaid(page, LONG_TITLE)
      await page.mouse.down()
      await page.mouse.up()
      await expect(page.locator('.drawer')).toBeVisible()
    })

  for (const width of [1440, 390])
    test(`at ${width}px a board tile's cut title shows its whole words on the focus a key brings, and a whole one none`, async ({
      page,
    }) => {
      await openBoard(page, width)
      const open = (reference: string) => page.locator(`[data-reference="${reference}"] .tile-open`)
      await expect(open(workItemRef.reference)).toBeVisible()
      expect(await markClamp(open(workItemRef.reference).locator('.tile-title'))).not.toBeNull()
      await page.mouse.move(2, 898)
      await open(SHORT).focus()
      await page.keyboard.press('ArrowUp')
      await expect(open(workItemRef.reference)).toBeFocused()
      await expectLaid(page, LONG_TITLE)
      await page.keyboard.press('ArrowDown')
      await expect(open(SHORT)).toBeFocused()
      await page.clock.runFor(1000)
      await expect(whole(page)).toHaveCount(0)
    })

  test("an outcome's preview cut at its two lines shows its whole words, raised to stay in the window", async ({
    page,
  }) => {
    const preview = await outcomePreview(page, DONE)
    await expect(preview).toContainText('Shipped the reader for')
    const point = await markClamp(preview)
    expect(point, 'a text its clamp cuts, in sight').not.toBeNull()
    await restAt(page, point ?? { x: 0, y: 0 })
    await expect(whole(page)).toHaveText(DONE_WORDS)
    expect(await uncovered(page)).toEqual([])
    // At the width the clamp cut them the words take more lines than the 900px window leaves
    // under the preview: they stand higher, their bottom 8px short of the window's, their first
    // letter still level with the cut text's start.
    const laid = await whole(page).evaluate((element) => {
      const { bottom } = element.getBoundingClientRect()
      return { bottom, window: document.documentElement.clientHeight }
    })
    expect(laid.bottom).toBeCloseTo(laid.window - 8, 0)
    await expect.poll(() => standing(page)).toMatch(/^off by -?0\.0, -\d/u)
  })

  test("an outcome's preview left whole shows none", async ({ page }) => {
    const preview = await outcomePreview(page, 'Shipped the reader')
    await expect(preview).toHaveText('Shipped the reader')
    await expectNoneOver(page, preview)
  })

  for (const width of [1440, 390])
    test(`at ${width}px a cut title in the task finder shows its whole words, and the arrows and Enter still choose`, async ({
      page,
    }) => {
      const dialog = await openFinder(page, width, [LONG_TITLE, 'Follow-up', LONG_TITLE])
      const options = dialog.getByRole('option')
      await expectNoneOver(page, options.nth(1).locator('.command-title'))
      await expectWholeOver(page, options.first().locator('.command-title'), LONG_TITLE)
      // The field keeps the focus, and its keys move and choose under the whole words.
      const field = dialog.getByRole('combobox')
      await expect(field).toBeFocused()
      await expect(options.first()).toHaveAttribute('data-highlighted', '')
      await page.keyboard.press('ArrowDown')
      await expect(options.nth(1)).toHaveAttribute('data-highlighted', '')
      await expect(options.first()).not.toHaveAttribute('data-highlighted')
      await expect(field).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeHidden()
      await expect(page).toHaveURL(
        serializePlatformRoute({
          module_id: 'planning',
          scope: projectScope,
          entity: planningWorkItemEntity({ ...workItemRef, reference: 'MAIN-42' }),
        }),
      )
    })
})
