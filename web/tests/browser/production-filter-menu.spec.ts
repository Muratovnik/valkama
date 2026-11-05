/**
 * The filter's menu opens to what a person did, in the field itself, and to nothing else:
 * not to Tab, not to focus coming back when a card or a dialog closes or the window returns.
 * Typing narrows it, and with nothing left to offer it leaves the work in sight.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { boardSpace } from './boardFixtures.ts'
import { centre } from './boardPage.ts'
import {
  addressState,
  boxOf,
  chips,
  field,
  menu,
  menuLabels,
  openSpace,
  shownTiles,
} from './filterPage.ts'
import { test } from './test.ts'

const expanded = (page: Page, value: 'false' | 'true') =>
  expect(field(page)).toHaveAttribute('aria-expanded', value)

async function board(page: Page, width = 1440, height = 900) {
  await openSpace(page, { width, height })
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
}

test('there is no Filter button; a press in the field opens every group, picked values marked', async ({
  page,
}) => {
  await board(page)
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0)
  await expect(field(page)).toHaveAttribute('placeholder', 'Reference, title, label…')
  await expanded(page, 'false')
  await expect(menu(page)).toBeHidden()

  await field(page).click()
  await expanded(page, 'true')
  for (const group of ['Quick filters', 'State', 'Kind', 'Priority', 'Label'])
    await expect(menu(page).getByRole('group', { name: group, exact: true })).toBeVisible()
  await expect(field(page)).toBeFocused()

  await page.getByRole('option', { name: 'ui', exact: true }).click()
  await expect(page.getByRole('option', { name: 'ui', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // A value picked leaves the menu open, and the others where they were.
  await expanded(page, 'true')
  // Most used first, then by name.
  expect(await menuLabels(page)).toEqual(['board', '+ui', 'api'])
  await page.getByRole('option', { name: 'board', exact: true }).click()
  expect(await menuLabels(page)).toEqual(['+board', '+ui', 'api'])
})

test('`/` from the page comes to the field and opens the menu', async ({ page }) => {
  await board(page)
  await page.locator('.workspace-stage').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('/')
  await expect(field(page)).toBeFocused()
  await expanded(page, 'true')
  await expect(menu(page)).toBeVisible()
})

test('Tab reaches the field without opening the menu, and ↓ opens it', async ({ page }) => {
  await board(page)
  await page.getByRole('button', { name: 'Group the board by epic' }).focus()
  await page.keyboard.press('Tab')
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')
  await page.keyboard.press('ArrowDown')
  await expanded(page, 'true')
  await expect(field(page)).toHaveAttribute('aria-activedescendant', /.+/u)
  // Tab goes on past the menu, and takes it along.
  await page.keyboard.press('Tab')
  await expanded(page, 'false')
})

test('focus that comes back by itself does not open the menu', async ({ page }) => {
  await board(page)

  // Reset takes the button that did it away and hands the caret to the field.
  await field(page).click()
  await page.getByRole('option', { name: 'ui', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.locator('.workspace-figures').getByRole('button', { name: 'Reset' }).click()
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')

  // The chips hand it back as well.
  await field(page).click()
  await page.getByRole('option', { name: 'ui', exact: true }).click()
  await page.keyboard.press('ArrowLeft')
  await expect(chips(page).last()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')

  // A dialog opened with focus in the field gives it back as it closes. The press is sent to
  // the button alone, so the field keeps focus until the dialog takes it.
  await field(page).focus()
  await page.locator('.workspace-action').evaluate((button: HTMLElement) => button.click())
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')

  // A card too, whichever way it closes.
  await page
    .locator('.tile-open')
    .first()
    .evaluate((tile: HTMLElement) => tile.click())
  await expect(page.locator('.drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expanded(page, 'false')
})

test('the window leaving closes the menu, and its return does not open it', async ({ page }) => {
  await board(page)
  await field(page).click()
  await expanded(page, 'true')
  // What Alt+Tab does to a field in focus, which a headless browser never gets: focus leaves
  // and comes back to it with no press and no key.
  const away = () =>
    field(page).evaluate((input: HTMLInputElement) => {
      input.blur()
      window.dispatchEvent(new Event('blur'))
    })
  const back = () =>
    field(page).evaluate((input: HTMLInputElement) => {
      window.dispatchEvent(new Event('focus'))
      input.focus()
    })
  await away()
  await expanded(page, 'false')
  await back()
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')
  // The next press in it is a press like any other.
  await field(page).click()
  await expanded(page, 'true')
})

test('text narrows the menu and the work; a number leaves no frame and the work in sight', async ({
  page,
}) => {
  await board(page)
  await field(page).click()
  await page.keyboard.type('boa')
  await expect(page.getByRole('option')).toHaveText(['board'])

  await field(page).fill('MAIN-402')
  await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402'])
  await expanded(page, 'false')
  await expect(menu(page)).toBeHidden()
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(field(page)).not.toHaveAttribute('aria-activedescendant', /.*/u)
  // The press lands on the tile rather than on anything over it.
  const reached = await page.locator('[data-reference="MAIN-402"]').evaluate((tile) => {
    const { left, top, width, height } = tile.getBoundingClientRect()
    return tile.contains(document.elementFromPoint(left + width / 2, top + height / 2))
  })
  expect(reached).toBe(true)

  // Enter has nothing to take: no card, no chip, and the text stays.
  await page.keyboard.press('Enter')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(chips(page)).toHaveCount(0)
  await expect(field(page)).toHaveValue('MAIN-402')
  await expect.poll(() => addressState(page)).toEqual({ view: 'kanban', query: 'MAIN-402' })

  // Letters typed away bring the list back when it has something again.
  await field(page).fill('board')
  await expect(page.getByRole('option')).toHaveText(['board'])
})

test('a letter typed in a closed field opens the menu', async ({ page }) => {
  await board(page)
  await field(page).focus()
  await expanded(page, 'false')
  await page.keyboard.type('boa')
  await expect(menu(page)).toBeVisible()
})

test('Escape takes one step per press, and the list does not come back with the text', async ({
  page,
}) => {
  await board(page)
  await field(page).click()
  await page.keyboard.type('board')
  await expanded(page, 'true')

  await page.keyboard.press('Escape')
  await expanded(page, 'false')
  await expect(field(page)).toHaveValue('board')

  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveValue('')
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')

  await page.keyboard.press('Escape')
  await expect(field(page)).not.toBeFocused()

  // With no menu in sight, the first press is the text's.
  await field(page).fill('MAIN-402')
  await expanded(page, 'false')
  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveValue('')
  await expanded(page, 'false')
})

test('× takes the text and opens nothing that was not open', async ({ page }) => {
  await board(page)
  await field(page).fill('MAIN-402')
  await expanded(page, 'false')
  await page.getByRole('button', { name: 'Clear the text' }).click()
  await expect(field(page)).toHaveValue('')
  await expect(field(page)).toBeFocused()
  await expanded(page, 'false')
})

test('a press in the open field keeps the menu; a press elsewhere closes it', async ({ page }) => {
  await board(page)
  await field(page).click()
  await field(page).click()
  await expanded(page, 'true')
  await page.locator('.workspace-stage').click({ position: { x: 4, y: 4 } })
  await expanded(page, 'false')

  // The presets stand beside it, and a press there is not a press in the menu.
  await field(page).click()
  const presets = page.locator('.filter-presets')
  await expect(presets.getByRole('button')).toHaveCount(2)
  await presets.getByRole('button').first().click()
  await expect(presets.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')
  await expanded(page, 'false')
})

test('a press on a group’s name stays in the menu, and the caret stays in the field', async ({
  page,
}) => {
  await board(page)
  await field(page).click()
  await menu(page).getByText('Quick filters', { exact: true }).click()
  await expect(menu(page)).toBeVisible()
  await expect(field(page)).toBeFocused()
})

test('a press that lands on the field only because what stood there went does not open it', async ({
  page,
}) => {
  await board(page)
  // A double click on something over the field that leaves at the first press.
  const { x, y } = await centre(field(page))
  await page.evaluate(
    ({ x, y }) => {
      const over = document.createElement('button')
      over.style.cssText = `position:fixed;left:${x - 20}px;top:${y - 10}px;width:40px;height:20px;z-index:9999`
      over.addEventListener('click', () => over.remove())
      document.body.append(over)
    },
    { x, y },
  )
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  await page.mouse.down()
  await page.mouse.up()
  await expect(menu(page)).toBeHidden()
  // A hand that moved to it means it.
  await page.mouse.move(x + 8, y)
  await page.mouse.down()
  await page.mouse.up()
  await expect(menu(page)).toBeVisible()
})

test('opening the menu changes nothing on the board', async ({ page }) => {
  await board(page)
  const boxes = () =>
    page.evaluate(() =>
      ['.workspace-head', '.workspace-stage', '.work-item-tile', '.work-filter'].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect()
        return box ? [box.x, box.y, box.width, box.height] : null
      }),
    )
  const before = await boxes()
  await page.locator('.workspace-stage').evaluate((stage) => {
    const seen = { changes: 0 }
    new MutationObserver((records) => {
      seen.changes += records.length
    }).observe(stage, { attributes: true, characterData: true, childList: true, subtree: true })
    Object.assign(window, { seen })
  })
  await field(page).click()
  await expect(menu(page)).toBeVisible()
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
  expect(await boxes()).toEqual(before)
  expect(
    await page.evaluate(() => (window as unknown as { seen: { changes: number } }).seen.changes),
  ).toBe(0)
})

test('opening the menu moves nothing on the graph', async ({ page }) => {
  await openSpace(page, { state: { view: 'graph' } })
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const pane = page.locator('.vue-flow__transformationpane')
  const held = await pane.getAttribute('style')
  const stage = await page.locator('.workspace-stage').boundingBox()
  await field(page).click()
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
  await expect(pane).toHaveAttribute('style', held ?? '')
  expect(await page.locator('.workspace-stage').boundingBox()).toEqual(stage)
})

test('on a phone the menu stands under the bar and inside the screen', async ({ page }) => {
  await board(page, 390, 844)
  await field(page).click()
  await expect(menu(page)).toBeVisible()
  const box = await boxOf(menu(page))
  const head = await boxOf(page.locator('.workspace-head'))
  expect(box.y).toBeGreaterThanOrEqual(head.y + head.height)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(box.y + box.height).toBeLessThanOrEqual(844)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
})

test('a long list of labels scrolls under a head that stays, and the arrows stay clear of it', async ({
  page,
}) => {
  const labels = Array.from({ length: 60 }, (_, index) => `label-${String(index).padStart(2, '0')}`)
  // An item holds twenty at most, so three of them hold all of these.
  const carriers = ['MAIN-402', 'MAIN-403', 'MAIN-404']
  const items = boardSpace().map((item) => {
    const at = carriers.indexOf(item.reference)
    return { ...item, labels: at < 0 ? [] : labels.slice(at * 20, (at + 1) * 20) }
  })
  await openSpace(page, { items })
  await field(page).click()
  await expect(menu(page)).toBeVisible()

  const list = menu(page)
  const head = list.getByRole('group', { name: 'Label', exact: true }).locator('.option-group-head')
  await list.getByRole('option', { name: 'label-59' }).scrollIntoViewIfNeeded()
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  // The choice stands at the top of the list, beside its group's name, with labels under it.
  const listBox = await boxOf(list)
  const headBox = await boxOf(head)
  expect(headBox.y).toBeGreaterThanOrEqual(listBox.y)
  expect(headBox.y).toBeLessThan(listBox.y + 8)
  await expect(head.getByRole('option')).toHaveCount(2)
  await expect(head.getByRole('option').first()).toBeInViewport()

  // Walking back up, the highlighted row is never under that head.
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('ArrowUp')
    const covered = await page.evaluate(() => {
      const row = document.querySelector('.option-row[data-highlighted]')
      const over = document.querySelector('.filter-menu .option-group-head:has(.option-choices)')
      return {
        rowTop: row?.getBoundingClientRect().top,
        headBottom: over?.getBoundingClientRect().bottom,
      }
    })
    expect(covered.rowTop).toBeGreaterThanOrEqual((covered.headBottom ?? 0) - 1)
  }
})

test('the open menu passes the accessibility checks', async ({ page }) => {
  await board(page)
  await field(page).click()
  await expect(menu(page)).toBeVisible()
  const results = await new AxeBuilder({ page })
    .include('.work-filter')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})
