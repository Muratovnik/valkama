/**
 * What a host draws in an option's place keeps the one-line rule the default title has: the
 * drawing is held to the row's width, so its word ends in an ellipsis, and the row says the
 * option's words whole while they are cut. A state menu draws each state with its dot
 * (`FacetChoiceMark`), and its long name was cut at the row's edge with nothing to read it by.
 */
import { computed, defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'

import FacetChoiceMark from '@/entities/work-item/components/FacetChoiceMark.vue'
import { useFacetChoices } from '@/entities/work-item/composables/useFacetChoices.ts'
import type { FacetChoiceOption } from '@/entities/work-item/composables/useFacetChoices.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

import { present } from '../support/present.ts'

const LONG = 'Waiting for the release owner to sign off the installer build'

afterEach(() => {
  document.body.innerHTML = ''
})

/** A state and a priority menu as the card builds one: each value drawn by its mark. */
const Menu = defineComponent({
  setup() {
    const choices = useFacetChoices()
    const options = computed(() =>
      choices([
        {
          facet: 'state',
          value: 'signoff',
          state: { key: 'signoff', name: LONG, category: 'review' },
        },
        { facet: 'priority', value: 'urgent' },
      ]),
    )
    return () =>
      h(
        ChoiceSelect<FacetChoiceOption>,
        { label: 'State', modelValue: '', options: options.value },
        {
          option: ({ option }: { option: FacetChoiceOption }) =>
            h(FacetChoiceMark, { mark: option.mark }),
        },
      )
  },
})

const rowWith = (words: string) =>
  present(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
      row.textContent?.includes(words),
    ),
    `the row of ${words}`,
  )

/** Whether the element carries the stamp a `:slotted()` rule of the component it was handed to matches. */
const slottedStamp = (element: Element) =>
  [...element.attributes].some((attribute) => /^data-v-[\da-f]+-s$/u.test(attribute.name))

it('a host’s drawing of an option is held to the row and its words are the row’s hint', async () => {
  const wrapper = mount(Menu, {
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })] },
  })
  await wrapper.get('.choice-trigger').trigger('keydown', { key: 'Enter' })
  await flushPromises()

  const state = rowWith(LONG)
  // The host's drawing took the default title's place, and with it went that title's hint.
  expect(state.querySelector('.choice-title')).toBeNull()
  // The row offers the state's whole name, shown only while it is cut.
  expect(tooltipOf(state)).toMatchObject({ clipped: true, text: LONG })
  const drawn = present(state.querySelector('.choice-value > .semantic-state'), 'the drawn state')
  expect(slottedStamp(drawn)).toBe(true)

  // A priority drawn with its glyph is held and offered the same way; its meaning stays the note.
  const urgent = rowWith('Urgent')
  expect(tooltipOf(urgent)).toMatchObject({ clipped: true, text: 'Urgent' })
  const mark = present(urgent.querySelector('.choice-value > .facet-mark'), 'the drawn priority')
  expect(slottedStamp(mark)).toBe(true)
  expect(mark.querySelector('.facet-word')?.classList).toContain('one-line')
  wrapper.unmount()
})
