import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import { present } from './present.ts'

type Wrapper = Pick<VueWrapper, 'findAll'>

/** The radio buttons of one single-answer group, in the order they are drawn. */
export const radios = (wrapper: Wrapper, index = 0) =>
  present(wrapper.findAll('[role="radiogroup"]')[index], `radio group ${index + 1}`).findAll(
    'input[type="radio"]',
  )

/** A radio's visible label: the text of the label element that wraps it. */
export const radioLabel = (input: { element: Element }) => input.element.parentElement?.textContent

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
