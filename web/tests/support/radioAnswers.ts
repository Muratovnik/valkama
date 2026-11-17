import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import { present } from './present.ts'

type Wrapper = Pick<VueWrapper, 'findAll'>

/**
 * The radio buttons of one single-answer group, in the order they are drawn. A group of
 * them, not any radio group: an editor's Write or Preview is one as well.
 */
export const radios = (wrapper: Wrapper, index = 0) =>
  present(
    wrapper
      .findAll('[role="radiogroup"]')
      .filter((group) => group.find('input[type="radio"]').exists())[index],
    `radio group ${index + 1}`,
  ).findAll('input[type="radio"]')

/**
 * A radio's name as a reader hears it: the elements it is labelled by, else its `aria-label`, else
 * the labels it belongs to. Read from what names it, not from where it stands, so a radio moved
 * out of the element that held its words keeps its name, and one named by no words has none.
 */
export function radioLabel(input: { element: Element }): string {
  const radio = input.element as HTMLInputElement
  const root = radio.getRootNode() as Document | DocumentFragment | Element
  const by = radio.getAttribute('aria-labelledby')
  return by
    ? by
        .split(/\s+/u)
        .map((id) => root.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? '')
        .join(' ')
    : (radio.getAttribute('aria-label') ??
        [...(radio.labels ?? [])].map((label) => label.textContent?.trim() ?? '').join(' '))
}

/** Chooses the radio with this label, as a click would. */
export async function answer(wrapper: Wrapper, label: string, index = 0) {
  await present(
    radios(wrapper, index).find((input) => radioLabel(input) === label),
    `radio ${label}`,
  ).setValue(true)
  await flushPromises()
}

export const checkedLabels = (wrapper: Wrapper, index = 0) =>
  radios(wrapper, index)
    .filter((input) => (input.element as HTMLInputElement).checked)
    .map((input) => radioLabel(input))
