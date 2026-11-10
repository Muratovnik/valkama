/**
 * The menu primitive under the keys and the pointer: the WAI-ARIA APG menu button. The
 * trigger opens it on its first entry; the arrows walk the entries and wrap, Home and End go
 * to the ends; Escape and a choice close it and hand focus back to the trigger; a setting and
 * a choice say their state with a check.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

async function openSurface(page: Page) {
  await page.goto('/tests/browser/harness.html?lang=en&surface=menu')
  const trigger = page.getByRole('button', { name: 'More' })
  await expect(trigger).toBeVisible()
  return trigger
}

/** The entries in order, as a reader of the menu meets them. */
const entries = (page: Page) => page.locator('[role="menu"] [role^="menuitem"]')

test('the trigger names a menu, and Enter opens it on its first entry', async ({ page }) => {
  const trigger = await openSurface(page)
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.locator('.menu-before').focus()
  await page.keyboard.press('Tab')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(entries(page)).toHaveCount(5)
  await expect(entries(page).first()).toBeFocused()
  await expect(entries(page).first()).toHaveAttribute('role', 'menuitem')
  await expect(entries(page).nth(1)).toHaveAttribute('role', 'menuitemcheckbox')
  await expect(entries(page).nth(2)).toHaveAttribute('role', 'menuitemradio')
})

test('the arrows walk the entries and wrap, Home and End go to the ends', async ({ page }) => {
  const trigger = await openSurface(page)
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const all = entries(page)
  await expect(all.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(all.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(all.last()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(all.first()).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(all.last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(all.first()).toBeFocused()
  // A typed letter goes to the entry it starts.
  await page.keyboard.press('s')
  await expect(page.getByRole('menuitemradio', { name: 'State' })).toBeFocused()
})

test('Escape closes the menu and gives focus back to the trigger', async ({ page }) => {
  const trigger = await openSurface(page)
  await trigger.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('a choice is made, closes the menu, gives focus back and is checked next time', async ({
  page,
}) => {
  const trigger = await openSurface(page)
  await trigger.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemcheckbox', { name: 'Pin to Work' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.menu-said')).toHaveText('pin true')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Pin to Work' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByRole('menuitemradio', { name: 'Nothing' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('menuitemradio', { name: 'Epic' }).click()
  await expect(page.locator('.menu-said')).toHaveText('group epic')
  await expect(trigger).toBeFocused()
})

test('the menu is a surface over the page: its fill, its edge, its shadow and room inside', async ({
  page,
}) => {
  const trigger = await openSurface(page)
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const look = await menu.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      fill: style.backgroundColor,
      edge: style.borderTopWidth,
      shadow: style.boxShadow,
      padding: style.paddingTop,
    }
  })
  // Reka draws the menu through a portal, where a style scoped to the component never lands.
  expect(look.fill, 'the menu has a fill of its own').not.toBe('rgba(0, 0, 0, 0)')
  expect(look.edge).toBe('1px')
  expect(look.shadow).not.toBe('none')
  expect(Number.parseFloat(look.padding)).toBeGreaterThan(0)
})

test('every entry is a row of the control height, and the menu stays in the window', async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 })
    const trigger = await openSurface(page)
    await trigger.click()
    const menu = page.getByRole('menu')
    const bounds = await menu.evaluate((element) => element.getBoundingClientRect().toJSON())
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    const rows = await entries(page).evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height),
    )
    for (const height of rows) expect(height).toBe(40)
    await page.keyboard.press('Escape')
  }
})
