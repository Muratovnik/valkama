/**
 * The chain's rows in the card, across its groups: one set of columns for the
 * whole list, so the reference, the title, the waiting mark and the holder start
 * at the same place in every row, whichever group the row is in and whether or
 * not the row has that cell. A long holder is cut short with its whole name in
 * its tooltip and takes no room from the titles. On a narrow list a row's mark stands
 * under its title, so that one row's mark takes no room from any title.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainOf, mapId, mapMember } from '../fixtures/chainMap.ts'
import { installBackend } from './backend.ts'
import { serve } from './chainFixtures.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const ROOT = { id: workItem.work_item_id, reference: workItemRef.reference, title: workItem.title }

const LONG_HOLDER =
  'release-coordinator-operator-with-an-unusually-long-name (session 0195f3a2-7c1e-7d4b-9a10-5c2e8f1b6d3a)'
/** The holder as the row names it: the whole name, and the first 13 characters of the session. */
const LONG_HOLDER_WHOLE = 'release-coordinator-operator-with-an-unusually-long-name · 0195f3a2-7c1e'

const members = [
  mapMember('MAIN-998', 'active', workItemRef.reference, {
    holder: 'maintainer (session 674838a1-9c2e-4f5b-8d7a-0b1c2d3e4f50)',
    ready: true,
    title: 'Still open',
  }),
  mapMember('MAIN-1080', 'active', workItemRef.reference, {
    holder: 'maintainer (session 674838a1-9c2e-4f5b-8d7a-0b1c2d3e4f50)',
    ready: false,
    title: 'Gateway rejects unassigned exceptions',
  }),
  mapMember('MAIN-1081', 'active', workItemRef.reference, {
    holder: 'reviewer (session 1baa03d7-0c4e-7a11-9b2d-3f5e6a7b8c9d)',
    ready: true,
    title: 'Short task',
  }),
  mapMember('MAIN-1082', 'active', workItemRef.reference, {
    holder: LONG_HOLDER,
    ready: true,
    title: 'Move the export job to the new queue',
  }),
  mapMember('MAIN-1133', 'backlog', workItemRef.reference, {
    ready: false,
    title: 'Waits on an open item',
  }),
  mapMember('MAIN-1134', 'backlog', workItemRef.reference, {
    ready: true,
    title: 'Unblocked backlog item',
  }),
]

/** Two open items wait on MAIN-998, which is itself a member of the chain. */
const edges = [
  { from: mapId(998), to: mapId(1080), kind: 'blocks' as const },
  { from: mapId(998), to: mapId(1133), kind: 'blocks' as const },
]

const chain = () => chainOf(ROOT, members, { edges })

const shot = (path: string) => ({ path, animations: 'disabled' as const })

async function openCard(page: Page) {
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

/** Each row's cells: where they start on the page, and the title's width; null where a cell is absent or hidden. */
function cellsOf(section: Locator) {
  return section.locator('.chain-row').evaluateAll((rows) =>
    rows.map((row) => {
      const cell = (selector: string) => {
        const node = row.querySelector(selector)
        return node && node.getClientRects().length > 0 ? node.getBoundingClientRect() : null
      }
      const title = cell('.chain-row-title')
      return {
        reference: cell('.chain-row-reference')?.left ?? null,
        title: title?.left ?? null,
        titleWidth: title?.width ?? null,
        waiting: cell('.chain-row-waiting')?.left ?? null,
        holder: cell('.chain-row-holder')?.left ?? null,
      }
    }),
  )
}

/** The gap between the furthest-apart and the nearest of the cells that are there. */
function spread(values: (number | null)[]): number {
  const known = values.filter((value): value is number => value !== null)
  return known.length === 0 ? 0 : Math.max(...known) - Math.min(...known)
}

for (const width of [1280, 390]) {
  test(`the rows of both groups share one set of columns at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page)
    await serve(page, chain())
    const section = await openCard(page)
    await expect(section.locator('.chain-row')).toHaveCount(6)
    await expect(section.locator('.chain-group-title')).toHaveText([
      'Development · 4',
      'Backlog · 2',
    ])
    // Below 480px the holder is hidden and the state word or the waiting mark keeps its place.
    const list = await section.locator('.chain-members').boundingBox()
    const narrow = (list?.width ?? 0) < 480

    const rows = await cellsOf(section)
    expect(rows).toHaveLength(6)
    expect(spread(rows.map((row) => row.reference))).toBeLessThanOrEqual(1)
    expect(spread(rows.map((row) => row.title))).toBeLessThanOrEqual(1)
    // Every title is one track wide, so a holder in one row takes no room from another.
    expect(spread(rows.map((row) => row.titleWidth))).toBeLessThanOrEqual(1)
    // A waiting mark in one row must not squeeze every title on a phone.
    expect(rows[0]?.titleWidth ?? 0).toBeGreaterThanOrEqual(narrow ? 200 : 0)
    const waiting = rows.map((row) => row.waiting)
    expect(waiting.filter((value) => value !== null)).toHaveLength(2)
    expect(spread(waiting)).toBeLessThanOrEqual(1)
    const holders = rows.map((row) => row.holder)
    expect(holders.filter((value) => value !== null)).toHaveLength(narrow ? 0 : 4)
    expect(spread(holders)).toBeLessThanOrEqual(1)
    await section.screenshot(shot(info.outputPath(`chain-columns-${width}.png`)))
  })
}

/** A group of two states, so that a row in it says its own state beside any waiting mark. */
const mixedChain = () =>
  chainOf(
    ROOT,
    [
      ...members,
      {
        ...mapMember('MAIN-1135', 'backlog', workItemRef.reference, {
          ready: false,
          title: 'Says its own state and what it waits on',
        }),
        state: { key: 'triage', name: 'Triage', category: 'backlog', is_terminal: false },
      },
    ],
    { edges: [...edges, { from: mapId(998), to: mapId(1135), kind: 'blocks' as const }] },
  )

/** What a row draws: each cell's box, null where the cell is absent or hidden. */
function boxesOf(section: Locator) {
  return section.locator('.chain-row').evaluateAll((rows) =>
    rows.map((row) => {
      const box = (selector: string) => {
        const node = row.querySelector(selector)
        if (!node || node.getClientRects().length === 0) return null
        const { bottom, left, right, top, width } = node.getBoundingClientRect()
        return { bottom, left, right, top, width }
      }
      const detail = [...row.querySelectorAll('.chain-row-detail')]
        .find((node) => node.getClientRects().length > 0)
        ?.getBoundingClientRect()
      const padding = Number.parseFloat(getComputedStyle(row).paddingRight)
      return {
        contentRight: row.getBoundingClientRect().right - padding,
        detail: detail ? { left: detail.left, top: detail.top } : null,
        title: box('.chain-row-title'),
        waiting: box('.chain-row-waiting'),
      }
    }),
  )
}

test('at a phone’s width a mark stands under its title and no title gives up room for one', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  await installBackend(page)
  await serve(page, mixedChain())
  const section = await openCard(page)
  await expect(section.locator('.chain-row')).toHaveCount(7)

  const rows = await boxesOf(section)
  const titles = rows.map((row) => row.title).filter((title) => title !== null)
  expect(titles).toHaveLength(7)
  // The whole width after the reference, in every row, with a mark in it or not.
  for (const row of rows) {
    expect(row.title?.width ?? 0).toBeGreaterThanOrEqual(200)
    expect(Math.abs((row.title?.right ?? 0) - row.contentRight)).toBeLessThanOrEqual(1)
  }
  expect(spread(titles.map((title) => title.left))).toBeLessThanOrEqual(1)

  const marked = rows.filter((row) => row.waiting !== null)
  expect(marked).toHaveLength(3)
  for (const row of marked) {
    expect(row.waiting?.top ?? 0).toBeGreaterThanOrEqual((row.title?.bottom ?? 0) - 1)
    expect(Math.abs((row.waiting?.left ?? 0) - (row.title?.left ?? 0))).toBeLessThanOrEqual(1)
  }
  const worded = rows.filter((row) => row.detail !== null)
  expect(worded.length).toBeGreaterThan(0)
  for (const row of worded) {
    expect(row.detail?.top ?? 0).toBeGreaterThanOrEqual((row.title?.bottom ?? 0) - 1)
    expect(Math.abs((row.detail?.left ?? 0) - (row.title?.left ?? 0))).toBeLessThanOrEqual(1)
  }
  await section.screenshot(shot(info.outputPath('chain-narrow-390.png')))
})

test('on a wide list a row stays one line, its mark and its holder in columns of their own', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await installBackend(page)
  await serve(page, mixedChain())
  const section = await openCard(page)
  await expect(section.locator('.chain-row')).toHaveCount(7)

  const rows = await boxesOf(section)
  const marked = rows.filter((row) => row.waiting !== null)
  expect(marked).toHaveLength(3)
  for (const row of marked) {
    // Beside the title, on its line.
    expect(row.waiting?.left ?? 0).toBeGreaterThanOrEqual(row.title?.right ?? Infinity)
    expect(row.waiting?.top ?? Infinity).toBeLessThan(row.title?.bottom ?? 0)
  }
  await section.screenshot(shot(info.outputPath('chain-wide-1280.png')))
})

test('a long holder is cut short, keeps its whole name in its tooltip, and takes no room from titles', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await installBackend(page)
  await serve(page, chain())
  const section = await openCard(page)
  const holder = section.locator('.chain-row[data-reference="MAIN-1082"] .chain-row-holder')
  await expect(holder).toBeVisible()
  await expect(holder).toHaveAttribute('title', LONG_HOLDER_WHOLE)
  expect(await holder.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  const box = await holder.boundingBox()
  expect(box?.width ?? Infinity).toBeLessThanOrEqual(160)
  const rows = await cellsOf(section)
  expect(spread(rows.map((row) => row.titleWidth))).toBeLessThanOrEqual(1)
  await section.screenshot(shot(info.outputPath('chain-columns-long-holder.png')))
})

test('a row highlights its full width, and a click on its empty cell opens the task', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await installBackend(page)
  await serve(page, chain())
  const section = await openCard(page)
  const row = section.locator('.chain-row[data-reference="MAIN-1134"]')
  const list = await section.locator('.chain-rows').first().boundingBox()
  await row.hover()
  const rowBox = await row.boundingBox()
  expect(Math.abs((rowBox?.width ?? 0) - (list?.width ?? 0))).toBeLessThanOrEqual(1)
  expect(await row.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  )
  expect(await row.evaluate((node) => getComputedStyle(node).borderRadius)).not.toBe('0px')
  // The far end of the row is the empty state cell: nothing prints there, and the press still opens the task.
  await row.click({ position: { x: (rowBox?.width ?? 0) - 8, y: (rowBox?.height ?? 0) / 2 } })
  const opened = serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity({ ...workItemRef, reference: 'MAIN-1134' }),
  })
  await expect.poll(() => new URL(page.url()).search).toBe(new URL(opened, page.url()).search)
})
