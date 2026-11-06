/**
 * How the list of work going on now stands, measured rather than looked at: one grid
 * for every level's fold and sign, one column for a level's numbers whatever a row
 * carries, rows of one height that never wrap, controls as tall as their row, no ring
 * or edge on what the keyboard has not reached, a list that scrolls alone between a rail
 * head and foot that stay, and the phone's panel with its width, its rows and its focus.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow as frameRow } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

/** The busy frame and twenty more items under a third space, enough to scroll a rail. */
function tallFrame() {
  const frame = busyFrame()
  frame.spaces.push({
    key: 'ZED',
    name: 'Long list',
    project_id: 'example-project',
    unplaced: 0,
    rows: Array.from({ length: 20 }, (_, index) =>
      frameRow(`ZED-${index + 1}`, { state: index % 2 ? 'held' : 'working', agents: index % 3 }),
    ),
  })
  return frame
}

async function open(page: Page, viewport: { height: number; width: number }) {
  await page.setViewportSize(viewport)
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(tallFrame())
  return streams
}

interface Measured {
  controls: number[]
  depth: string
  height: number
  lead: number
  lines: number
  number: number
  reference: string
}

/** Every row of a list as its boxes stand: where its lead and number start, how tall it is. */
function measure(page: Page, within: string) {
  return page.locator(within).evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('.nav-row')].map((row) => {
      const lead = row.querySelector('.nav-row-fold, .nav-row-lead')
      const number = row.querySelector('.nav-row-number')
      const title = row.querySelector('.nav-row-title')
      const controls = [...row.querySelectorAll('button')].filter(
        (control) => getComputedStyle(control).display !== 'none',
      )
      return {
        reference:
          row.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ?? '',
        depth: row.style.getPropertyValue('--nav-row-depth'),
        height: row.getBoundingClientRect().height,
        lead: lead?.getBoundingClientRect().left ?? Number.NaN,
        number: number?.getBoundingClientRect().left ?? Number.NaN,
        controls: controls.map((control) => control.getBoundingClientRect().height),
        lines: title?.getClientRects().length ?? 0,
      }
    }),
  ) as Promise<Measured[]>
}

/** One value for every row of a level, within a pixel. */
function oneColumn(rows: Measured[], pick: (row: Measured) => number) {
  const levels = new Map<string, number[]>()
  for (const row of rows) levels.set(row.depth, [...(levels.get(row.depth) ?? []), pick(row)])
  for (const [depth, values] of levels)
    expect(Math.max(...values) - Math.min(...values), `level ${depth}`).toBeLessThanOrEqual(1)
  return new Map([...levels].map(([depth, values]) => [depth, values[0]]))
}

function holdsTheGrid(rows: Measured[], rowHeight: number, step: number) {
  const leads = oneColumn(rows, (row) => row.lead)
  oneColumn(rows, (row) => row.number)
  // A level stands one step in from the level above it.
  expect(Math.abs((leads.get('2') ?? 0) - (leads.get('1') ?? 0) - step)).toBeLessThanOrEqual(1)
  for (const row of rows) {
    expect(Math.abs(row.height - rowHeight), row.reference).toBeLessThanOrEqual(0.5)
    expect(row.lines, `${row.reference} wraps`).toBe(1)
    for (const height of row.controls)
      expect(Math.abs(height - rowHeight), `${row.reference} control`).toBeLessThanOrEqual(0.5)
  }
}

/** A space's head stands as tall as a row, and so does its fold: no button's own floor. */
async function headsHold(page: Page, within: string, rowHeight: number) {
  const heads = await page
    .locator(within)
    .evaluate((root) =>
      [...root.querySelectorAll('.nav-tree-head, .nav-tree-fold')].map(
        (node) => node.getBoundingClientRect().height,
      ),
    )
  expect(heads.length).toBeGreaterThan(0)
  for (const height of heads) expect(Math.abs(height - rowHeight)).toBeLessThanOrEqual(0.5)
}

/**
 * Nothing in the list draws a ring or an edge while the keyboard has not reached it. The
 * reset gives every element a solid border of no width, so an edge is one that is drawn:
 * a style and a width.
 */
function nothingRinged(page: Page, within: string) {
  return page.locator(within).evaluate((root) =>
    [root, ...root.querySelectorAll<Element>('*')]
      .filter((node) => {
        const style = getComputedStyle(node)
        const before = getComputedStyle(node, '::before')
        const edge = ['top', 'right', 'bottom', 'left'].some(
          (side) =>
            style.getPropertyValue(`border-${side}-style`) !== 'none' &&
            Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0,
        )
        const ring = [style, before].some(
          (of) => of.outlineStyle !== 'none' && Number.parseFloat(of.outlineWidth) > 0,
        )
        return edge || ring
      })
      .map((node) => node.getAttribute('class') ?? node.tagName),
  )
}

test('the rail’s list stands on one grid at 1280', async ({ page }) => {
  await open(page, { width: 1280, height: 800 })
  await expect(liveRow(page, 'ZED-1')).toBeAttached()
  const rows = await measure(page, '.nav-work-list')
  holdsTheGrid(rows, 28, 12)
  await headsHold(page, '.nav-work-list', 28)
  // The space's fold stands at the level above the first, on the same grid.
  const spaceFold = await page.locator('.nav-tree-fold').first().boundingBox()
  const levelOne = rows.find((row) => row.depth === '1')
  expect(Math.abs((levelOne?.lead ?? 0) - (spaceFold?.x ?? 0) - 12)).toBeLessThanOrEqual(1)
  // A caption's words start where its level's numbers do.
  const note = await page
    .locator('.nav-tree-note-nested .nav-tree-note-words')
    .first()
    .boundingBox()
  expect(Math.abs((note?.x ?? 0) - (levelOne?.number ?? 0))).toBeLessThanOrEqual(1)
  expect(await nothingRinged(page, '.nav-work-list')).toEqual([])
  // A press with the pointer rings nothing either.
  await page.locator('.nav-tree-fold').first().click()
  expect(await nothingRinged(page, '.nav-work-list')).toEqual([])
})

test('the list scrolls by itself at 800px, and the rail’s head and foot stay put', async ({
  page,
}) => {
  await open(page, { width: 1280, height: 800 })
  const list = page.locator('.nav-work-list')
  await expect(liveRow(page, 'ZED-20')).toBeAttached()
  const room = await list.evaluate((node) => ({
    scroll: node.scrollHeight,
    client: node.clientHeight,
    across: node.scrollWidth - node.clientWidth,
  }))
  expect(room.scroll).toBeGreaterThan(room.client)
  expect(room.across).toBe(0)
  const still = [
    '.app-brand',
    '.work-action',
    '.nav-item.module-planning',
    '.nav-item.module-settings',
    '.nav-refresh',
  ]
  const before = await Promise.all(
    still.map((selector) => page.locator(selector).first().boundingBox()),
  )
  for (const box of before) expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(800)
  await list.evaluate((node) => node.scrollBy(0, 400))
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  const after = await Promise.all(
    still.map((selector) => page.locator(selector).first().boundingBox()),
  )
  expect(after).toEqual(before)
  // Nothing else in the rail scrolls, across or down.
  const strays = await page.locator('.app-nav-shell').evaluate((shell) =>
    [shell, ...shell.querySelectorAll<HTMLElement>('*')]
      .filter((node) => !node.classList.contains('nav-work-list'))
      .filter(
        (node) =>
          node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
      )
      .filter(
        (node) =>
          ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) ||
          ['auto', 'scroll'].includes(getComputedStyle(node).overflowX),
      )
      .map((node) => node.className.toString()),
  )
  expect(strays).toEqual([])
})

test('a phone opens the list in a panel over the page, with a finger’s rows and its focus', async ({
  page,
}) => {
  await open(page, { width: 390, height: 844 })
  const button = page.locator('.nav-work-rail')
  await expect(page.locator('.nav-work-list')).toBeHidden()
  await expect(page.locator('.nav-entry-fold')).toBeHidden()
  await expect(button).toBeVisible()
  // Every row a session is on now: five in the busy frame, the epic at work among them,
  // and the twenty of the third space; the quiet and the pinned rows are not counted.
  await expect(button).toContainText('25')
  await expect(button).toHaveAccessibleName('Work going on now: 25')

  await button.click()
  const panel = page.getByRole('dialog', { name: 'Work' })
  await expect(panel).toBeVisible()
  // Measured where it comes to rest: it slides in from the rail's edge.
  await settled(panel)
  const box = await panel.boundingBox()
  expect(box).toMatchObject({ x: 0, width: 340 })
  expect(await panel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
  holdsTheGrid(await measure(page, '.side-panel-body'), 44, 12)
  await headsHold(page, '.side-panel-body', 44)
  const pinned = liveRow(page, 'MAIN-20', '.side-panel-body').locator('.nav-row-pin')
  expect(await pinned.boundingBox()).toMatchObject({ width: 44, height: 44 })
  await expect(liveRow(page, 'MAIN-12', '.side-panel-body').locator('.nav-row-pin')).toHaveCount(0)

  // Focus is held in the panel however far Tab goes.
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press('Tab')
    expect(await panel.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()

  await button.click()
  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()

  await button.click()
  await expect(panel).toBeVisible()
  await page.mouse.click(370, 600)
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()

  await button.click()
  await liveRow(page, 'MAIN-12', '.side-panel-body').locator('.nav-row-link').click()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(/\/modules\/planning\/project\/example-project\?entity=/u)
})

const running = (page: Page) =>
  page
    .locator('.nav-work-list')
    .evaluate(
      (list) =>
        [...list.querySelectorAll('.work-dots i')]
          .flatMap((dot) => dot.getAnimations())
          .filter((animation) => animation.playState === 'running').length,
    )

test('the dots run, and reduced motion holds every one still', async ({ page }) => {
  await open(page, { width: 1280, height: 800 })
  await expect(liveRow(page, 'MAIN-12').locator('.work-dots')).toBeVisible()
  await expect.poll(() => running(page)).toBeGreaterThan(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => running(page)).toBe(0)
})
