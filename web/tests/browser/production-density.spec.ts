/**
 * What a screen shows first, in the built application: one thing leads a tile, a
 * short title leaves no hole around it, an epic's row is one calm line with its
 * actions a pointer or a key away, a finished cell is a line of text, the grouping
 * is the control its neighbours are, and a chain's section reaches its list without
 * a chart in the way.
 *
 * These are read off the drawn page because every one of them failed there with
 * nothing wrong in any declaration: the base rule gave a title's button a control's
 * height, and one type role put most of a board's characters at a heading's weight.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { lane, openBoard, openList, serve } from './boardPage.ts'
import { largeChainHere, serve as serveChain } from './chainFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const GROUPING = 'Group the board by epic'

/** What a part of the page is drawn at. */
const drawn = (part: Locator) =>
  part.evaluate((node) => {
    const style = getComputedStyle(node)
    return { color: style.color, weight: Number(style.fontWeight) }
  })

const fill = (part: Locator) => part.evaluate((node) => getComputedStyle(node).backgroundColor)

const look = (part: Locator) =>
  part.evaluate((node) => {
    const style = getComputedStyle(node)
    return [style.backgroundColor, style.color, style.borderRadius, style.font]
  })

const opacity = (part: Locator) => part.evaluate((node) => Number(getComputedStyle(node).opacity))

const topOf = async (part: Locator) => {
  const box = await part.boundingBox()
  return box?.y ?? Number.NaN
}

test('one thing leads a tile: its title, and at less than a heading’s weight', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  const sheet = page.locator('[data-reference="MAIN-430"] .work-item-tile')
  const title = await drawn(sheet.locator('.tile-title'))
  const reference = await drawn(sheet.locator('.tile-reference'))
  const label = await drawn(sheet.locator('.label-chip').first())
  // A board is hundreds of titles; at 600 they stood level with a section's heading.
  expect(title.weight).toBeLessThan(600)
  expect(title.weight).toBeGreaterThan(reference.weight)
  expect(title.weight).toBeGreaterThan(label.weight)
  // The identity and the labels recede in ink as well.
  expect(reference.color).not.toBe(title.color)
  expect(label.color).toBe(reference.color)
  // A finished tile stands back from the open work beside it.
  const finished = await drawn(page.locator('[data-reference="MAIN-406"] .tile-title'))
  expect(finished.color).not.toBe(title.color)
})

test('a short title stands in its own height, with no hole around it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  // One line at this width. Its button stood a control's 40px tall under the base
  // rule, with the line centred in it.
  const tile = page.locator('[data-reference="MAIN-430"] .work-item-tile')
  const titleBox = await tile.locator('.tile-title').boundingBox()
  const openBox = await tile.locator('.tile-open').boundingBox()
  expect(titleBox?.height).toBeLessThan(40)
  expect(openBox?.height).toBe(titleBox?.height)
})

test('a list row starts at its own top, with its labels as one line of words', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openList(page)
  const row = page.locator('.work-item-list tbody tr', { hasText: 'Loose work under no epic' })
  await expect(row).toBeVisible()
  // The reference's button stood a control's height and moved the row's shared
  // baseline down, so every title stood lower than the air under it.
  const openBox = await row.locator('.list-open').boundingBox()
  expect(openBox?.height).toBeLessThan(24)
  const offset = (await topOf(row.locator('.list-title'))) - (await topOf(row))
  expect(offset).toBeLessThanOrEqual(12)
  // A label is a word here, and its line is a line of text tall, not a 28px chip's.
  const chip = row.locator('.label-chip').first()
  const face = await chip
    .locator('.chip-face')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(face).toBe('rgba(0, 0, 0, 0)')
  const line = await row.locator('.list-under .facet-marks').boundingBox()
  expect(line?.height).toBeLessThan(24)
  // It still filters, from the same 28px under the pointer.
  await chip.hover()
  const raised = await chip
    .locator('.chip-face')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  expect(raised).not.toBe('rgba(0, 0, 0, 0)')
  await chip.click()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(page.locator('.workspace-figures')).toContainText('Reset')
})

test('an epic’s row is one calm line, its actions up under a pointer and from the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const head = page.locator('.lane-head').first()
  const actions = head.locator('.lane-actions')
  const toggle = head.locator('.lane-toggle')
  await page.mouse.move(0, 0)
  await expect.poll(() => opacity(actions)).toBe(0)
  const resting = await toggle.boundingBox()

  // Under the pointer they come up, and nothing on the line moves to make room.
  await head.hover()
  await expect.poll(() => opacity(actions)).toBe(1)
  expect(await toggle.boundingBox()).toEqual(resting)
  await page.mouse.move(0, 0)
  await expect.poll(() => opacity(actions)).toBe(0)

  // From the keyboard the toggle's next stop is the first of them, and arriving
  // there is what shows them.
  await toggle.focus()
  await page.keyboard.press('Tab')
  const card = page.getByRole('button', { name: 'Open MAIN-401' })
  await expect(card).toBeFocused()
  await expect.poll(() => opacity(actions)).toBe(1)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: /chain of MAIN-401/u })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('.drawer')).toBeVisible()
})

test('a press on the toggle with the pointer does not leave the row’s actions up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const head = page.locator('.lane-head').first()
  await head.locator('.lane-toggle').click()
  await page.mouse.move(0, 0)
  await expect.poll(() => opacity(head.locator('.lane-actions'))).toBe(0)
})

test('an epic’s row says its state only once the epic has moved', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const stateOf = (reference: string) =>
    page
      .locator('.lane-head', { has: page.locator('.lane-reference', { hasText: reference }) })
      .locator('.lane-state')
  // In progress, it says so; not started, the norm of a board's epics, it says
  // nothing on screen, and the word is still there to be read out.
  await expect(stateOf('MAIN-401')).not.toHaveClass(/visually-hidden/u)
  await expect(stateOf('MAIN-410')).toHaveClass(/visually-hidden/u)
  await expect(stateOf('MAIN-410')).toHaveText('Backlog')
})

test('a finished cell is a line of text with no ground, until a tile can land there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const epic = lane(page, 'The first board')
  await epic.locator('.lane-toggle').click()
  const done = epic.locator('.lane-cell[data-state="done"]')
  const more = done.locator('.lane-more')
  await expect(more).toBeVisible()
  await page.mouse.move(0, 0)
  expect(await fill(done)).toBe('rgba(0, 0, 0, 0)')
  expect(await fill(more)).toBe('rgba(0, 0, 0, 0)')
  // A tile stood taller than that, and so did the ground that held only the offer.
  const cellBox = await done.boundingBox()
  const moreBox = await more.boundingBox()
  expect(Math.round((cellBox?.height ?? 0) - (moreBox?.height ?? 0))).toBe(16)
  // Under the pointer it reads as a control.
  await more.hover()
  await expect.poll(() => fill(more)).not.toBe('rgba(0, 0, 0, 0)')
  // Opened, the cell holds tiles, so it has its ground back.
  await more.click()
  await expect.poll(() => fill(done)).not.toBe('rgba(0, 0, 0, 0)')
})

const allOneRow = async (page: Page) =>
  page.locator('.workspace-tools').evaluate((row) =>
    [
      '.workspace-view-segments',
      '.workspace-grouping',
      'input[role="combobox"]',
      '.filter-preset',
      '.workspace-action',
    ].map((selector) => {
      const box = row.querySelector(selector)?.getBoundingClientRect()
      return box ? `${box.top}+${box.height}` : selector
    }),
  )

test('the grouping is the control its neighbours are, and reads as how the view is arranged', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  const grouping = page.getByRole('button', { name: GROUPING })
  await expect(page.locator('.workspace-tools').getByRole('switch')).toHaveCount(0)
  // Every control of the row stands at one top and one height.
  expect(new Set(await allOneRow(page)).size).toBe(1)
  // Pressed as the presets are: the same ground, ink and check.
  const preset = page.locator('.filter-preset').first()
  await page.mouse.move(0, 0)
  expect(await look(grouping)).toEqual(await look(preset))
  await expect(grouping).toHaveAttribute('aria-pressed', 'false')

  // By the view, and before the field: Tab goes view, grouping, field. Space
  // presses it, and it keeps its place and its focus.
  await grouping.focus()
  await page.keyboard.press('Space')
  await expect(grouping).toHaveAttribute('aria-pressed', 'true')
  await expect(grouping).toBeFocused()
  await expect(page.locator('.board-lane').first()).toBeVisible()
  expect(new Set(await allOneRow(page)).size).toBe(1)
  await page.keyboard.press('Tab')
  await expect(page.locator('.workspace-tools input[role="combobox"]')).toBeFocused()
  await grouping.focus()
  await page.keyboard.press('Enter')
  await expect(grouping).toHaveAttribute('aria-pressed', 'false')
  await expect(preset).toBeVisible()
  expect(await look(grouping)).toEqual(await look(preset))
})

/** Every control of the bar as it is drawn: a press may not move one of them. */
const barControls = (page: Page) =>
  page
    .locator(
      '.workspace-view-segments, .workspace-view-menu, .workspace-grouping, .filter-box, .filter-preset, .workspace-action',
    )
    .evaluateAll((controls) =>
      controls
        .filter((control) => getComputedStyle(control).display !== 'none')
        .map((control) => {
          const box = control.getBoundingClientRect()
          return [control.className, box.left, box.top, box.width, box.height].join(' ')
        }),
    )

/** What marks a press beside the tones: drawn where a colour is not all that says so. */
const pressMark = (chip: Locator) =>
  chip.evaluate((node) => {
    const mark = getComputedStyle(node, '::after')
    return mark.content === 'none' ? 'none' : mark.blockSize
  })

for (const width of [1680, 1440, 1260, 1024, 996, 960, 900, 760, 700, 390]) {
  test(`a press on the grouping moves nothing around it at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await installBackend(page)
    await serve(page)
    await openBoard(page, {})
    const grouping = page.getByRole('button', { name: GROUPING })
    await expect(grouping).toBeVisible()
    const resting = await barControls(page)
    expect(await pressMark(grouping)).toBe('none')
    await grouping.click()
    await expect(grouping).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.board-lane').first()).toBeVisible()
    expect(await barControls(page)).toEqual(resting)
    expect(await pressMark(grouping)).toBe('2px')
    await grouping.click()
    await expect(grouping).toHaveAttribute('aria-pressed', 'false')
    expect(await barControls(page)).toEqual(resting)
  })
}

// What a preset's press itself does.
test('a press on a preset does not change its size, and is more than a tone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  const preset = page.locator('.filter-preset').first()
  const resting = await preset.boundingBox()
  await preset.click()
  await expect(preset).toHaveAttribute('aria-pressed', 'true')
  const pressed = await preset.boundingBox()
  expect(pressed?.width).toBe(resting?.width)
  expect(await pressMark(preset)).toBe('2px')
})

test('a window of 1024px keeps the grouping’s word on the row, and its name', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  const grouping = page.getByRole('button', { name: GROUPING })
  await expect(grouping.locator('.grouping-word')).toBeVisible()
  await expect(grouping.locator('.grouping-glyph')).toBeHidden()
  await expect(grouping).toHaveAttribute('data-tooltip', GROUPING)
  const box = await grouping.boundingBox()
  expect(box?.height).toBe(36)
  const field = await page.locator('.filter-box').boundingBox()
  expect(box?.y).toBe(field?.y)
})

test('a chain’s section reaches its list with no chart in the way', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installBackend(page)
  await serveChain(page, largeChainHere())
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  // Between the map and the list: the figures, a verdict, one action and a heading.
  const mapEnd = await section
    .locator('.branch-map')
    .evaluate((map) => map.getBoundingClientRect().bottom)
  const firstRow = await topOf(section.locator('.chain-row').first())
  expect(firstRow - mapEnd).toBeLessThanOrEqual(140)
  await expect(section.locator('.chain-chart')).toHaveCount(0)
  // The scope and the way to the graph ride the heading's row.
  const heading = await section.locator('.section-header').boundingBox()
  const scope = await section.locator('.chain-scope').boundingBox()
  expect((scope?.y ?? 0) + (scope?.height ?? 0)).toBeLessThanOrEqual(
    (heading?.y ?? 0) + (heading?.height ?? 0),
  )
  // One action away, and opened by the keyboard as by the pointer.
  const details = section.getByRole('button', { name: 'Chart and pace' })
  await details.focus()
  await page.keyboard.press('Enter')
  await expect(section.locator('.chain-chart')).toBeVisible()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
})

test.describe('where nothing can hover', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('an epic’s row keeps its actions up, on a row of no more than two', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installBackend(page)
    await serve(page)
    await openBoard(page)
    const head = page.locator('.lane-head').first()
    const card = page.getByRole('button', { name: 'Open MAIN-401' })
    await expect.poll(() => opacity(head.locator('.lane-actions'))).toBe(1)
    await expect(card).toBeVisible()
    await card.tap()
    await expect(page.locator('.drawer')).toBeVisible()
  })
})

test('reduced motion brings a row’s actions up at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const actions = page.locator('.lane-actions').first()
  const duration = await actions.evaluate((node) => getComputedStyle(node).transitionDuration)
  // The page's own rule for a reader who asked: a hundredth of a millisecond.
  expect(Number.parseFloat(duration)).toBeLessThan(0.001)
})
