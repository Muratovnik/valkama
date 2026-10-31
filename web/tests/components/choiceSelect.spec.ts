import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { present } from '../support/present.ts'

function optionNamed(label: string) {
  return present(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes(label),
    ),
    `option ${label}`,
  )
}

describe('ChoiceSelect as an action select', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  // A parent that answers a choice by leaving its model empty — the state move
  // the server refused — must get the same choice again. Reka decides at mount
  // whether it follows the model; mounted on an unset value it used to keep its
  // own, so the refused option stayed selected inside the list and choosing it
  // a second time sent nothing.
  it('follows a model that stays unset, so the same choice can be made twice', async () => {
    const chosen: string[] = []
    const wrapper = mount(ChoiceSelect, {
      attachTo: document.body,
      props: {
        'label': 'Move to',
        'placeholder': 'Move to',
        'modelValue': '',
        'options': [
          { value: 'review', label: 'Review' },
          { value: 'done', label: 'Done' },
        ],
        'onUpdate:modelValue': (value: string) => chosen.push(value),
      },
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await wrapper.get('.choice-trigger').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      const done = optionNamed('Done')
      expect(done.getAttribute('aria-selected')).toBe('false')
      done.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await flushPromises()
    }
    expect(chosen).toEqual(['done', 'done'])
    expect(wrapper.get('.choice-title').text()).toBe('Move to')
    wrapper.unmount()
  })
})
