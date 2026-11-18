/**
 * A label hidden whole is not a cut text, in the built app. Where a narrow window leaves the rail
 * its icons alone and the board's action its sign, their labels stay in the page for a reader and
 * are hidden from sight; the hint of such a control names it beside it, as an icon's name does,
 * and none of its words are laid over it. At a wide window the same labels stand whole and the
 * controls show no hint.
 *
 * The whole of a cut text is laid from the first letter of its words on screen. A hidden label
 * has none: laid from the pixel its box keeps, the words of the rail's «Work» stood over the
 * icon in a block 33px wide that broke the word in the middle of its letters, and «New work» was
 * laid from the «+» sign before it. Every cut text on the board is pointed at besides, and the
 * whole words of each one laid start on a letter of its words a reader sees.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { test } from './test.ts'

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/** The rail's controls whose labels the narrow window hides, with the label each holds. */
const RAIL = [
  { control: '.nav-item.module-planning', label: '.nav-item-label' },
  { control: 'button.work-action', label: '.action-label' },
] as const
/** The board's action, whose label the narrow window hides behind its sign. */
const ACTION = { control: 'button.workspace-action', label: '.workspace-action-text' } as const

const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((node) => {
    const { bottom, left, right, top } = node.getBoundingClientRect()
    return { bottom, left, right, top }
  })

/** Whether two boxes share more than the pixel a border meets on. */
const overlaps = (one: Box, other: Box) =>
  Math.min(one.right, other.right) - Math.max(one.left, other.left) > 1 &&
  Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top) > 1

/** Rests the pointer on `on`, from a place with no hint, until a hint would have shown. */
async function rest(page: Page, on: Locator | [number, number]) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await page.clock.runFor(1000)
  if (Array.isArray(on)) await page.mouse.move(...on)
  else await on.hover()
  await page.clock.runFor(1000)
}

/**
 * Where the whole words laid over `anchor` start against the first letter of its words that a
 * reader sees: a letter not hidden from assistive technology, in a box larger than a pixel, and
 * inside the anchor's own box. Null where no whole words are laid; `seen` null where the anchor
 * shows no such letter.
 */
const laidFrom = (anchor: Locator) =>
  anchor.evaluate((element) => {
    const firstLetter = (root: Element, seenOnly: boolean) => {
      const own = root.getBoundingClientRect()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        const inked = text.parentElement
        const at = text.data.search(/\S/u)
        if (!inked || at < 0) continue
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        const box = range.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue
        if (!seenOnly) return box
        const hidden = inked.closest('[aria-hidden="true"], .visually-hidden')
        const kept = inked.getBoundingClientRect()
        const [x, y] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2]
        const inside = x > own.left && x < own.right && y > own.top && y < own.bottom
        if (!(hidden && root.contains(hidden)) && kept.width > 1 && kept.height > 1 && inside)
          return box
      }
      return null
    }
    const whole = document.querySelector('.whole-text')
    if (!whole) return null
    const laid = firstLetter(whole, false)
    const seen = firstLetter(element, true)
    return {
      seen: seen && laid ? { x: laid.left - seen.left, y: laid.top - seen.top } : null,
      text: whole.textContent?.trim() ?? '',
    }
  })

/** Shows the hint of `control` and reads where it stands, after checking no words were laid. */
async function hiddenHint(page: Page, { control, label }: { control: string; label: string }) {
  const element = page.locator(control).first()
  const words = await element.locator(label).textContent()
  await rest(page, element)
  await expect(page.locator('.whole-text'), `${control}: no words laid over it`).toHaveCount(0)
  const hint = page.locator('.tooltip-hint')
  // The hint is its own tooltip and says the hidden words once.
  await expect(hint, control).toHaveAttribute('role', 'tooltip')
  await expect(hint, control).toHaveText(words?.trim() ?? '')
  const [own, shown] = await Promise.all([boxOf(element), boxOf(hint)])
  expect(overlaps(own, shown), `${control}: over its own element`).toBe(false)
  return { own, shown }
}

/** The kinds of cut text the sweep names, each by a class the element carries anywhere in its list. */
const CUT_KINDS = ['nav-item', 'work-action', 'lane-title']

/**
 * Points at a few of each kind of cut text on the page, and lists each whole text laid from
 * anywhere but a letter of its words a reader sees. A kind is one of `CUT_KINDS` the element
 * carries, else its classes in any order: never the class that happens to come first.
 */
async function sweepCut(page: Page) {
  const SAMPLE = 3
  const anchors = page.locator('[data-tooltip-kind="clipped"]')
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const sampled = new Map<string, number>()
  const wrong: string[] = []
  let laid = 0
  for (let index = 0, count = await anchors.count(); index < count; index += 1) {
    const anchor = anchors.nth(index)
    const kind = await anchor.evaluate(
      (node, kinds) =>
        kinds.find((each) => node.classList.contains(each)) ??
        ([...node.classList].toSorted().join('.') || node.tagName),
      CUT_KINDS,
    )
    const box = await anchor.boundingBox()
    if ((sampled.get(kind) ?? 0) >= SAMPLE || !box || box.width < 2 || box.height < 2) continue
    const point: [number, number] = [box.x + box.width / 2, box.y + box.height / 2]
    if (point[0] < 0 || point[1] < 0 || point[0] > viewport.width || point[1] > viewport.height)
      continue
    sampled.set(kind, (sampled.get(kind) ?? 0) + 1)
    await rest(page, point)
    const from = await laidFrom(anchor)
    if (!from) continue
    laid += 1
    if (!from.seen) wrong.push(`${kind} «${from.text}»: laid over words a reader does not see`)
    else if (Math.abs(from.seen.x) > 0.5 || Math.abs(from.seen.y) > 0.5)
      wrong.push(`${kind} «${from.text}»: laid ${from.seen.x}, ${from.seen.y} off its letter`)
  }
  return { kinds: [...sampled.keys()], laid, wrong }
}

async function openAt(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  await page.setViewportSize({ width, height: 800 })
  // The hint's delay runs on this clock, so a test can say that no hint came after it.
  await page.clock.install()
  await installBackend(page)
  await serve(page)
  await openBoard(page)
}

test.describe('at 360px, where the rail is its icons and the action its sign', () => {
  test.beforeEach(async ({ page }) => {
    await openAt(page, 360)
  })

  test('a control whose label is hidden names itself beside it, and lays no words over it', async ({
    page,
  }) => {
    const rail = await boxOf(page.locator('.app-nav-shell'))
    for (const control of RAIL) {
      const { own, shown } = await hiddenHint(page, control)
      // Beside the rail, past its edge, level with its row.
      expect(shown.left, `${control.control}: past the rail`).toBeGreaterThanOrEqual(rail.right)
      expect(Math.abs(shown.top - own.top), `${control.control}: level with its row`).toBeLessThan(
        2,
      )
    }
    // A name stands under its icon.
    const { own, shown } = await hiddenHint(page, ACTION)
    expect(shown.top, `${ACTION.control}: under it`).toBeGreaterThanOrEqual(own.bottom)
  })

  test('the whole words of a cut text start on a letter of its words a reader sees', async ({
    page,
  }) => {
    const swept = await sweepCut(page)
    expect(swept.kinds).toEqual(expect.arrayContaining(['nav-item', 'work-action']))
    expect(swept.wrong).toEqual([])
  })
})

test.describe('at 1280px, where every label stands whole', () => {
  test.beforeEach(async ({ page }) => {
    await openAt(page, 1280)
  })

  // Both selectors are shown present in this file: the hint where a label is hidden at 360px,
  // the whole words where the sweep below lays them over a cut title.
  test('a control whose label stands whole shows no hint', async ({ page }) => {
    for (const { control } of [...RAIL, ACTION]) {
      await rest(page, page.locator(control).first())
      await expect(page.locator('.whole-text'), control).toHaveCount(0)
      await expect(page.locator('.tooltip-hint'), control).toHaveCount(0)
    }
  })

  test('the whole words of a cut text start on a letter of its words a reader sees', async ({
    page,
  }) => {
    const swept = await sweepCut(page)
    expect(swept.kinds).toEqual(expect.arrayContaining(['nav-item', 'lane-title']))
    // The lane titles are cut at this width, so whole words were laid, and read, for some.
    expect(swept.laid).toBeGreaterThan(0)
    expect(swept.wrong).toEqual([])
  })
})
