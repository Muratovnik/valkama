/**
 * The Analytics bar's filter in the built app, as a reader works it: a press in its field opens
 * the menu on the dimensions, and a dimension's row steps into its values.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** The bar's filter: its field, the menu it opens and the chips it sets on the bar. */
export const filterParts = (page: Page) => {
  const filter = page.locator('.analytics-filter-add')
  return {
    field: filter.locator('input'),
    menu: filter.getByRole('listbox'),
    chips: page.locator('.analytics-bar-chips [data-filter-chip]'),
  }
}

/**
 * Opens the bar's filter menu with a press in its field and steps into a dimension's values, as a
 * reader does; the menu stays open on them.
 */
export async function openDimension(page: Page, dimension: string) {
  const { field, menu } = filterParts(page)
  await field.click()
  await menu.getByRole('option', { name: dimension, exact: true }).click()
  await expect(menu.getByRole('option', { name: new RegExp(`^${dimension}: `, 'u') })).toHaveCount(
    1,
  )
  return menu
}
