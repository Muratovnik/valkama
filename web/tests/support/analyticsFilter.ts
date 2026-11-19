/**
 * The Analytics page's filter as a reader works it: the field on the bar opens its menu on the
 * dimensions, a dimension's row steps into its values, and a value's row puts it in the filter or
 * takes it out. Every step is a press on the rows the menu draws, so a spec reads what a reader
 * would be offered.
 */
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

type Holder = Pick<VueWrapper, 'find' | 'findAll' | 'get'>

const menu = (page: Holder) => page.get('.analytics-filter-add')

/** The words of the rows the menu shows now, in their order. */
export const menuRows = (page: Holder) =>
  menu(page)
    .findAll('[role="option"] .option-text')
    .map((row) => row.text())

/** The words of the values on show that the filter holds. */
export const chosenRows = (page: Holder) =>
  menu(page)
    .findAll('[role="option"][aria-selected="true"] .option-text')
    .map((row) => row.text())

/** What the menu says under the values on show, where it says anything. */
export const menuNote = (page: Holder) => menu(page).find('.option-note')

function row(page: Holder, words: string): DOMWrapper<Element> {
  const found = menu(page)
    .findAll('[role="option"]')
    .find((one) => one.find('.option-text').exists() && one.find('.option-text').text() === words)
  if (!found) throw new Error(`no row «${words}»: ${menuRows(page).join(', ')}`)
  return found
}

/** Opens the menu where it is closed, as a press in the field does. */
export async function openFilter(page: Holder) {
  const field = menu(page).get('input')
  if (field.attributes('aria-expanded') !== 'true') await field.trigger('click')
  await flushPromises()
}

/** Steps into a dimension's values from the dimensions, the menu opened first where it is closed. */
export async function openDimension(page: Holder, dimension: string) {
  await openFilter(page)
  await row(page, dimension).trigger('click')
  await flushPromises()
}

/** Presses a row of the menu on show: a value goes into its filter, or out if it was in. */
export async function pressRow(page: Holder, words: string) {
  await row(page, words).trigger('click')
  await flushPromises()
}
