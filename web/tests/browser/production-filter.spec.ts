/**
 * The Work filter in the built application: one row of controls and a head no
 * taller than 84px where the bar has room, a filter that survives a reload and
 * Back because the address holds it, the same token whichever way it was made,
 * and the keyboard of the bar — `/`, ↓, Enter, Escape one step at a time, ←
 * to the chips and Backspace out of them.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

const board = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

/** The module state the address holds now. */
async function addressState(page: Page) {
  const url = new URL(page.url())
  return parsePlatformRoute(`${url.pathname}${url.search}`).state ?? {}
}

async function open(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height })
  await installBackend(page)
  await page.goto(board)
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
}

const field = (page: Page) => page.getByRole('combobox', { name: 'Filter work' })
const chips = (page: Page) => page.locator('.workspace-chips .filter-chip')

for (const width of [1440, 1024]) {
  test(`the bar is one row of controls and at most 84px tall at ${width}px`, async ({ page }) => {
    await open(page, width)
    const geometry = await page.locator('.workspace-head').evaluate((head) => {
      const tools = [...head.querySelectorAll<HTMLElement>('.workspace-tools > *')].filter(
        (element) => element.offsetParent !== null,
      )
      const boxes = tools.map((element) => element.getBoundingClientRect())
      return {
        height: head.getBoundingClientRect().height,
        oneLine:
          Math.max(...boxes.map((box) => box.top)) < Math.min(...boxes.map((box) => box.bottom)),
        last: tools.at(-1)?.className ?? '',
      }
    })
    expect(geometry.oneLine, 'one row of controls').toBe(true)
    expect(geometry.height).toBeLessThanOrEqual(84)
    // The field has room for its whole hint here.
    await expect(field(page)).toHaveAttribute('placeholder', 'Reference or title')
    // The one primary action ends the row.
    expect(geometry.last).toContain('workspace-action')
    // A filter does not make the bar taller.
    await field(page).fill('MAIN')
    await expect(page.locator('.workspace-figures')).toContainText('Reset')
    const filtered = await page.locator('.workspace-head').boundingBox()
    expect(filtered?.height).toBe(geometry.height)
    await expectNoSilentClipping(page, `Work bar at ${width}px`)
  })
}

test('the grouped board says its epics as rows on the counts line, where a phone has no room for it', async ({
  page,
}) => {
  // The board's own fixture has epics to draw as rows; the flat board is the start.
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page, {})
  const grouping = page.getByRole('switch', { name: 'Group the board by epic' })
  const rows = page.locator('.workspace-rows')
  await expect(rows).toBeHidden()
  await grouping.click()
  await expect(rows).toBeVisible()
  await expect(rows).toContainText(/epics? as (rows|a row)/)
  await grouping.click()
  await expect(rows).toBeHidden()
  // A phone keeps the line at its height: the rows are not drawn there at all.
  await page.setViewportSize({ width: 390, height: 844 })
  await grouping.click()
  await expect(page.locator('.workspace-figures')).toBeVisible()
  await expect(rows).toBeHidden()
})

test('a filter survives a reload and Back, because the address holds it', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('option', { name: 'phase-1' }).click()
  await page.keyboard.press('Escape')
  await field(page).fill('MAIN-26')
  await expect(chips(page)).toHaveText(['Label: phase-1'])
  await expect.poll(() => addressState(page)).toEqual({ query: 'MAIN-26', labels: 'phase-1' })
  await expect(page.locator('.workspace-figures')).toContainText('1 of')

  await page.reload()
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await expect(chips(page)).toHaveText(['Label: phase-1'])
  await expect(field(page)).toHaveValue('MAIN-26')
  await expect(page.locator('.work-item-tile')).toHaveCount(1)

  await page.locator('.work-item-tile').first().click()
  await expect(page.locator('.drawer')).toBeVisible()
  await page.goBack()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(chips(page)).toHaveText(['Label: phase-1'])
  await expect(page.locator('.work-item-tile')).toHaveCount(1)
})

test('a preset and the menu make the same filter', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Assigned' }).click()
  const fromPreset = await addressState(page)
  expect(fromPreset).toEqual({ held: true })
  await page.getByRole('button', { name: 'Assigned' }).click()
  await expect.poll(() => addressState(page)).toEqual({})

  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('option', { name: /^Assigned/u }).click()
  await expect.poll(() => addressState(page)).toEqual(fromPreset)
  await expect(page.getByRole('button', { name: /^Assigned/u })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the bar’s keyboard: `/`, ↓ and Enter, Escape one step at a time, ← and Backspace', async ({
  page,
}) => {
  await open(page)
  await page.locator('.workspace-stage').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('/')
  await expect(field(page)).toBeFocused()

  // Typing narrows the menu; ↓ opens it on its first value; Enter takes it.
  await page.keyboard.type('phase')
  await page.keyboard.press('ArrowDown')
  await expect(field(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('option')).toHaveText(['phase-1'])
  await page.keyboard.press('Enter')
  await expect(chips(page)).toHaveText(['Label: phase-1'])
  await expect(field(page)).toHaveValue('')

  // Escape: the menu, then the text, then the field — and never the page behind.
  await page.keyboard.type('MAIN')
  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(field(page)).toHaveValue('MAIN')
  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveValue('')
  await expect(field(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(field(page)).not.toBeFocused()
  await expect(chips(page)).toHaveText(['Label: phase-1'])

  // ← from the start of the text reaches the chips; Backspace takes one out.
  await field(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(chips(page).last()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(field(page)).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(chips(page)).toHaveCount(0)
  await expect.poll(() => addressState(page)).toEqual({})
})

/**
 * A filter of more values than one line holds keeps every chip on screen. The row
 * used to run on under the workspace's clip, where no wheel or swipe reached it, and
 * a chip taking focus there scrolled the whole workspace aside, board and all.
 */
for (const width of [1440, 1024, 390]) {
  test(`every chip of a long filter stands on screen, and the keyboard walks them in place, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await installBackend(page)
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        state: {
          cat: 'backlog,queued,active,review,blocked,completed,cancelled',
          kind: 'bug,task,epic,improvement',
          pri: 'low,medium,high,urgent',
        },
      }),
    )
    await expect(chips(page)).toHaveCount(15)
    const outside = () =>
      chips(page).evaluateAll((list) =>
        list
          .filter((chip) => {
            const { left, right } = chip.getBoundingClientRect()
            return left < 0 || right > document.documentElement.clientWidth
          })
          .map((chip) => chip.textContent),
      )
    expect(await outside()).toHaveLength(0)
    await expectNoSilentClipping(page, `Work bar with 15 chips at ${width}px`)

    await field(page).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(chips(page).last()).toBeFocused()
    for (let step = 1; step < 15; step += 1) await page.keyboard.press('ArrowLeft')
    await expect(chips(page).first()).toBeFocused()
    const shell = page.locator('.planning-workspace-shell')
    expect(await shell.evaluate((node) => [node.scrollLeft, node.scrollTop])).toEqual([0, 0])

    // Each one takes itself out from where it stands.
    await page.keyboard.press('Backspace')
    await expect(chips(page)).toHaveCount(14)
    expect(await outside()).toHaveLength(0)
  })
}

test('on a phone the view, the filter and the action share the first line', async ({ page }) => {
  await open(page, 390, 844)
  const first = await page
    .locator('.workspace-view-menu, .workspace-filter, .workspace-action')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom }
      }),
    )
  expect(first).toHaveLength(3)
  // One line: each starts above where every other ends.
  expect(Math.max(...first.map((box) => box.top))).toBeLessThan(
    Math.min(...first.map((box) => box.bottom)),
  )
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('option', { name: 'phase-1' }).click()
  await page.keyboard.press('Escape')
  await expect(chips(page)).toHaveText(['Label: phase-1'])
  await expectNoSilentClipping(page, 'Work bar at 390px')
})

test('on a phone the field’s hint fits it, and the grouping says its word until a filter needs the room', async ({
  page,
}) => {
  await open(page, 390, 844)
  // The whole hint was cut to «Reference or t»; the short one fits, and the
  // field's name stays whole.
  await expect(field(page)).toHaveAttribute('placeholder', 'Search')
  await expect(field(page)).toHaveAccessibleName('Filter work')
  const hint = await field(page).evaluate((input: HTMLInputElement) => {
    const style = getComputedStyle(input)
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return { text: Number.NaN, room: 0 }
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    return {
      text: context.measureText(input.placeholder).width,
      room:
        input.clientWidth -
        Number.parseFloat(style.paddingInlineStart) -
        Number.parseFloat(style.paddingInlineEnd),
    }
  })
  expect(hint.text, JSON.stringify(hint)).toBeLessThanOrEqual(hint.room)
  // The switch says what it does beside the counts, on the bar's second line.
  const grouping = page.getByRole('switch', { name: 'Group the board by epic' })
  await expect(grouping.locator('.toggle-state')).toHaveText('By epic')
  await expect(grouping.locator('.toggle-state')).toBeVisible()
  const line = async () =>
    page.locator('.workspace-head').evaluate((head) => {
      const box = (selector: string) =>
        head.querySelector(selector)?.getBoundingClientRect() ?? new DOMRect()
      return {
        height: head.getBoundingClientRect().height,
        switchBottom: box('.workspace-grouping').bottom,
        figuresTop: box('.workspace-figures').top,
      }
    })
  const resting = await line()
  expect(resting.height).toBeLessThanOrEqual(100)
  expect(resting.figuresTop).toBeLessThan(resting.switchBottom)
  // A filter's reset takes the word's room rather than a third line, so the
  // work does not move as a filter turns on; the switch keeps its name.
  await field(page).fill('MAIN')
  await expect(page.locator('.workspace-figures')).toContainText('Reset')
  await expect(grouping.locator('.toggle-state')).toBeHidden()
  await expect(grouping).toHaveAccessibleName('Group the board by epic')
  const filtered = await line()
  expect(filtered.height).toBe(resting.height)
  expect(filtered.figuresTop).toBeLessThan(filtered.switchBottom)
  await expectNoSilentClipping(page, 'Work bar at 390px with a filter')
})
