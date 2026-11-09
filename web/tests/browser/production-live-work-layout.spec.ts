/**
 * How the list of work going on now stands, measured rather than looked at: one grid
 * for the rows' signs and the quiet rows' fold, one column for the numbers whatever a row
 * carries, rows of one height that never wrap, controls as tall as their row, no ring
 * or edge on what the keyboard has not reached, a list that scrolls alone between a rail
 * head and foot that stay, and the phone's panel with its width, its rows and its focus.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow as frameRow } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow, openQuiet } from './liveWorkPage.ts'
import { globalScope, projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

/** The busy frame and twenty more items at work under a third space, enough to scroll a rail. */
function tallFrame() {
  const frame = busyFrame()
  frame.spaces.push({
    key: 'ZED',
    name: 'Long list',
    project_id: 'example-project',
    unplaced: 0,
    rows: Array.from({ length: 20 }, (_, index) =>
      frameRow(`ZED-${index + 1}`, { state: index % 2 ? 'waiting' : 'working', agents: index % 3 }),
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
  /** A closed row on a phone: it has no lead column, so its number stands at its own x. */
  leadless: boolean
  lines: number
  number: number
  reference: string
}

/**
 * Every row of a list as its boxes stand: where its lead and number start, how tall it is.
 * The quiet rows' fold counts as a row: its arrow stands in the lead's column and its words
 * where the numbers start.
 */
function measure(page: Page, within: string) {
  return page.locator(within).evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('.nav-row, .nav-quiet-fold')].map((row) => {
      const lead = row.querySelector('.nav-row-lead, .nav-quiet-lead')
      const number = row.querySelector('.nav-row-number, .nav-quiet-words')
      const title = row.querySelector('.nav-row-title, .nav-quiet-words')
      const controls = [...row.querySelectorAll('button')].filter(
        (control) => getComputedStyle(control).display !== 'none',
      )
      return {
        reference:
          row.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ?? 'quiet',
        depth: row.style.getPropertyValue('--nav-row-depth') || '1',
        height: row.getBoundingClientRect().height,
        leadless: row.classList.contains('nav-row-leadless'),
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

function holdsTheGrid(rows: Measured[], rowHeight: number) {
  for (const row of rows) {
    expect(Math.abs(row.height - rowHeight), row.reference).toBeLessThanOrEqual(0.5)
    expect(row.lines, `${row.reference} wraps`).toBe(1)
    for (const height of row.controls)
      expect(Math.abs(height - rowHeight), `${row.reference} control`).toBeLessThanOrEqual(0.5)
  }
  // A closed row without a lead keeps its number in a column of its own, one lead to the left.
  const open = rows.filter((row) => !row.leadless)
  const leads = oneColumn(open, (row) => row.lead)
  oneColumn(open, (row) => row.number)
  oneColumn(
    rows.filter((row) => row.leadless),
    (row) => row.number,
  )
  // Every row and the quiet rows' fold stand at one level, one step in from the space.
  expect([[...leads.keys()], rows.some((row) => row.reference === 'quiet')]).toEqual([['1'], true])
}

/**
 * A space's head stands as tall as a row, and so do its fold and the quiet rows' fold: no
 * button's own floor.
 */
async function headsHold(page: Page, within: string, rowHeight: number) {
  const heads = await page
    .locator(within)
    .evaluate((root) =>
      [...root.querySelectorAll('.nav-tree-head, .nav-tree-fold, .nav-quiet-fold')].map(
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
  await openQuiet(page, '.nav-work-list')
  const rows = await measure(page, '.nav-work-list')
  holdsTheGrid(rows, 28)
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
  // A closed row on the rail keeps its lead: the phone's panel is the only one that drops it.
  await expect(liveRow(page, 'MAIN-7').locator('.nav-row-lead')).toHaveCount(1)
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
    // The connection's foot is empty while the stream is live, so Settings is the last thing.
    '.nav-item.module-settings',
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
  await openQuiet(page, '.side-panel-body')
  const box = await panel.boundingBox()
  expect(box).toMatchObject({ x: 0, width: 340 })
  expect(await panel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
  holdsTheGrid(await measure(page, '.side-panel-body'), 44)
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

test('a forced palette keeps the dots, and the open row is the system’s own pair throughout', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  await expect(page.locator('.drawer')).toBeVisible()
  const frame = busyFrame()
  frame.spaces[0].rows.push(frameRow(workItemRef.reference, { state: 'working', agents: 1 }))
  await streams.live(frame)
  const dot = liveRow(page, 'MAIN-12').locator('.work-dots i').first()
  await expect(dot).toBeVisible()
  const paint = await dot.evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(paint).not.toBe('rgba(0, 0, 0, 0)')

  const current = liveRow(page, workItemRef.reference)
  await expect(current.locator('.nav-row-link')).toHaveAttribute('aria-current', 'page')
  const seen = await current.evaluate((row) => {
    // What the palette's pair resolves to here, read off a probe the palette leaves alone.
    const probe = document.createElement('span')
    probe.style.cssText = 'color: HighlightText; background: Highlight; forced-color-adjust: none'
    document.body.append(probe)
    const pair = {
      ink: getComputedStyle(probe).color,
      ground: getComputedStyle(probe).backgroundColor,
    }
    probe.remove()
    const parts = row.querySelectorAll(
      '.nav-row-lead, .nav-row-number, .nav-row-title, .nav-row-meta',
    )
    return {
      pair,
      ground: getComputedStyle(row).backgroundColor,
      inks: [...parts].map((part) => getComputedStyle(part).color),
      dots: [...row.querySelectorAll('.work-dots i')].map(
        (part) => getComputedStyle(part).backgroundColor,
      ),
    }
  })
  expect(seen.ground).toBe(seen.pair.ground)
  expect(seen.inks).toHaveLength(4)
  expect(seen.dots).toHaveLength(3)
  for (const ink of [...seen.inks, ...seen.dots]) expect(ink).toBe(seen.pair.ink)
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

/**
 * On a phone a closed row has no sign for its lead, so it has no lead: the lead's column and
 * its gap go and the title takes their room. The assertions state that relation rather than
 * numbers: the lead and its gap are read from an open row's computed grid, and the title the
 * base grid would give the same closed row is laid out on that row.
 *
 * Measured 07.11 on the base 4cb63290, MAIN-7 pinned, title box: 60,56 px at 320 and 128,56 px
 * at 390; with the fix 108,56 px and 176,56 px.
 */
for (const width of [320, 390]) {
  test(`at ${width} px a closed row's title gets the room of an open row's lead and gap, and its ring, pin and box hold`, async ({
    page,
  }) => {
    await open(page, { width, height: 844 })
    await page.locator('.nav-work-rail').click()
    const panel = page.getByRole('dialog', { name: 'Work' })
    await expect(panel).toBeVisible()
    await settled(panel)
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.fonts.ready)

    const closed = liveRow(page, 'MAIN-7', '.side-panel-body')
    const current = liveRow(page, 'MAIN-12', '.side-panel-body')

    // An open row keeps its lead, with its sign in it; the lead's width and gap are its grid.
    await expect(current.locator('.nav-row-lead')).toHaveCount(1)
    await expect(current.locator('.nav-row-lead .work-dots')).toBeVisible()
    const leadBox = await current.locator('.nav-row-lead').boundingBox()
    const room = await current.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        gap: Number.parseFloat(style.columnGap),
        lead: Number.parseFloat(style.gridTemplateColumns.split(' ')[0]),
      }
    })
    expect(room.lead).toBeCloseTo(leadBox?.width ?? Number.NaN, 0)

    // The closed title as it stands, and as the base grid lays out the same row: the lead
    // track back in its column, the link and the pin kept in theirs.
    const widths = await closed.evaluate((row, lead) => {
      const link = row.querySelector<HTMLElement>('.nav-row-link')
      const pin = row.querySelector<HTMLElement>('.nav-row-pin')
      const title = row.querySelector<HTMLElement>('.nav-row-title')
      if (!link || !title) throw new Error('a row without its link or title')
      const kept = {
        grid: row.style.gridTemplateColumns,
        link: link.style.gridColumn,
        pin: pin?.style.gridColumn ?? '',
      }
      const actual = title.getBoundingClientRect().width
      row.style.gridTemplateColumns = pin
        ? `${lead}px minmax(0, 1fr) auto`
        : `${lead}px minmax(0, 1fr)`
      link.style.gridColumn = '2'
      if (pin) pin.style.gridColumn = '3'
      const base = title.getBoundingClientRect().width
      row.style.gridTemplateColumns = kept.grid
      link.style.gridColumn = kept.link
      if (pin) pin.style.gridColumn = kept.pin
      return { actual, base }
    }, room.lead)
    expect(
      Math.abs(widths.actual - widths.base - (room.lead + room.gap)),
      `closed title ${widths.actual} px, base grid ${widths.base} px, lead ${room.lead} gap ${room.gap} at ${width} px`,
    ).toBeLessThanOrEqual(1)

    await expect(closed.locator('.nav-row-lead')).toHaveCount(0)

    // The pin of a pinned closed row stays a finger's target.
    expect(await closed.locator('.nav-row-pin').boundingBox()).toMatchObject({
      width: 44,
      height: 44,
    })

    // Nothing of the closed row stands outside its box, and it does not scroll across.
    const outside = await closed.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return [...node.querySelectorAll<Element>('*')]
        .filter((child) => {
          const rect = child.getBoundingClientRect()
          return rect.width > 0 && (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
        })
        .map((child) => child.getAttribute('class') ?? child.tagName)
    })
    expect(outside).toEqual([])
    expect(await closed.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)

    // The keyboard's ring stands on the closed row's link, whole and inside the row and the panel.
    const link = closed.locator('.nav-row-link')
    await link.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(link).toBeFocused()
    const ring = await link.evaluate((node) => {
      const row = node.closest<HTMLElement>('.nav-row')
      const body = node.closest<HTMLElement>('.side-panel-body')
      if (!row || !body) throw new Error('a link outside its row or panel')
      const box = row.getBoundingClientRect()
      const frame = body.getBoundingClientRect()
      const drawn = getComputedStyle(node, '::before')
      const middleX = (box.left + box.right) / 2
      const middleY = (box.top + box.bottom) / 2
      const edges = [
        [box.left + 1, middleY],
        [box.right - 1, middleY],
        [middleX, box.top + 1],
        [middleX, box.bottom - 1],
      ]
      return {
        clipped:
          box.left < frame.left ||
          box.right > frame.right ||
          box.top < frame.top ||
          box.bottom > frame.bottom,
        hits: edges.map(([x, y]) => {
          const hit = document.elementFromPoint(x, y)
          return hit !== null && row.contains(hit)
        }),
        outline: drawn.outlineStyle,
        width: Number.parseFloat(drawn.outlineWidth),
      }
    })
    expect(ring.outline).toBe('solid')
    expect(ring.width).toBeGreaterThan(0)
    expect(ring.clipped).toBe(false)
    expect(ring.hits).toEqual([true, true, true, true])
    await page.mouse.move(0, 0)
  })
}
