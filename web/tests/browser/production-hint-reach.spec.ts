/**
 * A hint the pointer raised can be reached by the pointer, in the built app, where it stands
 * beside its list past other elements with hints of their own (WCAG 2.2, 1.4.13). A row of the
 * rail at its narrowest says beside the rail what it does not draw; the straight way from the
 * row to that hint crosses the row's cut name and its pin, and each of them took over at once:
 * the cut name laid its whole words over itself and the pin named itself, so the row's hint was
 * gone before the pointer got there. Moved in steps from the row to its hint, the pointer now
 * finds the hint still there, and it stays while the pointer rests on it. Standing still on the
 * cut name on the way, the reader gets its whole words as before. A tile of the Analytics rail
 * says its meter's detail past the rail's edge; the way there crosses only ground, and a hand
 * that took longer over it than the hint's grace found the hint gone. At 1440 and 1024 pixels.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { pageAt as analyticsAt, record, serve as serveAnalytics } from './analyticsPage.ts'
import { openRail } from './cutRailPage.ts'
import { pass, wholeText } from './hintFramesPage.ts'
import { test } from './test.ts'

interface Step {
  /** The hint of another element the pointer stood on, if any. */
  crossed: string
  hints: string[]
  wholes: number
  x: number
  y: number
}

/** A point on `anchor` where the pointer is on the anchor itself, not on an element inside it. */
const ownPoint = (anchor: Locator) =>
  anchor.evaluate((own) => {
    const { left, right, top, bottom } = own.getBoundingClientRect()
    const y = (top + bottom) / 2
    for (let x = left + 1; x < right; x += 2)
      if (document.elementFromPoint(x, y)?.closest('[data-tooltip]') === own) return { x, y }
    throw new Error('no point on the anchor itself')
  })

/** What a hint stands over at a point, and the hints shown then. */
const stepAt = (anchor: Locator, at: { x: number; y: number }) =>
  anchor.evaluate((own, { x, y }) => {
    const under = document.elementFromPoint(x, y)
    const other = under?.closest<HTMLElement>('[data-tooltip]')
    return {
      x,
      y,
      crossed:
        other && other !== own && !under?.closest('[data-hint-surface]') ? other.className : '',
      hints: [...document.querySelectorAll('.tooltip-hint')].map((hint) => hint.textContent ?? ''),
      wholes: document.querySelectorAll('.whole-text').length,
    }
  }, at)

/** The words a hint says: its first line, which every hint of the anchor starts with. */
const wordsOf = async (anchor: Locator) =>
  ((await anchor.getAttribute('data-tooltip')) ?? '').split('\n')[0] ?? ''

/**
 * Raises `anchor`'s hint and moves the pointer from the anchor to it, a step each frame or so, as
 * a hand does: what the hint shows at every step, and whether it is there at the end.
 */
async function reach(page: Page, anchor: Locator, info: TestInfo, name: string) {
  const words = await wordsOf(anchor)
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await pass(page, 400)
  const from = await ownPoint(anchor)
  await page.mouse.move(from.x, from.y)
  const hint = page.locator('.tooltip-hint')
  await expect(hint).toHaveCount(1)
  await expect(hint).toContainText(words)
  const box = await hint.evaluate((node) => {
    const { left, right, top, bottom } = node.getBoundingClientRect()
    return { left, right, top, bottom }
  })
  // Into the hint by a few pixels, level with its middle, from whichever side it stands on.
  const to = {
    x: box.left >= from.x ? box.left + 6 : box.right - 6,
    y: (box.top + box.bottom) / 2,
  }
  const steps: Step[] = []
  const count = 24
  for (let at = 1; at <= count; at += 1) {
    const point = {
      x: from.x + ((to.x - from.x) * at) / count,
      y: from.y + ((to.y - from.y) * at) / count,
    }
    await page.mouse.move(point.x, point.y)
    await pass(page, 16)
    steps.push(await stepAt(anchor, point))
  }
  // Resting on the hint, past its grace.
  await pass(page, 400)
  const end = await stepAt(anchor, to)
  const onHint = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.tooltip-hint')),
    to,
  )
  await record(info, name, { from, to, box, steps, end })
  return { end, onHint, steps, words }
}

/** Every step of the way across other elements kept the anchor's own hint, and nothing else. */
function expectWayKept({ steps, words }: Awaited<ReturnType<typeof reach>>) {
  expect(
    steps.filter((step) => step.crossed),
    'the way crosses another element with a hint',
  ).not.toEqual([])
  expect(
    steps.filter((step) => step.hints.length !== 1 || !step.hints[0]?.includes(words)),
    'every step: the anchor’s own hint',
  ).toEqual([])
  expect(
    steps.filter((step) => step.wholes > 0),
    'no cut text laid whole on the way',
  ).toEqual([])
}

/** A row of the rail whose name the rail cuts and which says more beside the rail. */
async function cutRow(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  await openRail(page, width)
  const rows = page.locator('.nav-row[data-tooltip]')
  const index = await rows.evaluateAll((all) =>
    all.findIndex((row) => {
      const box = row.getBoundingClientRect()
      const title = row.querySelector<HTMLElement>('.nav-row-title')
      return (
        box.height > 1 &&
        box.top >= 0 &&
        box.bottom <= innerHeight &&
        title !== null &&
        title.scrollWidth > title.clientWidth + 1
      )
    }),
  )
  expect(index, 'a row with a cut name and a hint').toBeGreaterThanOrEqual(0)
  return rows.nth(index)
}

for (const width of [1440, 1024]) {
  test(`the pointer reaches a rail row’s hint across its cut name, at ${width}px`, async ({
    page,
  }, info) => {
    const row = await cutRow(page, width)
    const reached = await reach(page, row, info, `rail-row-${width}`)
    expectWayKept(reached)
    expect(reached.end.hints, 'resting on it: the hint').toHaveLength(1)
    expect(reached.end.hints[0], 'resting on it: its words').toContain(reached.words)
    expect(reached.onHint, 'the pointer is on the hint').toBe(true)
  })

  test(`standing still on the cut name on the way, its whole words come, at ${width}px`, async ({
    page,
  }) => {
    const row = await cutRow(page, width)
    const from = await ownPoint(row)
    await page.mouse.move(from.x, from.y)
    await expect(page.locator('.tooltip-hint')).toContainText(await wordsOf(row))
    const title = await row.locator('.nav-row-title').evaluate((node) => {
      const { left, top, bottom } = node.getBoundingClientRect()
      return { x: left + 6, y: (top + bottom) / 2 }
    })
    await page.mouse.move(title.x, title.y, { steps: 4 })
    await expect(wholeText(page)).toBeVisible()
    await expect(page.locator('.tooltip-hint')).toHaveCount(0)
  })

  test(`the pointer reaches an Analytics rail tile’s hint past the rail, at ${width}px`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
    await page.setViewportSize({ width, height: 900 })
    await serveAnalytics(page)
    await page.goto(analyticsAt())
    // A tile's meter, under its lead: its hint stands past the rail, level with the tile's top.
    const meter = page.locator('.analytics-rail-list .window-bar[data-tooltip]').first()
    await expect(meter).toBeVisible()
    const reached = await reach(page, meter, info, `analytics-rail-${width}`)
    expect(reached.end.hints, 'resting on it: the hint').toHaveLength(1)
    expect(reached.end.hints[0], 'resting on it: its words').toContain(reached.words)
    expect(reached.onHint, 'the pointer is on the hint').toBe(true)
  })
}
