/**
 * How labels combine is in sight as the filter's menu opens, nothing scrolled, on a space shaped
 * as real ones are: every state category, every kind, a dozen holders and sixty labels. The menu
 * is as tall as the window lets it be, and the label group's head waits at its lower edge until
 * the list reaches it. A scenario of a few entries passed all this while the head stood 37px
 * below the menu on a real space.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { boardSpace } from './boardFixtures.ts'
import { boxOf, field, menu, openSpace } from './filterPage.ts'
import { identity } from './planningFixtures.ts'
import { test } from './test.ts'

const CATEGORIES = ['backlog', 'queued', 'active', 'review', 'completed', 'blocked', 'cancelled']

/** A workflow of so many states, walking the seven categories over and over. */
const workflowOf = (count: number) => ({
  workflow_id: identity(700),
  name: 'Default',
  initial_state_id: identity(900),
  states: Array.from({ length: count }, (_, index) => {
    const category = CATEGORIES[index % CATEGORIES.length]
    return {
      state_id: identity(900 + index),
      key: `state-${index}`,
      name: `State ${index}`,
      category,
      is_terminal: category === 'completed' || category === 'cancelled',
      position: index,
    }
  }),
  transitions: [],
})

const LABELS = Array.from({ length: 60 }, (_, index) => `label-${String(index).padStart(2, '0')}`)
const HOLDERS = Array.from({ length: 12 }, (_, index) => `agent-${index}`)

/** The board's work, carrying the labels and held by the holders, an item at most twenty each. */
const realSpace = () =>
  boardSpace().map((item, index) => ({
    ...item,
    labels: LABELS.slice((index % 3) * 20, (index % 3) * 20 + 20),
    claim_ref: HOLDERS[index % HOLDERS.length],
  }))

async function openMenu(page: Page, width: number, height: number, states = 7) {
  await openSpace(page, { height, items: realSpace(), width, workflow: workflowOf(states) })
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await field(page).click()
  await expect(menu(page)).toBeVisible()
}

const labelGroup = (page: Page) => menu(page).getByRole('group', { name: 'Label', exact: true })
const head = (page: Page) => labelGroup(page).locator('.option-group-head')
const choices = (page: Page) => head(page).getByRole('option', { name: /^Labels: /u })

/** Which of these stand wholly on screen, inside the menu, with nothing drawn over them. */
function inSight(page: Page) {
  return head(page)
    .locator('.option-group-name, .option-choice')
    .evaluateAll((parts) => {
      const list = parts[0]?.closest('[role="listbox"]')?.getBoundingClientRect()
      return parts.map((part) => {
        const { bottom, left, right, top } = part.getBoundingClientRect()
        const shown =
          list !== undefined &&
          top >= list.top &&
          bottom <= list.bottom &&
          bottom <= window.innerHeight &&
          part.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2))
        return `${part.textContent?.trim()}: ${shown ? 'in sight' : 'out of sight'}`
      })
    })
}

const ALL_IN_SIGHT = ['Label: in sight', 'all: in sight', 'any: in sight']

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [390, 844],
  // A window short enough that the first groups alone outrun it.
  [1280, 420],
  [390, 480],
]) {
  for (const states of [7, 14]) {
    test(`labels can be seen to combine, nothing scrolled, ${states} states at ${width}x${height}`, async ({
      page,
    }) => {
      await openMenu(page, width, height, states)
      const list = menu(page)
      expect(await list.evaluate((node) => node.scrollTop)).toBe(0)
      // The scenario holds what a real space holds, or this says nothing.
      await expect(list.getByRole('group', { name: 'State', exact: true }).getByRole('option'))
        // The menu offers a state category once, however many states stand in it.
        .toHaveCount(7)
      await expect(list.getByRole('group', { name: 'Kind', exact: true }).getByRole('option'))
        // The four kinds.
        .toHaveCount(4)
      expect(await inSight(page)).toEqual(ALL_IN_SIGHT)
      // The menu stands inside the window and starts at the bar, whatever its height.
      const box = await boxOf(list)
      expect(box.y + box.height).toBeLessThanOrEqual(height)
      const bar = await boxOf(page.locator('.work-filter'))
      expect(box.y).toBeGreaterThanOrEqual(bar.y)
    })
  }
}

test('the menu takes the height the window has, and no more than its entries need', async ({
  page,
}) => {
  await openMenu(page, 1280, 800)
  const tall = await boxOf(menu(page))
  expect(tall.y + tall.height).toBeGreaterThan(760)

  await field(page).fill('label-0')
  await expect(menu(page).getByRole('option')).toHaveCount(10)
  const short = await boxOf(menu(page))
  expect(short.height).toBeLessThan(tall.height)
  expect(short.y).toBe(tall.y)
})

test('a window made shorter while the menu is open keeps it inside, with the choice in sight', async ({
  page,
}) => {
  await openMenu(page, 1280, 800)
  await page.setViewportSize({ width: 1280, height: 480 })
  await expect.poll(async () => inSight(page)).toEqual(ALL_IN_SIGHT)
  const box = await boxOf(menu(page))
  expect(box.y + box.height).toBeLessThanOrEqual(480)
})

test('the choice is pressed where it waits, and nothing scrolls', async ({ page }) => {
  await openMenu(page, 1280, 800)
  const list = menu(page)
  // By the pointer where it stands: a locator's click first scrolls a sticky box to its own place.
  const { height, width, x, y } = await boxOf(choices(page).nth(1))
  await page.mouse.click(x + width / 2, y + height / 2)
  await expect(choices(page).nth(1)).toHaveAttribute('aria-selected', 'true')
  expect(await list.evaluate((node) => node.scrollTop)).toBe(0)
  await expect(field(page)).toBeFocused()
})

test('the head does not hide the list: scrolled, the labels stand under it to the last', async ({
  page,
}) => {
  await openMenu(page, 1280, 800)
  const list = menu(page)
  const first = labelGroup(page).getByRole('option', { name: 'label-00', exact: true })
  const last = labelGroup(page).getByRole('option', { name: 'label-59', exact: true })

  // Nothing of the list is drawn under the head that waits at the edge.
  await expect(first).not.toBeInViewport({ ratio: 1 })

  await first.scrollIntoViewIfNeeded()
  await expect(first).toBeInViewport({ ratio: 1 })
  const row = await boxOf(first)
  const stood = await boxOf(head(page))
  expect(stood.y + stood.height).toBeLessThanOrEqual(row.y)

  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(last).toBeInViewport({ ratio: 1 })
  const top = await boxOf(list)
  const pinned = await boxOf(head(page))
  expect(pinned.y).toBeLessThan(top.y + 8)
  expect(await inSight(page)).toEqual(ALL_IN_SIGHT)
})

test('walking down with the arrows, the highlighted row is never under the head at the edge', async ({
  page,
}) => {
  await openMenu(page, 1280, 420)
  await field(page).focus()
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press('ArrowDown')
    const covered = await page.evaluate(() => {
      const row = document.querySelector('.filter-menu [data-highlighted]')
      const over = document.querySelector('.filter-menu .option-group-head:has(.option-choices)')
      const list = document.querySelector('.filter-menu')
      if (!row || !over || !list) return 'nothing to compare'
      const rowBox = row.getBoundingClientRect()
      if (rowBox.bottom > list.getBoundingClientRect().bottom + 1) return 'below the menu'
      if (over.contains(row)) return ''
      const overBox = over.getBoundingClientRect()
      return rowBox.bottom > overBox.top + 1 && rowBox.top < overBox.bottom - 1
        ? 'under the head'
        : ''
    })
    expect(covered, `step ${step}`).toBe('')
  }
})

test('a space with fewer than two labels has no choice, and no head waits at the edge', async ({
  page,
}) => {
  const items = boardSpace().map((item, index) => ({ ...item, labels: index ? [] : ['only'] }))
  await openSpace(page, { height: 420, items, width: 1280, workflow: workflowOf(7) })
  await field(page).click()
  await expect(menu(page)).toBeVisible()
  await expect(head(page).getByRole('option')).toHaveCount(0)
  await expect(head(page)).not.toBeInViewport({ ratio: 1 })
})
